# CairoBot

Private perps on Extended through the live STRK20 pool.

One engine. Three skins: Telegram, CLI, MCP (OpenClaw / Hermes).

long sol 10x 50 usdc tp @ 200 sl @ 140

Same intent from a message, a terminal, or an agent tool call.

What this is

A trading desk that does not start from a public wallet on a public book.

Shield USDC into the STRK20 pool.
MarginRouter.privacy_invoke moves that value to Extended (FundMargin) or back to an open note (SweepPnL).
The order hits Extended mainnet.
You see a preview, then you confirm.

Inspired by IDEA-02 — private perpetuals behind one account.

What is private (and what is not)

| Public | Private |
| --- | --- |
| Shield: depositor, token, amount | Note-to-note transfers: parties and amounts |
| Helper sandwich size and timing | Which note funded the helper |
| Extended fill, size, and funding once it hits the book | Who initiated the pool → helper payment |

Shielding is a public deposit. Do not claim amount privacy on the perp. Claim identity privacy: the pool paid the helper, not “this Telegram user longed SOL.”

Repo

src/core/            intent, risk, engine, privacy, Extended client
src/adapters/        cli.ts · mcp.ts · telegram.ts
cairo/               MarginRouter — one helper, two ops
strk20.json          mainnet hashes the judges read

Telegram, CLI, and MCP never talk to the pool or Extended directly. They call previewTrade / confirmTrade.

Quick start

git clone https://github.com/Alajemba-Paul/CairoBot
cd CairoBot
cp .env.example .env
npm i
npm test

Parse without sending anything:

npx tsx src/adapters/cli.ts parse "long sol 10x 50 usdc tp @ 200"

Preview against mainnet marks (--json for agents):

npx tsx src/adapters/cli.ts preview "short btc 5x 20 usdc" --json
npx tsx src/adapters/cli.ts confirm 
npx tsx src/adapters/cli.ts positions
npx tsx src/adapters/cli.ts privacy

Telegram:

set BOT_TOKEN in .env
npm run dev:telegram

Then /start, or just type the sentence above. Buttons fill the same TradeIntent. Reply CONFIRM or tap it.

MCP / OpenClaw / Hermes

Five tools: preview_trade, confirm_trade, list_positions, close_position, privacy_status.

OpenClaw:

mcp: {
  servers: {
    cairobot: {
      command: "npx",
      args: ["tsx", "src/adapters/mcp.ts"],
    },
  },
}

Hermes (~/.hermes/config.yaml):

mcp_servers:
  cairobot:
    command: npx
    args: ["tsx", "src/adapters/mcp.ts"]

Confirm is a separate call from preview. Treat leverage ≥ 20x as needing a human.

Environment

See .env.example. Mainnet defaults:

NETWORK=mainnet
CHAIN_ID=SN_MAIN
RPC_URL=https://rpc.starknet.lava.build
POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
EXTENDED_API_BASE=https://api.starknet.extended.exchange

HELPER_ADDRESS — deployed MarginRouter
EXTENDED_COLLATERAL — Extended deposit contract; 0x0 still invokes the helper and returns USDC as an open note
OPERATOR_ADDRESS / OPERATOR_PRIVATE_KEY — CLI / agent desk only. Never reuse this key for Telegram users
BOT_TOKEN — Telegram skin only. CLI and MCP run without it

Mainnet checklist

Prizes need three successful pool-touching txs in strk20.json.

Deploy cairo/MarginRouter, set HELPER_ADDRESS.
Viewing key set.
Shield USDC.
Private note-to-note (even $1).
privacy_invoke FundMargin or SweepPnL.
Wire sendPoolCall in src/core/privacy.ts to Ready / Xverse Wallet API or the Privacy SDK. Until that session exists, confirm fails closed instead of faking a hash.
Fill strk20.json:

{
  "transactions": ["0x…", "0x…", "0x…"],
  "contracts": ["0x…MarginRouter"],
  "demo_video": "https://youtu.be/…",
  "demo_url": ""
}

Design rules

One Cairo contract. Two ops. No general router — Jalin already exists.
No shared signer across Telegram users.
No AI price suggestions. Absolute TP/SL only.
Preview expires in 60 seconds.
Fat-finger card always shows notional, est. liq, leverage warning, and the public/private split.

License

MIT
`
