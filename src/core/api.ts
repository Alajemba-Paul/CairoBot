import { createServerFn } from "@tanstack/react-start";
import { MARKETS } from "../config.ts";
import { closePosition, confirmTrade, listPositions, previewFromText, previewTrade, privacyStatus } from "./engine.ts";
import { parseCloseIntent, parseTradeIntent, tryParse } from "./intent.ts";
import { fetchAllMarks } from "./venues/extended.ts";
import type { Market, TradeIntent } from "./types.ts";

export const parseFn = createServerFn({ method: "POST" })
  .validator((d: { text: string; owner?: string }) => d)
  .handler(async ({ data }) => {
    const parsed = tryParse(data.text, data.owner ?? "web");
    if (!parsed) {
      return { ok: false as const, error: "could not parse. Try: long sol 10x 50 usdc tp @ 200" };
    }
    return { ok: true as const, parsed };
  });

export const previewFn = createServerFn({ method: "POST" })
  .validator((d: { text?: string; intent?: TradeIntent; owner?: string }) => d)
  .handler(async ({ data }) => {
    try {
      const owner = data.owner ?? data.intent?.owner ?? "web";
      const intent =
        data.intent ?? parseTradeIntent(data.text ?? "", owner);
      const preview = await previewTrade(intent);
      return { ok: true as const, preview };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const confirmFn = createServerFn({ method: "POST" })
  .validator((d: { previewId: string }) => d)
  .handler(async ({ data }) => {
    try {
      const receipt = await confirmTrade(data.previewId, { session: null, adapter: "web" });
      return { ok: true as const, receipt };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const positionsFn = createServerFn({ method: "POST" })
  .validator((d: { owner?: string }) => d)
  .handler(async ({ data }) => listPositions(data.owner ?? "web"));

export const closeFn = createServerFn({ method: "POST" })
  .validator((d: { owner?: string; market: Market; text?: string }) => d)
  .handler(async ({ data }) => {
    try {
      const owner = data.owner ?? "web";
      const intent = data.text
        ? parseCloseIntent(data.text, owner)
        : { owner, market: data.market };
      const result = await closePosition(intent, { session: null, adapter: "web" });
      return { ok: true as const, result };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const privacyFn = createServerFn({ method: "POST" })
  .validator((d: { owner?: string }) => d)
  .handler(async ({ data }) => privacyStatus(data.owner ?? "web", null));

export const marksFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return { ok: true as const, marks: await fetchAllMarks() };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err), marks: [] };
  }
});

export const previewTextFn = createServerFn({ method: "POST" })
  .validator((d: { text: string; owner?: string }) => d)
  .handler(async ({ data }) => {
    try {
      const preview = await previewFromText(data.text, data.owner ?? "web");
      return { ok: true as const, preview };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

export { MARKETS };
