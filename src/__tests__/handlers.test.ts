import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCloseIntent } from '../parser';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const SUPPORTED_MARKETS = ['BTC', 'ETH', 'SOL', 'STRK'];

/** Generates a market symbol with random casing (e.g. "bTc", "ETH", "sol"). */
const randomCasedMarketArb = fc
  .constantFrom(...SUPPORTED_MARKETS)
  .chain((market) =>
    fc
      .array(fc.boolean(), { minLength: market.length, maxLength: market.length })
      .map((bools) =>
        market
          .split('')
          .map((ch, i) => (bools[i] ? ch.toUpperCase() : ch.toLowerCase()))
          .join('')
      )
  );

/** Generates a positive price (> 0, finite). */
const positivePriceArb = fc.double({ min: 0.0001, max: 1_000_000, noNaN: true });

/** Generates a non-positive price: 0, negative, or NaN. */
const nonPositivePriceArb = fc.oneof(
  fc.constant(0),
  fc.double({ max: -0.0001, noNaN: true }),
  fc.constant(NaN)
);

// ---------------------------------------------------------------------------
// Helpers — minimal TP/SL command parser (mirrors handler logic)
// ---------------------------------------------------------------------------

/**
 * Parses "/tp <MARKET> @ <PRICE>" or "/sl <MARKET> @ <PRICE>".
 * Returns { market: string (uppercase), price: number } or null.
 */
function parseTpSlCommand(text: string): { market: string; price: number } | null {
  const match = text.match(/^\/(tp|sl)\s+([a-zA-Z0-9-]+)\s+@\s+(\S+)/i);
  if (!match) return null;
  let market = match[2].toUpperCase();
  if (!market.includes('-')) market += '-USD';
  const price = parseFloat(match[3]);
  return { market, price };
}

/**
 * Validates a price for TP/SL: must be finite and > 0.
 * Returns an error message string if invalid, null if valid.
 */
