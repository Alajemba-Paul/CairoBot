import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTriggers,
  formatIntent,
  normalizeMarket,
  parseCloseIntent,
  parseTradeIntent,
  parseTriggerOnly,
  tryParse,
} from "./intent.ts";

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

  it("extracts SL independently of TP and order", () => {
    const swapped = parseTradeIntent("long sol 10x 50 usdc sl @ 85 tp @ 200");
    assert.equal(swapped.slPrice, 85);
    assert.equal(swapped.tpPrice, 200);

    const glued = parseTradeIntent("long sol 10x 50 usdc sl@85");
    assert.equal(glued.slPrice, 85);
    assert.equal(glued.tpPrice, undefined);

    const noAt = parseTradeIntent("long sol 10x 50 usdc sl 85");
    assert.equal(noAt.slPrice, 85);

    const stopAt = parseTradeIntent("long sol 10x 50 usdc stop @ 85");
    assert.equal(stopAt.slPrice, 85);

    const stopLoss = parseTradeIntent("short btc 5x 100 usdc stop-loss @ 90,000");
    assert.equal(stopLoss.slPrice, 90000);
    assert.equal(stopLoss.tpPrice, undefined);
  });

  it("does not treat SOL as a stop-loss", () => {
    const intent = parseTradeIntent("long sol 10x 50 usdc");
    assert.equal(intent.slPrice, undefined);
    assert.equal(intent.tpPrice, undefined);
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
    const text = "long sol 10x 50 usdc tp @ 200 sl @ 85";
    const intent = parseTradeIntent(text);
    const again = parseTradeIntent(formatIntent(intent));
    assert.deepEqual(again, intent);
  });
});

describe("extractTriggers / parseTriggerOnly", () => {
  it("reads both triggers from leftover text", () => {
    assert.deepEqual(extractTriggers("sl @ 85 tp @ 200"), { tpPrice: 200, slPrice: 85 });
    assert.deepEqual(extractTriggers("take profit @ 4,200 stop loss 3,800"), {
      tpPrice: 4200,
      slPrice: 3800,
    });
  });

  it("parses follow-up SL / TP lines", () => {
    assert.deepEqual(parseTriggerOnly("sl @ 85"), { slPrice: 85 });
    assert.deepEqual(parseTriggerOnly("sl@85"), { slPrice: 85 });
    assert.deepEqual(parseTriggerOnly("sl 85"), { slPrice: 85 });
    assert.deepEqual(parseTriggerOnly("stop @ 85"), { slPrice: 85 });
    assert.deepEqual(parseTriggerOnly("stop-loss @ 85"), { slPrice: 85 });
    assert.deepEqual(parseTriggerOnly("tp @ 200"), { tpPrice: 200 });
    assert.deepEqual(parseTriggerOnly("take-profit @ 200"), { tpPrice: 200 });
    assert.equal(parseTriggerOnly("long sol 10x 50 usdc"), null);
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
    const trade = tryParse("long sol 10x 50 usdc tp @ 200 sl @ 85");
    assert.equal(trade?.kind, "trade");
    if (trade?.kind === "trade") assert.equal(trade.intent.slPrice, 85);
    const close = tryParse("close sol");
    assert.equal(close?.kind, "close");
    assert.equal(tryParse("what is btc"), null);
  });
});
