# CairoBot

**Private perps on Extended, from chat, CLI, or an agent.**

One engine. Three skins: Telegram NL, CLI, MCP (OpenClaw / Hermes). Collateral moves through the live STRK20 pool. Identity stays off the book. Built for the Starknet STRK20 Privacy Sprint (IDEA-02).

```
Telegram | CLI | MCP | web desk
              \  |  /
            engine.ts
            /        \
     privacy.ts     venues/extended.ts
        |                  |
     STRK20 pool      Extended mainnet CLOB
        |
     MarginRouter.privacy_invoke
       op=0 FundMargin
       op=1 SweepPnl
```

## What is actually private

| Visible on-chain | Not published |
| --- | --- |
| Shield depositor, token, and amount | Note-to-note parties and amounts |
| Helper size and timing | Which note funded the helper |
| The Extended fill once it hits the book | Who initiated pool → helper |

Never “amount-private perps.” Extended fills are public. This is not a new ZK scheme — it is STRK20 notes plus one `privacy_invoke` helper.

## Clone, test, parse (no env)

```bash
git clone https://github.com/Alajemba-Paul/CairoBot.git
cd CairoBot && git checkout main
npm install
npm test
npm run cli -- parse "long sol 10x 50 usdc tp @ 200 sl @ 85"
```

`parse` uses the NL regex only. It does not need `BOT_TOKEN`, a key, or RPC.

Preview hits Extended **mainnet** marks:

```bash
npm run cli -- preview "long sol 10x 50 usdc tp @ 200 sl @ 85"
```

Confirm is fail-closed:

```bash
npm run cli -- confirm pv_deadbeef
# no wallet session
```

Never a fake transaction hash. Ready or Xverse (Wallet API) must attach `WalletAccountV6.strk20InvokeTransaction`. The CLI/agent desk may use `OPERATOR_ADDRESS` / `OPERATOR_PRIVATE_KEY` as an address hint only — that key cannot sign STRK20. Telegram never reads it.

## Web desk + wallet

Wallet connect does **not** defeat the product. Ready / Xverse is the intended confirm path. The viewing key stays in the wallet. The desk never holds a key.

Embedded previews (Grok iframe, some mobile in-app browsers) cannot see wallet extensions. In that case the desk reroutes:

- **Telegram** deep link (`VITE_TELEGRAM_BOT`) — NL + fat-finger. Reply `CONFIRM` still fail-closes and points back to the desk to sign.
- **CLI / MCP copy-paste** on the desk — the agent path.

Open the Vercel URL in a normal browser with Ready or Xverse installed to sign `privacy_invoke`.

## Core API

Adapters call only these:

```ts
previewTrade(intent) -> Preview      // 60s ttl, no funds
confirmTrade(previewId) -> Receipt   // fund helper, then place order
listPositions(owner)
closePosition({ owner, market })     // reduce-only, then SweepPnl
privacyStatus(owner)
```

`TradeIntent`: `{ owner, market, side, leverage, marginUsdc, tpPrice?, slPrice? }`

Markets: `BTC-USD ETH-USD SOL-USD STRK-USD`.

## MCP (OpenClaw / Hermes)

Five tools: `preview_trade`, `confirm_trade`, `list_positions`, `close_position`, `privacy_status`.

Leverage ≥ 20 requires `confirmHighLeverage: true` on `confirm_trade`.

**OpenClaw** (`~/.openclaw/mcp.json` or project config):

```json
{
  "mcpServers": {
    "cairobot": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/adapters/mcp.ts"],
      "cwd": "/path/to/CairoBot"
    }
  }
}
```

**Hermes**:

```json
{
  "servers": {
    "cairobot": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/adapters/mcp.ts"]
    }
  }
}
```

Confirm still needs a Wallet API session. MCP will not invent a hash.

## Telegram