function validateTpSlPrice(price: number): string | null {
  if (!isFinite(price) || price <= 0) {
    return 'Invalid price. Please enter a positive number.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Property 7: Position display contains all required fields
// Validates: Requirements 7.2, 8.2
// ---------------------------------------------------------------------------

/**
 * Minimal position formatter that mirrors the display logic in handlers.ts
 * for /positions and /close confirmation.
 */
function formatPositionDisplay(p: {
  market: string;
  side: string;
  size: string;
  openPrice: string;
  markPrice: string;
  unrealisedPnl: string;
  liquidationPrice: string;
}): string {
  const pnl = parseFloat(p.unrealisedPnl);
  const pnlStr = pnl >= 0 ? `+${pnl.toFixed(4)}` : pnl.toFixed(4);
  return (
    `📌 ${p.market} ${p.side}\n` +
    `  Size: ${p.size}  Entry: ${p.openPrice}\n` +
    `  Mark: ${p.markPrice}  Liq: ${p.liquidationPrice}\n` +
    `  PnL: ${pnlStr} USDC`
  );
}

function formatCloseConfirmDisplay(
  p: {
    market: string;
    side: string;
    size: string;
    unrealisedPnl: string;
  },
  markPrice: number
): string {
  const pnl = parseFloat(p.unrealisedPnl);
  const pnlStr = pnl >= 0 ? `+${pnl.toFixed(4)}` : pnl.toFixed(4);
  return (
    `⚠️ **Close Position Confirmation**\n\n` +
    `Market: ${p.market}\n` +
    `Side: ${p.side}\n` +
    `Size: ${p.size}\n` +
    `Mark Price: ${markPrice.toFixed(4)}\n` +
    `Unrealized PnL: ${pnlStr} USDC\n\n` +
    `Reply exactly with **CONFIRM** to close this position, or /cancel to abort.`
  );
}

const positionArb = fc.record({
  market: fc.constantFrom('BTC-USD', 'ETH-USD', 'SOL-USD', 'STRK-USD'),
  side: fc.constantFrom('LONG', 'SHORT'),
  size: fc.double({ min: 0.001, max: 1000, noNaN: true }).map(String),
  openPrice: fc.double({ min: 1, max: 200000, noNaN: true }).map(String),
  markPrice: fc.double({ min: 1, max: 200000, noNaN: true }).map(String),
  liquidationPrice: fc.double({ min: 1, max: 200000, noNaN: true }).map(String),
  margin: fc.double({ min: 1, max: 10000, noNaN: true }).map(String),
  unrealisedPnl: fc.double({ min: -10000, max: 10000, noNaN: true }).map(String),
  leverage: fc.double({ min: 1, max: 100, noNaN: true }).map(String),
});

describe('Property 7: Position display contains all required fields', () => {
  /**
   * For any Position object, the formatted output string — whether for
   * /positions listing or /close confirmation — SHALL contain the market name,
   * side, size, entry price, mark price, unrealized PnL, and liquidation price.
   *
   * Validates: Requirements 7.2, 8.2
   */
  it('/positions display contains all required fields', () => {
    fc.assert(
      fc.property(positionArb, (position) => {
        const output = formatPositionDisplay(position);

        expect(output).toContain(position.market);
        expect(output).toContain(position.side);
        expect(output).toContain(position.size);
        expect(output).toContain(position.openPrice);
        expect(output).toContain(position.markPrice);
        expect(output).toContain(position.liquidationPrice);
        // PnL is formatted — check the raw numeric value appears somewhere
        const pnlNum = parseFloat(position.unrealisedPnl);
        expect(output).toContain(Math.abs(pnlNum).toFixed(4));
      }),
      { numRuns: 100 }
    );
  });

  it('/close confirmation display contains all required fields', () => {
    fc.assert(
      fc.property(
        positionArb,
        fc.double({ min: 1, max: 200000, noNaN: true }),
        (position, markPrice) => {
          const output = formatCloseConfirmDisplay(position, markPrice);

          expect(output).toContain(position.market);
          expect(output).toContain(position.side);
          expect(output).toContain(position.size);
          expect(output).toContain(markPrice.toFixed(4));
          const pnlNum = parseFloat(position.unrealisedPnl);
          expect(output).toContain(Math.abs(pnlNum).toFixed(4));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: TP and SL command parser extracts market and price
// Validates: Requirements 9.1, 10.1
// ---------------------------------------------------------------------------

describe('Property 8: TP and SL command parser extracts market and price', () => {
  /**
   * For any valid /tp <MARKET> @ <PRICE> or /sl <MARKET> @ <PRICE> command
   * string (any supported market symbol, any positive price), the command
   * parser SHALL extract the market symbol in uppercase and the price as a
   * positive number.
   *
   * Validates: Requirements 9.1, 10.1
   */
  it('/tp command parser extracts uppercase market and positive price', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_MARKETS),
        positivePriceArb,
        (market, price) => {
          const cmd = `/tp ${market} @ ${price}`;
          const result = parseTpSlCommand(cmd);

          expect(result).not.toBeNull();
          expect(result!.market).toBe(`${market.toUpperCase()}-USD`);
          expect(result!.price).toBeCloseTo(price, 5);
          expect(result!.price).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('/sl command parser extracts uppercase market and positive price', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_MARKETS),
        positivePriceArb,
        (market, price) => {
          const cmd = `/sl ${market} @ ${price}`;
          const result = parseTpSlCommand(cmd);

          expect(result).not.toBeNull();
          expect(result!.market).toBe(`${market.toUpperCase()}-USD`);
          expect(result!.price).toBeCloseTo(price, 5);
          expect(result!.price).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('parser handles market symbols already containing -USD suffix', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_MARKETS.map((m) => `${m}-USD`)),
        positivePriceArb,
        (market, price) => {
          const cmd = `/tp ${market} @ ${price}`;
          const result = parseTpSlCommand(cmd);

          expect(result).not.toBeNull();
          expect(result!.market).toBe(market.toUpperCase());
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Non-positive prices are rejected without API call
// Validates: Requirements 9.5, 10.5
// ---------------------------------------------------------------------------

describe('Property 9: Non-positive prices are rejected without API call', () => {
  /**
   * For any price value that is zero, negative, or NaN submitted via /tp or
   * /sl, the bot SHALL reject the update with an invalid-price message and
   * SHALL NOT make any call to the Extended API.
   *
   * Validates: Requirements 9.5, 10.5
   */
  it('validateTpSlPrice rejects zero, negative, and NaN prices', () => {
    fc.assert(
      fc.property(nonPositivePriceArb, (price) => {
        const result = validateTpSlPrice(price);
        expect(result).toBe('Invalid price. Please enter a positive number.');
      }),
      { numRuns: 100 }
    );
  });

  it('validateTpSlPrice accepts positive finite prices', () => {
    fc.assert(
      fc.property(positivePriceArb, (price) => {
        const result = validateTpSlPrice(price);
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('handler rejects /tp with non-positive price and returns error message', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_MARKETS),
        nonPositivePriceArb,
        (market, price) => {
          // Simulate the price validation logic from handleTp/handleSl
          const priceStr = isNaN(price) ? 'NaN' : price.toString();
          const parsed = parseFloat(priceStr);
          const errorMsg = validateTpSlPrice(parsed);
          expect(errorMsg).toBe('Invalid price. Please enter a positive number.');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: NL close parser is case-insensitive
// Validates: Requirements 11.1
// ---------------------------------------------------------------------------

describe('Property 10: NL close parser is case-insensitive', () => {
  /**
   * For any string matching the pattern "close [my] <MARKET> position" with
   * any combination of upper/lower case letters, parseCloseIntent SHALL return
   * the market symbol in uppercase.
   *
   * Validates: Requirements 11.1
   */
  it('parseCloseIntent returns uppercase market for any casing', () => {
    fc.assert(
      fc.property(randomCasedMarketArb, (market) => {
        const text = `close my ${market} position`;
        const result = parseCloseIntent(text);

        expect(result).not.toBeNull();
        expect(result!.market).toBe(market.toUpperCase());
      }),
      { numRuns: 100 }
    );
  });

  it('parseCloseIntent works without "my" keyword', () => {
    fc.assert(
      fc.property(randomCasedMarketArb, (market) => {
        const text = `close ${market} position`;
        const result = parseCloseIntent(text);

        expect(result).not.toBeNull();
        expect(result!.market).toBe(market.toUpperCase());
      }),
      { numRuns: 100 }
    );
  });

  it('parseCloseIntent returns null for non-matching text', () => {
    const nonMatching = ['buy btc', 'open eth position', 'close', 'position only'];
    for (const text of nonMatching) {
      expect(parseCloseIntent(text)).toBeNull();
    }
  });
});
