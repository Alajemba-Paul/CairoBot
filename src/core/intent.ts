import { MARKETS, ParseError, type CloseIntent, type Market, type TradeIntent } from "./types.ts";

/**
 * Natural-language parser. Same TradeIntent for Telegram, CLI, MCP, and the desk.
 * Keep the original regex idea from v1; do not invent a new command language.
 *
 *   long sol 10x 50 usdc tp @ 200
 *   short btc 50x with 2000 margin tp @ 92000 sl @ 85000
 *   close my sol position
 */
const NL_OPEN =
  /(long|short)\s+([a-zA-Z]+)\s+(\d+(?:\.\d+)?)x(?:\s+with)?\s+(\d+(?:\.\d+)?)\s+(?:usdc|margin)/i;

const NL_CLOSE = /close\s+(?:my\s+)?([a-zA-Z]+)(?:\s+position)?/i;

const TP_RE = /(?:take[\s-]*profit|\btp)\s*@?\s*([\d,]+(?:\.\d+)?)/i;
const SL_RE = /(?:stop[\s-]*loss|\bsl|\bstop)\s*@?\s*([\d,]+(?:\.\d+)?)/i;
const TP_ONLY = /^(?:take[\s-]*profit|\btp)\s*@?\s*([\d,]+(?:\.\d+)?)$/i;
const SL_ONLY = /^(?:stop[\s-]*loss|\bsl|\bstop)\s*@?\s*([\d,]+(?:\.\d+)?)$/i;

export function normalizeMarket(raw: string): Market {
  const token = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  const candidate = token.endsWith("USD") ? `${token.slice(0, -3)}-USD` : `${token}-USD`;
  if ((MARKETS as readonly string[]).includes(candidate)) {
    return candidate as Market;
  }
  throw new ParseError(`unknown market "${raw}". Use ${MARKETS.join(", ")}`);
}

function parsePrice(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function extractTriggers(text: string): { tpPrice?: number; slPrice?: number } {
  const tpPrice = parsePrice(text.match(TP_RE)?.[1]);
  const slPrice = parsePrice(text.match(SL_RE)?.[1]);
  const out: { tpPrice?: number; slPrice?: number } = {};
  if (tpPrice !== undefined) out.tpPrice = tpPrice;
  if (slPrice !== undefined) out.slPrice = slPrice;
  return out;
}

/** `sl @ 85` / `tp @ 200` as a follow-up on an existing draft. */
export function parseTriggerOnly(text: string): { tpPrice?: number; slPrice?: number } | null {
  const trimmed = text.trim();
  const tp = trimmed.match(TP_ONLY);
  if (tp) return { tpPrice: parsePrice(tp[1]) };
  const sl = trimmed.match(SL_ONLY);
  if (sl) return { slPrice: parsePrice(sl[1]) };
  return null;
}

export function parseTradeIntent(text: string, owner = "cli"): TradeIntent {
  const cleaned = text.trim();
  const match = cleaned.match(NL_OPEN);
  if (!match) {
    throw new ParseError(
      'could not parse trade. Try: long sol 10x 50 usdc tp @ 200 sl @ 85',
    );
  }

  const side = match[1].toUpperCase() as "LONG" | "SHORT";
  const market = normalizeMarket(match[2]);
  const leverage = Number(match[3]);
  const marginUsdc = Number(match[4]);
  const { tpPrice, slPrice } = extractTriggers(cleaned);

  if (!Number.isFinite(leverage) || leverage < 1 || leverage > 100) {
    throw new ParseError("leverage must be between 1x and 100x");
  }
  if (!Number.isFinite(marginUsdc) || marginUsdc <= 0) {
    throw new ParseError("margin must be a positive USDC amount");
  }
  if (tpPrice !== undefined && !(tpPrice > 0)) {
    throw new ParseError("take-profit must be an absolute price > 0");
  }
  if (slPrice !== undefined && !(slPrice > 0)) {
    throw new ParseError("stop-loss must be an absolute price > 0");
  }

  const intent: TradeIntent = {
    owner,
    market,
    side,
    leverage,
    marginUsdc,
  };
  if (tpPrice !== undefined) intent.tpPrice = tpPrice;
  if (slPrice !== undefined) intent.slPrice = slPrice;
  return intent;
}

export function parseCloseIntent(text: string, owner = "cli"): CloseIntent {
  const match = text.trim().match(NL_CLOSE);
  if (!match) {
    throw new ParseError('could not parse close. Try: close my sol position');
  }
  return { owner, market: normalizeMarket(match[1]) };
}

export function tryParse(text: string, owner = "cli"): { kind: "trade"; intent: TradeIntent } | { kind: "close"; intent: CloseIntent } | null {
  try {
    return { kind: "trade", intent: parseTradeIntent(text, owner) };
  } catch {
    /* fall through */
  }
  try {
    return { kind: "close", intent: parseCloseIntent(text, owner) };
  } catch {
    return null;
  }
}

export function formatIntent(intent: TradeIntent): string {
  const bits = [
    intent.side.toLowerCase(),
    intent.market.replace("-USD", "").toLowerCase(),
    `${intent.leverage}x`,
    `${intent.marginUsdc} usdc`,
  ];
  if (intent.tpPrice !== undefined) bits.push(`tp @ ${intent.tpPrice}`);
  if (intent.slPrice !== undefined) bits.push(`sl @ ${intent.slPrice}`);
  return bits.join(" ");
}
