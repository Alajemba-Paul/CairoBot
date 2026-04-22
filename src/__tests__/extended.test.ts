import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import nock from 'nock';

// ---------------------------------------------------------------------------
// We need to mock config before importing extended.ts so the module loads
// without requiring real env vars.
// ---------------------------------------------------------------------------
vi.mock('../../config', () => ({
  config: {
    EXTENDED_API_BASE: 'https://api.starknet.sepolia.extended.exchange',
    EXTENDED_API_KEY: 'test-api-key',
    EXTENDED_STARK_PRIVATE_KEY:
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    NETWORK: 'sepolia',
  },
}));

import {
  fetchMarkPrice,
  fetchPositions,
  serializeOrder,
  deserializeOrderResponse,
  parsePosition,
  placeOrder,
  buildOrderPayload,
  ExtendedApiSchemaError,
  clearPriceCache,
  OrderRequest,
  Position,
} from '../extended';
import { OrderDetails } from '../types';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const marketArb = fc.constantFrom('BTC-USD', 'ETH-USD', 'SOL-USD', 'STRK-USD');
const sideArb = fc.constantFrom<'LONG' | 'SHORT'>('LONG', 'SHORT');

const orderDetailsArb: fc.Arbitrary<OrderDetails> = fc.record({
  market: marketArb,
  side: sideArb,
  leverage: fc.integer({ min: 1, max: 100 }),
  margin: fc.double({ min: 1, max: 10000, noNaN: true }),
  tpPrice: fc.option(fc.double({ min: 1, max: 200000, noNaN: true }), { nil: undefined }),
  slPrice: fc.option(fc.double({ min: 1, max: 200000, noNaN: true }), { nil: undefined }),
});

const rawPositionArb = fc.record({
  id: fc.integer({ min: 1, max: 999999 }),
  accountId: fc.integer({ min: 1, max: 999999 }),
  market: marketArb,
  side: sideArb,
  leverage: fc.double({ min: 1, max: 100, noNaN: true }).map(String),
  size: fc.double({ min: 0.001, max: 1000, noNaN: true }).map(String),
  value: fc.double({ min: 1, max: 1000000, noNaN: true }).map(String),
  openPrice: fc.double({ min: 1, max: 200000, noNaN: true }).map(String),
  markPrice: fc.double({ min: 1, max: 200000, noNaN: true }).map(String),
  liquidationPrice: fc.double({ min: 1, max: 200000, noNaN: true }).map(String),
  margin: fc.double({ min: 1, max: 10000, noNaN: true }).map(String),
  unrealisedPnl: fc.double({ min: -10000, max: 10000, noNaN: true }).map(String),
  realisedPnl: fc.double({ min: -10000, max: 10000, noNaN: true }).map(String),
  tpTriggerPrice: fc.option(fc.double({ min: 1, max: 200000, noNaN: true }).map(String), { nil: undefined }),
  tpLimitPrice: fc.option(fc.double({ min: 1, max: 200000, noNaN: true }).map(String), { nil: undefined }),
  slTriggerPrice: fc.option(fc.double({ min: 1, max: 200000, noNaN: true }).map(String), { nil: undefined }),
  slLimitPrice: fc.option(fc.double({ min: 1, max: 200000, noNaN: true }).map(String), { nil: undefined }),
  createdTime: fc.integer({ min: 0 }),
  updatedTime: fc.integer({ min: 0 }),
});

// ---------------------------------------------------------------------------
// Unit tests — deserializeOrderResponse
// ---------------------------------------------------------------------------

