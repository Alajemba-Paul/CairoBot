import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { withRetry, defaultIsRetryable, RetryOptions } from '../retry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates an error with an HTTP status attached (axios-style). */
function httpError(status: number, message = `HTTP ${status}`): Error & { response: { status: number } } {
  const err = new Error(message) as Error & { response: { status: number } };
  err.response = { status };
  return err;
}

/** Creates a plain network-timeout error. */
function timeoutError(): Error {
  return new Error('network timeout');
}

/** Creates a nonce-conflict error. */
function nonceError(): Error {
  return new Error('NONCE_CONFLICT: nonce already used');
}

// ---------------------------------------------------------------------------
// Unit tests — defaultIsRetryable
// ---------------------------------------------------------------------------

describe('defaultIsRetryable', () => {
  it('returns true for network timeout', () => {
    expect(defaultIsRetryable(timeoutError())).toBe(true);
  });

  it('returns true for ECONNRESET', () => {
    expect(defaultIsRetryable(new Error('ECONNRESET'))).toBe(true);
  });

  it('returns true for ETIMEDOUT', () => {
    expect(defaultIsRetryable(new Error('ETIMEDOUT'))).toBe(true);
  });

  it('returns true for nonce conflict', () => {
    expect(defaultIsRetryable(nonceError())).toBe(true);
  });

  it('returns true for HTTP 429', () => {
    expect(defaultIsRetryable(httpError(429))).toBe(true);
  });

  it('returns true for HTTP 503', () => {
    expect(defaultIsRetryable(httpError(503))).toBe(true);
  });

  it('returns false for HTTP 400', () => {
    expect(defaultIsRetryable(httpError(400))).toBe(false);
  });

  it('returns false for HTTP 422', () => {
    expect(defaultIsRetryable(httpError(422))).toBe(false);
  });

  it('returns false for contract revert / insufficient balance', () => {
    expect(defaultIsRetryable(new Error('insufficient balance'))).toBe(false);
  });

  it('returns false for invalid calldata', () => {
    expect(defaultIsRetryable(new Error('invalid calldata'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — withRetry behaviour (baseDelayMs: 0 to avoid real waits)
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  it('returns the value immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withRetry(fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds on second attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on non-retryable error (HTTP 400)', async () => {
    const fn = vi.fn().mockRejectedValueOnce(httpError(400));
    await expect(withRetry(fn)).rejects.toMatchObject({ message: 'HTTP 400' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on non-retryable error (HTTP 422)', async () => {
    const fn = vi.fn().mockRejectedValueOnce(httpError(422));
    await expect(withRetry(fn)).rejects.toMatchObject({ message: 'HTTP 422' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts all attempts and re-throws the last error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError());
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toMatchObject({ message: 'network timeout' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('logs each retry attempt', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fn = vi.fn()
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError());

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toThrow();

    // Attempts 1 and 2 log "Retrying in X ms", attempt 3 logs "All attempts exhausted"
    expect(consoleSpy).toHaveBeenCalledTimes(3);
    consoleSpy.mockRestore();
  });

  it('uses custom isRetryable predicate', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('custom-transient'))
      .mockRejectedValueOnce(new Error('custom-transient'));
    const isRetryable = (e: unknown) => e instanceof Error && e.message === 'custom-transient';

    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 0, isRetryable })).rejects.toThrow('custom-transient');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests — use real timers with baseDelayMs: 0 to avoid hangs
// ---------------------------------------------------------------------------

describe('Property 4: Retry exhaustion calls function exactly maxAttempts times', () => {
  /**
   * Validates: Requirements 5.1, 5.2
   *
   * For any async operation that always throws a retryable error and any
   * maxAttempts value between 1 and 5, withRetry SHALL invoke the function
   * exactly maxAttempts times before re-throwing the final error.
   */
  it('calls fn exactly maxAttempts times for always-failing retryable errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (maxAttempts) => {
          const fn = vi.fn().mockRejectedValue(timeoutError());
          const opts: Partial<RetryOptions> = { maxAttempts, baseDelayMs: 0 };

          try {
            await withRetry(fn, opts);
          } catch {
            // expected
          }

          expect(fn).toHaveBeenCalledTimes(maxAttempts);
          fn.mockReset();
        }
      ),
      { numRuns: 50 }
    );
  }, 30_000);
});

describe('Property 5: Non-retryable errors are never retried', () => {
  /**
   * Validates: Requirements 5.3
   *
   * For any async operation that throws a non-retryable error (HTTP 400, 422,
   * contract revert codes), withRetry SHALL call the function exactly once and
   * immediately re-throw without any additional attempts.
   */
  it('calls fn exactly once for non-retryable errors', async () => {
    const nonRetryableStatuses = [400, 422];
    const nonRetryableMessages = ['insufficient balance', 'invalid calldata', 'contract revert'];

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constantFrom(...nonRetryableStatuses).map((s) => httpError(s)),
          fc.constantFrom(...nonRetryableMessages).map((m) => new Error(m))
        ),
        fc.integer({ min: 1, max: 5 }),
        async (err, maxAttempts) => {
          const fn = vi.fn().mockRejectedValue(err);
          const opts: Partial<RetryOptions> = { maxAttempts, baseDelayMs: 0 };

          try {
            await withRetry(fn, opts);
          } catch {
            // expected
          }

          expect(fn).toHaveBeenCalledTimes(1);
          fn.mockReset();
        }
      ),
      { numRuns: 50 }
    );
  }, 30_000);
});
