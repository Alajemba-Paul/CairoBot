import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatIntent, normalizeMarket, parseCloseIntent, parseTradeIntent, tryParse } from "./intent.ts";

describe("parseTradeIntent", () => {
  it("parses the sprint one-liner", () => {
    const intent = parseTradeIntent("long sol 10x 50 usdc tp @ 200", "cli");
    assert.equal(intent.owner, "cli");
    assert.equal(intent.market, "SOL-USD");
    assert.equal(intent.side, "LONG");
    assert.equal(intent.leverage, 10);
    assert.equal(intent.marginUsdc, 50);
    assert.equal(intent.tpPrice, 200);
    assert.equal(intent.slPrice, undefined);
  });

  it("parses the original v1 examples", () => {
    const a = parseTradeIntent("long sol 20x 500 usdc tp @ 90 sl @ 85");
    assert.equal(a.market, "SOL-USD");
    assert.equal(a.leverage, 20);
    assert.equal(a.marginUsdc, 500);
    assert.equal(a.tpPrice, 90);
    assert.equal(a.slPrice, 85);

    const b = parseTradeIntent("short btc 50x with 2000 margin tp @ 92000 sl @ 85000");
    assert.equal(b.side, "SHORT");
    assert.equal(b.market, "BTC-USD");
    assert.equal(b.leverage, 50);
    assert.equal(b.marginUsdc, 2000);
    assert.equal(b.tpPrice, 92000);
    assert.equal(b.slPrice, 85000);
  });

  it("accepts ETH and STRK", () => {
    assert.equal(parseTradeIntent("long eth 5x 100 usdc").market, "ETH-USD");
    assert.equal(parseTradeIntent("short strk 3x 25 usdc").market, "STRK-USD");
  });

  it("rejects unknown markets and bad sizes", () => {
    assert.throws(() => parseTradeIntent("long doge 10x 50 usdc"), /unknown market/);
    assert.throws(() => parseTradeIntent("hello world"), /could not parse/);
    assert.throws(() => parseTradeIntent("long sol 0x 50 usdc"), /could not parse|leverage/);
  });

  it("round-trips through formatIntent", () => {
    const text = "long sol 10x 50 usdc tp @ 200";
    const intent = parseTradeIntent(text);
    const again = parseTradeIntent(formatIntent(intent));
    assert.deepEqual(again, intent);
  });
});

describe("parseCloseIntent", () => {
  it("parses close my sol position", () => {
    const close = parseCloseIntent("close my sol position", "tg:1");
    assert.equal(close.market, "SOL-USD");
    assert.equal(close.owner, "tg:1");
  });
});

describe("normalizeMarket", () => {
  it("maps tickers onto the four perps", () => {
    assert.equal(normalizeMarket("sol"), "SOL-USD");
    assert.equal(normalizeMarket("BTC"), "BTC-USD");
    assert.equal(normalizeMarket("eth-usd"), "ETH-USD");
  });
});

describe("tryParse", () => {
  it("discriminates trade vs close", () => {
    const trade = tryParse("long sol 10x 50 usdc tp @ 200");
    assert.equal(trade?.kind, "trade");
    const close = tryParse("close sol");
    assert.equal(close?.kind, "close");
    assert.equal(tryParse("what is btc"), null);
  });
});