describe('deserializeOrderResponse', () => {
  it('returns typed OrderResponse for valid input', () => {
    const raw = { id: 42, externalId: 'abc-123' };
    const result = deserializeOrderResponse(raw);
    expect(result.id).toBe(42);
    expect(result.externalId).toBe('abc-123');
  });

  it('throws ExtendedApiSchemaError when id is missing', () => {
    expect(() => deserializeOrderResponse({ externalId: 'abc' })).toThrow(ExtendedApiSchemaError);
  });

  it('throws ExtendedApiSchemaError when externalId is missing', () => {
    expect(() => deserializeOrderResponse({ id: 1 })).toThrow(ExtendedApiSchemaError);
  });

  it('throws ExtendedApiSchemaError for null input', () => {
    expect(() => deserializeOrderResponse(null)).toThrow(ExtendedApiSchemaError);
  });

  it('includes missing field names in the error', () => {
    try {
      deserializeOrderResponse({ id: 1 });
    } catch (e) {
      expect(e).toBeInstanceOf(ExtendedApiSchemaError);
      expect((e as ExtendedApiSchemaError).missingFields).toContain('externalId');
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — parsePosition
// ---------------------------------------------------------------------------

describe('parsePosition', () => {
  it('parses a valid raw position', () => {
    const raw = {
      id: 1,
      market: 'BTC-USD',
      side: 'LONG',
      size: '0.5',
      value: '32500',
      openPrice: '65000',
      markPrice: '65100',
      liquidationPrice: '50000',
      margin: '1000',
      unrealisedPnl: '50',
      leverage: '10',
    };
    const pos = parsePosition(raw);
    expect(pos.id).toBe(1);
    expect(pos.market).toBe('BTC-USD');
    expect(pos.side).toBe('LONG');
  });

  it('throws ExtendedApiSchemaError for missing required fields', () => {
    expect(() => parsePosition({ id: 1, market: 'BTC-USD' })).toThrow(ExtendedApiSchemaError);
  });

  it('includes all missing field names in the error', () => {
    try {
      parsePosition({ id: 1 });
    } catch (e) {
      expect(e).toBeInstanceOf(ExtendedApiSchemaError);
      const missing = (e as ExtendedApiSchemaError).missingFields;
      expect(missing).toContain('market');
      expect(missing).toContain('side');
    }
  });

  it('throws for null input', () => {
    expect(() => parsePosition(null)).toThrow(ExtendedApiSchemaError);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — serializeOrder
// ---------------------------------------------------------------------------

describe('serializeOrder', () => {
  const walletAddress = '0x1234567890abcdef';
  const markPrice = 65000;

  it('maps LONG side to BUY', () => {
    const order: OrderDetails = { market: 'BTC-USD', side: 'LONG', leverage: 10, margin: 100 };
    const req = serializeOrder(order, walletAddress, markPrice);
    expect(req.side).toBe('BUY');
  });

  it('maps SHORT side to SELL', () => {
    const order: OrderDetails = { market: 'BTC-USD', side: 'SHORT', leverage: 10, margin: 100 };
    const req = serializeOrder(order, walletAddress, markPrice);
    expect(req.side).toBe('SELL');
  });

  it('includes market in the request', () => {
    const order: OrderDetails = { market: 'ETH-USD', side: 'LONG', leverage: 5, margin: 200 };
    const req = serializeOrder(order, walletAddress, markPrice);
    expect(req.market).toBe('ETH-USD');
  });

  it('includes settlement with signature fields', () => {
    const order: OrderDetails = { market: 'BTC-USD', side: 'LONG', leverage: 10, margin: 100 };
    const req = serializeOrder(order, walletAddress, markPrice);
    expect(req.settlement).toBeDefined();
    expect(req.settlement.signature.r).toBeDefined();
    expect(req.settlement.signature.s).toBeDefined();
    expect(req.settlement.starkKey).toBeDefined();
  });

  it('includes takeProfit when tpPrice is set', () => {
    const order: OrderDetails = { market: 'BTC-USD', side: 'LONG', leverage: 10, margin: 100, tpPrice: 70000 };
    const req = serializeOrder(order, walletAddress, markPrice);
    expect(req.takeProfit).toBeDefined();
    expect(req.takeProfit?.triggerPrice).toBe('70000');
  });

  it('includes stopLoss when slPrice is set', () => {
    const order: OrderDetails = { market: 'BTC-USD', side: 'LONG', leverage: 10, margin: 100, slPrice: 60000 };
    const req = serializeOrder(order, walletAddress, markPrice);
    expect(req.stopLoss).toBeDefined();
    expect(req.stopLoss?.triggerPrice).toBe('60000');
  });

  it('omits takeProfit when tpPrice is undefined', () => {
    const order: OrderDetails = { market: 'BTC-USD', side: 'LONG', leverage: 10, margin: 100 };
    const req = serializeOrder(order, walletAddress, markPrice);
    expect(req.takeProfit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Property 1: Order serialization round-trip
// Validates: Requirements 12.1, 12.4
// ---------------------------------------------------------------------------

describe('Property 1: Order serialization round-trip', () => {
  /**
   * For any valid OrderDetails object, serializing it to an OrderRequest
   * payload via serializeOrder and then deserializing the response via
   * deserializeOrderResponse SHALL produce an object whose fields are
   * equivalent to the originals.
   *
   * Validates: Requirements 12.1, 12.4
   */
  it('serialized order fields are preserved through round-trip', () => {
    fc.assert(
      fc.property(
        orderDetailsArb,
        fc.double({ min: 1, max: 200000, noNaN: true }),
        (order, markPrice) => {
          const walletAddress = '0x1234567890abcdef';
          const req = serializeOrder(order, walletAddress, markPrice);

          // Simulate the API echoing back id and externalId
          const rawResponse = { id: 12345, externalId: req.id };
          const resp = deserializeOrderResponse(rawResponse);

          // The externalId in the response matches the id we sent
          expect(resp.externalId).toBe(req.id);
          // Market is preserved
          expect(req.market).toBe(order.market);
          // Side mapping is consistent
          expect(req.side).toBe(order.side === 'LONG' ? 'BUY' : 'SELL');
          // qty = margin * leverage
          expect(req.qty).toBe((order.margin * order.leverage).toString());
          // price = markPrice
          expect(req.price).toBe(markPrice.toString());
          // TP/SL presence matches input
          if (order.tpPrice !== undefined) {
            expect(req.takeProfit).toBeDefined();
            expect(req.takeProfit?.triggerPrice).toBe(order.tpPrice.toString());
          } else {
            expect(req.takeProfit).toBeUndefined();
          }
          if (order.slPrice !== undefined) {
            expect(req.stopLoss).toBeDefined();
            expect(req.stopLoss?.triggerPrice).toBe(order.slPrice.toString());
          } else {
            expect(req.stopLoss).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Position parser preserves all fields
// Validates: Requirements 12.2, 12.5
// ---------------------------------------------------------------------------

describe('Property 2: Position parser preserves all fields', () => {
  /**
   * For any raw Extended API position response object that conforms to the
   * RawExtendedPosition schema, calling parsePosition SHALL return a Position
   * whose every field matches the corresponding raw field value.
   *
   * Validates: Requirements 12.2, 12.5
   */
  it('parsePosition preserves all required fields from raw input', () => {
    fc.assert(
      fc.property(rawPositionArb, (raw) => {
        const pos = parsePosition(raw);

        expect(pos.id).toBe(raw.id);
        expect(pos.market).toBe(raw.market);
        expect(pos.side).toBe(raw.side);
        expect(pos.size).toBe(raw.size);
        expect(pos.value).toBe(raw.value);
        expect(pos.openPrice).toBe(raw.openPrice);
        expect(pos.markPrice).toBe(raw.markPrice);
        expect(pos.liquidationPrice).toBe(raw.liquidationPrice);
        expect(pos.margin).toBe(raw.margin);
        expect(pos.unrealisedPnl).toBe(raw.unrealisedPnl);
        expect(pos.leverage).toBe(raw.leverage);

        if (raw.tpTriggerPrice !== undefined) {
          expect(pos.tpTriggerPrice).toBe(raw.tpTriggerPrice);
        }
        if (raw.slTriggerPrice !== undefined) {
          expect(pos.slTriggerPrice).toBe(raw.slTriggerPrice);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Schema violations throw typed errors with field names
// Validates: Requirements 12.3
// ---------------------------------------------------------------------------

const REQUIRED_POSITION_FIELDS = [
  'id', 'market', 'side', 'size', 'value', 'openPrice',
  'markPrice', 'liquidationPrice', 'margin', 'unrealisedPnl', 'leverage',
];

const REQUIRED_ORDER_RESPONSE_FIELDS = ['id', 'externalId'];

describe('Property 3: Schema violations throw typed errors with field names', () => {
  /**
   * For any raw object missing one or more required fields, the corresponding
   * parse function SHALL throw ExtendedApiSchemaError containing each missing
   * field name.
   *
   * Validates: Requirements 12.3
   */
  it('parsePosition throws ExtendedApiSchemaError with all missing field names', () => {
    fc.assert(
      fc.property(
        fc.subarray(REQUIRED_POSITION_FIELDS, { minLength: 1 }),
        (fieldsToRemove) => {
          // Build a complete raw position then remove some fields
          const raw: Record<string, unknown> = {
            id: 1, market: 'BTC-USD', side: 'LONG', size: '1', value: '65000',
            openPrice: '65000', markPrice: '65000', liquidationPrice: '50000',
            margin: '1000', unrealisedPnl: '0', leverage: '10',
          };
          for (const f of fieldsToRemove) {
            delete raw[f];
          }

          let threw = false;
          try {
            parsePosition(raw);
          } catch (e) {
            threw = true;
            expect(e).toBeInstanceOf(ExtendedApiSchemaError);
            const missing = (e as ExtendedApiSchemaError).missingFields;
            for (const f of fieldsToRemove) {
              expect(missing).toContain(f);
            }
          }
          expect(threw).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('deserializeOrderResponse throws ExtendedApiSchemaError with all missing field names', () => {
    fc.assert(
      fc.property(
        fc.subarray(REQUIRED_ORDER_RESPONSE_FIELDS, { minLength: 1 }),
        (fieldsToRemove) => {
          const raw: Record<string, unknown> = { id: 1, externalId: 'abc-123' };
          for (const f of fieldsToRemove) {
            delete raw[f];
          }

          let threw = false;
          try {
            deserializeOrderResponse(raw);
          } catch (e) {
            threw = true;
            expect(e).toBeInstanceOf(ExtendedApiSchemaError);
            const missing = (e as ExtendedApiSchemaError).missingFields;
            for (const f of fieldsToRemove) {
              expect(missing).toContain(f);
            }
          }
          expect(threw).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Price cache prevents redundant HTTP calls within TTL
// Validates: Requirements 6.5
// ---------------------------------------------------------------------------

describe('Property 6: Price cache prevents redundant HTTP calls within TTL', () => {
  /**
   * For any market name, if fetchMarkPrice is called twice within 10 seconds,
   * the second call SHALL return the cached value and SHALL NOT make an
   * additional HTTP request to the Extended API.
   *
   * Validates: Requirements 6.5
   */
  it('second call within TTL uses cache and makes no additional HTTP request', async () => {
    await fc.assert(
      fc.asyncProperty(
        marketArb,
        fc.double({ min: 1, max: 200000, noNaN: true }),
        async (market, price) => {
          // Clear the module-level cache before each run
          clearPriceCache();
          nock.cleanAll();

          const scope = nock('https://api.starknet.sepolia.extended.exchange')
            .get(`/api/v1/info/markets/${encodeURIComponent(market)}/stats`)
            .once()
            .reply(200, { data: { markPrice: price.toString() } });

          // First call — should hit HTTP
          const price1 = await fetchMarkPrice(market);
          // Second call — should use cache
          const price2 = await fetchMarkPrice(market);

          expect(price1).toBe(price2);
          // nock scope should have been used exactly once (no pending mocks = used)
          expect(scope.isDone()).toBe(true);
          // No additional interceptors were consumed
          expect(nock.pendingMocks()).toHaveLength(0);

          nock.cleanAll();
        }
      ),
      { numRuns: 4 }
    );
  }, 30_000);
});
