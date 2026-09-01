/** Public mainnet constants. Safe to import from the browser. */
export const SN_MAIN = {
  NETWORK: "mainnet",
  CHAIN_ID: "SN_MAIN",
  RPC_URL: "https://rpc.starknet.lava.build",
  POOL: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  EXTENDED_API: "https://api.starknet.extended.exchange",
  EXTENDED_VENUE: "0x062da0780fae50d68cecaa5a051606dc21217ba290969b302db4dd99d2e9b470",
} as const;

export const REPO_URL = "https://github.com/Alajemba-Paul/CairoBot";
export const REPO_BRANCH = "main";

/** Public desk + bot username. Never put BOT_TOKEN here. */
export const PUBLIC_DESK_URL = "https://cairobot.vercel.app";
export const PUBLIC_TELEGRAM_BOT = "cairov2_bot";
