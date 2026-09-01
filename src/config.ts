import { SN_MAIN } from "./core/constants.ts";

/**
 * CairoBot v2 — Starknet mainnet defaults.
 * Never required at import time. Telegram is the only adapter that
 * needs BOT_TOKEN, and it checks that itself. CLI `parse` works with no env.
 */

function readEnv(key: string, fallback = ""): string {
  try {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Hard ban: this is ETH on Starknet, not STRK20. Never use it as the pool. */
export const ETH_NOT_STRK20 =
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

export const NETWORK = readEnv("NETWORK", SN_MAIN.NETWORK);
export const CHAIN_ID = readEnv("CHAIN_ID", SN_MAIN.CHAIN_ID);
export const RPC_URL = readEnv("RPC_URL", SN_MAIN.RPC_URL);
export const POOL = readEnv("POOL", SN_MAIN.POOL);
export const USDC = readEnv("USDC", SN_MAIN.USDC);
export const EXTENDED_API = readEnv("EXTENDED_API", SN_MAIN.EXTENDED_API);
export const EXTENDED_VENUE = readEnv("EXTENDED_VENUE", SN_MAIN.EXTENDED_VENUE);
export const MARGIN_ROUTER = readEnv("MARGIN_ROUTER", readEnv("VITE_MARGIN_ROUTER", ""));
export const EXTENDED_API_KEY = readEnv("EXTENDED_API_KEY", "");
export const OPERATOR_ADDRESS = readEnv("OPERATOR_ADDRESS", "");
export const OPERATOR_PRIVATE_KEY = readEnv("OPERATOR_PRIVATE_KEY", "");
export const BOT_TOKEN = readEnv("BOT_TOKEN", "");
export const DESK_URL = readEnv("DESK_URL", readEnv("VITE_DESK_URL", ""));
export const TELEGRAM_BOT = readEnv("VITE_TELEGRAM_BOT", "");

export const MARKETS = ["BTC-USD", "ETH-USD", "SOL-USD", "STRK-USD"] as const;
export type Market = (typeof MARKETS)[number];

export const PREVIEW_TTL_MS = 60_000;
export const HIGH_LEVERAGE_WARN = 50;
export const MCP_LEVERAGE_CONFIRM = 20;

export function assertNotEthAsStrk20(address: string): void {
  if (address.toLowerCase() === ETH_NOT_STRK20.toLowerCase()) {
    throw new Error("refusing ETH address as STRK20 — that is ETH, not the pool");
  }
}

export const config = {
  NETWORK,
  CHAIN_ID,
  RPC_URL,
  POOL,
  USDC,
  EXTENDED_API,
  EXTENDED_VENUE,
  MARGIN_ROUTER,
  EXTENDED_API_KEY,
  MARKETS,
  PREVIEW_TTL_MS,
  HIGH_LEVERAGE_WARN,
  MCP_LEVERAGE_CONFIRM,
  DESK_URL,
};