Live bot: [t.me/cairov2_bot](https://t.me/cairov2_bot). Desk: [cairobot.vercel.app](https://cairobot.vercel.app).

Type `long sol 10x 50 usdc tp @ 200 sl @ 85` or tap buttons that **only** fill a `TradeIntent`. Missing SL prints `SL UNSET` — reply `sl @ 85`. Reply `CONFIRM`. Commands: `/positions` `/privacy` `/cancel`. No in-bot key cache. No shared `EXTENDED_STARK_PRIVATE_KEY`. Signing is Ready / Xverse on the desk.

```bash
# long-poll (Railway / Fly / this host)
BOT_TOKEN=... DESK_URL=https://cairobot.vercel.app npm run telegram
```

Durable option: set `BOT_TOKEN` on the Vercel project (server-only, never `VITE_`), then:

```
POST https://cairobot.vercel.app/api/telegram
setWebhook url=https://cairobot.vercel.app/api/telegram
```

## MarginRouter

One helper. Caller must be the STRK20 pool. Measures the ERC-20 balance the pool already sent. One `privacy_invoke` per tx (Starknet selectors are name-only — there is no second entry point). End token balance is 0. Does not transfer to the user.

```
privacy_invoke(op, token, amount, note_id, venue, user) -> Span<OpenNoteDeposit>
```

- `op=0 FundMargin` — if `venue != 0`, approve + `deposit(user, spend)`; leftover → `OpenNoteDeposit`. If venue is 0, approve the full balance back to the pool (valid first pool tx).
- `op=1 SweepPnl` — approve the full helper balance to the pool as one open note.
- `amount` is u256 in calldata so the wallet knows the spend. `0` means “everything the pool sent”.
- `note_id` is the Wallet API placeholder `${openNoteIds[0]}` — never a timestamp.

Desk / CLI / MCP hand Ready or Xverse **two actions in one tx**:

1. `transfer` with `amount: "OPEN"` (leftover / SweepPnl slot)
2. `invoke` `MarginRouter` with the calldata above

Telegram never signs. Reply `CONFIRM` fail-closes and sends the desk URL.

`OpenNoteDeposit { note_id, token, amount: u128 }` matches starter-kit positional Serde.

## Ship it (mainnet)

The web desk and Telegram NL path are live. **Confirm still fails closed until MarginRouter is declared on SN_MAIN.** That is the remaining mainnet step, and it needs *your* Ready/Braavos deployer — this bot never holds a key.

### 1. Deploy MarginRouter on SN_MAIN

Pool (constructor arg): `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

```bash
cd cairo && scarb build
# Account must already exist on SN_MAIN and hold STRK for fees.
starkli declare target/dev/margin_router_MarginRouter.contract_class.json --network mainnet
starkli deploy <CLASS_HASH> \
  0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a \
  --network mainnet
```

Then set `MARGIN_ROUTER` and `VITE_MARGIN_ROUTER` to the deployed address (Vercel env + any bot host). Empty helper = confirm fails closed (honest).

### 2. Web desk

[cairobot.vercel.app](https://cairobot.vercel.app) — Connect Ready / Xverse, preview live Extended marks, sign `privacy_invoke`. Open it **outside** an iframe.

### 3. Telegram

[t.me/cairov2_bot](https://t.me/cairov2_bot). `CONFIRM` never auto-signs; it sends the desk URL.

### 4. Agentic flow (MCP)

```bash
git clone https://github.com/Alajemba-Paul/CairoBot.git && cd CairoBot
npm install
# drop the OpenClaw / Hermes snippet above into mcp.json
# tools: preview_trade, confirm_trade, list_positions, close_position, privacy_status
```

`preview_trade` works with no key. `confirm_trade` fails closed until a Wallet API session is attached.

### 5. Record real pool txs

Shield USDC, note-to-note, helper invoke. Put ≥ 3 real SN_MAIN hashes in `strk20.json`. Do not invent them.

## Mainnet checklist

1. Network is `SN_MAIN`. Default RPC `https://rpc.starknet.lava.build`.
2. Pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`.
3. USDC `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8` — **not** ETH.
4. Deploy `MarginRouter` with the pool as constructor arg. Set `MARGIN_ROUTER`.
5. Shield USDC into the pool (Ready / Xverse viewing key stays in the wallet).
6. `preview` → `confirm` with a Wallet API session. That `privacy_invoke` is a pool-touching tx.
7. Record viewing-key setup, shield, note-to-note, and helper invoke in `strk20.json`. Do not invent hashes.

## Constants

```
NETWORK=mainnet
CHAIN_ID=SN_MAIN
RPC_URL=https://rpc.starknet.lava.build
POOL=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
USDC=0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8
EXTENDED_API=https://api.starknet.extended.exchange
```

## License

MIT
