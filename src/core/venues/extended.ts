import { EXTENDED_API, EXTENDED_API_KEY, MARKETS } from "../../config.ts";
import type { Market, Position, Side, TradeIntent } from "../types.ts";

export type MarkSnapshot = {
  market: Market;
  markPrice: number;
  indexPrice: number;
  lastPrice: number;
  fundingRate: number;
  dailyChangePct: number;
  fetchedAt: number;
};

const PRICE_TTL_MS = 10_000;
const priceCache = new Map<string, MarkSnapshot>();

export function clearPriceCache(): void {
  priceCache.clear();
}

function apiRoot(): string {
  return EXTENDED_API.replace(/\/$/, "") + "/api/v1";
}

async function extendedGet<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "CairoBot/2.0",
  };
  if (EXTENDED_API_KEY) headers["X-Api-Key"] = EXTENDED_API_KEY;
  if (init?.headers) Object.assign(headers, init.headers);

  const response = await fetch(`${apiRoot()}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Extended ${response.status} ${path} ${body.slice(0, 180)}`);
  }
  return (await response.json()) as T;
}

type StatsPayload = {
  status?: string;
  data?: {
    markPrice?: string;
    indexPrice?: string;
    lastPrice?: string;
    fundingRate?: string;
    dailyPriceChangePercentage?: string;
  };
};

type MarketsPayload = {
  status?: string;
  data?: Array<{
    name: string;
    marketStats?: {
      markPrice?: string;
      indexPrice?: string;
      lastPrice?: string;
      fundingRate?: string;
      dailyPriceChangePercentage?: string;
    };
  }>;
};

function num(value: string | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function fetchMarkPrice(market: Market): Promise<MarkSnapshot> {
  const now = Date.now();
  const cached = priceCache.get(market);
  if (cached && now - cached.fetchedAt < PRICE_TTL_MS) return cached;

  const payload = await extendedGet<StatsPayload>(
    `/info/markets/${encodeURIComponent(market)}/stats`,
  );
  const stats = payload.data ?? {};
  const snapshot: MarkSnapshot = {
    market,
    markPrice: num(stats.markPrice),
    indexPrice: num(stats.indexPrice),
    lastPrice: num(stats.lastPrice),
    fundingRate: num(stats.fundingRate),
    dailyChangePct: num(stats.dailyPriceChangePercentage),
    fetchedAt: Date.now(),
  };
  if (snapshot.markPrice <= 0) {
    throw new Error(`Extended returned no mark for ${market}`);
  }
  priceCache.set(market, snapshot);
  return snapshot;
}

export async function fetchAllMarks(): Promise<MarkSnapshot[]> {
  try {
    const query = MARKETS.map((m) => `market=${encodeURIComponent(m)}`).join("&");
    const payload = await extendedGet<MarketsPayload>(`/info/markets?${query}`);
    const rows = payload.data ?? [];
    const now = Date.now();
    const out: MarkSnapshot[] = [];
    for (const market of MARKETS) {
      const row = rows.find((r) => r.name === market);
      const stats = row?.marketStats;
      if (!stats?.markPrice) continue;
      const snapshot: MarkSnapshot = {
        market,
        markPrice: num(stats.markPrice),
        indexPrice: num(stats.indexPrice),
        lastPrice: num(stats.lastPrice),
        fundingRate: num(stats.fundingRate),
        dailyChangePct: num(stats.dailyPriceChangePercentage),
        fetchedAt: now,
      };
      if (snapshot.markPrice > 0) {
        priceCache.set(market, snapshot);
        out.push(snapshot);
      }
    }
    if (out.length === MARKETS.length) return out;
  } catch {
    /* fall through to per-market stats */
  }
  return Promise.all(MARKETS.map((m) => fetchMarkPrice(m)));
}

export type UnsignedOrder = {
  id: string;
  market: Market;
  type: "MARKET";
  side: "BUY" | "SELL";
  qty: string;
  price: string;
  timeInForce: "IOC";
  reduceOnly?: boolean;
  takeProfit?: { triggerPrice: string; triggerPriceType: "MARK"; priceType: "MARKET" };
  stopLoss?: { triggerPrice: string; triggerPriceType: "MARK"; priceType: "MARKET" };
};

export function buildUnsignedOrder(
  intent: TradeIntent,
  markPrice: number,
  reduceOnly = false,
): UnsignedOrder {
  const qty = (intent.marginUsdc * intent.leverage).toFixed(2);
  const order: UnsignedOrder = {
    id: crypto.randomUUID(),
    market: intent.market,
    type: "MARKET",
    side: intent.side === "LONG" ? "BUY" : "SELL",
    qty,
    price: markPrice.toFixed(8),
    timeInForce: "IOC",
  };
  if (reduceOnly) order.reduceOnly = true;
  if (intent.tpPrice !== undefined) {
    order.takeProfit = {
      triggerPrice: String(intent.tpPrice),
      triggerPriceType: "MARK",
      priceType: "MARKET",
    };
  }
  if (intent.slPrice !== undefined) {
    order.stopLoss = {
      triggerPrice: String(intent.slPrice),
      triggerPriceType: "MARK",
      priceType: "MARKET",
    };
  }
  return order;
}

type RawPosition = {
  market?: string;
  side?: string;
  size?: string;
  margin?: string;
  leverage?: string;
  openPrice?: string;
  markPrice?: string;
  liquidationPrice?: string;
  unrealisedPnl?: string;
  tpTriggerPrice?: string;
  slTriggerPrice?: string;
};

export async function fetchPositions(owner: string, market?: Market): Promise<Position[]> {
  if (!EXTENDED_API_KEY) return [];
  const params = new URLSearchParams();
  if (market) params.set("market", market);
  const qs = params.toString();
  const payload = await extendedGet<{ data?: RawPosition[] }>(
    `/user/positions${qs ? `?${qs}` : ""}`,
    { headers: { "X-Wallet-Address": owner } },
  );
  return (payload.data ?? [])
    .filter((row) => (MARKETS as readonly string[]).includes(row.market ?? ""))
    .map((row) => ({
      owner,
      market: row.market as Market,
      side: (row.side === "SHORT" ? "SHORT" : "LONG") as Side,
      size: row.size ?? "0",
      marginUsdc: row.margin ?? "0",
      leverage: row.leverage ?? "0",
      openPrice: row.openPrice ?? "0",
      markPrice: row.markPrice ?? "0",
      liquidationPrice: row.liquidationPrice ?? "0",
      unrealisedPnl: row.unrealisedPnl ?? "0",
      tpTriggerPrice: row.tpTriggerPrice,
      slTriggerPrice: row.slTriggerPrice,
    }));
}

export async function placeOrder(_order: UnsignedOrder): Promise<{ id: string } | null> {
  // Orders require a Stark settlement signature from a live wallet session.
  // The engine refuses to post an unsigned order or invent an id.
  return null;
}
