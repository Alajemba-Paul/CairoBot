import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTradeIntent } from "./intent.ts";
import { buildPreviewMath, formatPreviewCard } from "./risk.ts";
import type { Preview } from "./types.ts";

function card(text: string): string {
  const intent = parseTradeIntent(text);
  const preview = buildPreviewMath(intent, 150, 150, "pv_test", 1) as Preview;
  preview.expiresAt = 61_000;
  return formatPreviewCard(preview);
}

describe("formatPreviewCard", () => {
  it("prints SL when present", () => {
    const out = card("long sol 10x 50 usdc tp @ 200 sl @ 85");
    assert.match(out, /TP\s+\$200/);
    assert.match(out, /SL\s+\$85/);
    assert.doesNotMatch(out, /SL\s+UNSET/);
  });

  it("prints SL UNSET and a warning when missing", () => {
    const out = card("long sol 10x 50 usdc tp @ 200");
    assert.match(out, /SL\s+UNSET/);
    assert.match(out, /No stop-loss/);
    assert.match(out, /reply\s+sl @ PRICE/i);
  });
});
