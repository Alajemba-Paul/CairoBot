export interface RetryOptions {
  maxAttempts: number;   // default: 3
  baseDelayMs: number;   // default: 1000
  isRetryable: (err: unknown) => boolean;
}

/**
 * Returns true for errors that are transient and worth retrying:
 * - Network timeouts (ECONNRESET, ETIMEDOUT, ENOTFOUND, ERR_NETWORK)
 * - HTTP 429 (rate limit) and HTTP 503 (service unavailable)
 * - Nonce conflicts (NONCE_CONFLICT or similar)
 */
export function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Network-level errors
    if (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('network timeout') ||
      msg.includes('timeout')
    ) {
      return true;
    }
    // Nonce conflict
    if (msg.includes('nonce_conflict') || msg.includes('nonce conflict')) {
      return true;
    }
  }

  // HTTP status-based errors (axios-style or plain objects with status)
  const status = extractHttpStatus(err);
  if (status === 429 || status === 503) return true;

  return false;
}

function extractHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    // axios error shape
    const axiosErr = err as { response?: { status?: number }; status?: number };
    if (axiosErr.response?.status !== undefined) return axiosErr.response.status;
    if (axiosErr.status !== undefined) return axiosErr.status;
  }
  return undefined;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  isRetryable: defaultIsRetryable,
};

/**
 * Executes `fn` with exponential backoff retry.
 *
 * Backoff formula: baseDelayMs * 2^(attempt - 1)
 *   attempt 1 → 0 ms wait (first try, no delay)
 *   attempt 2 → baseDelayMs * 1 = 1 s
 *   attempt 3 → baseDelayMs * 2 = 2 s
 *
 * Non-retryable errors are re-thrown immediately without further attempts.
 * After maxAttempts exhaustion the final error is re-thrown.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!opts.isRetryable(err)) {
        // Non-retryable — surface immediately
        throw err;
      }

      if (attempt < opts.maxAttempts) {
        const delayMs = opts.baseDelayMs * Math.pow(2, attempt - 1);
        const message = err instanceof Error ? err.message : String(err);
        console.log(
          `[retry] attempt ${attempt}/${opts.maxAttempts} failed: "${message}". Retrying in ${delayMs} ms…`
        );
        await sleep(delayMs);
      } else {
        // Final attempt exhausted
        const message = err instanceof Error ? err.message : String(err);
        console.log(
          `[retry] attempt ${attempt}/${opts.maxAttempts} failed: "${message}". All attempts exhausted.`
        );
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
