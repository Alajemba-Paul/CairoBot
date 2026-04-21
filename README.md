# CairoBot

**Simple. Private. On-chain perps trading on Extended via Telegram.**

CairoBot is a simple Telegram bot for trading perpetuals on **Extended** — the hyper-performant perp DEX on Starknet.

- Type natural language commands or use the clean button-guided flow.
- All margin is **shielded by default** using StarkZap (confidential transfers / STRK20 privacy).
- Currently built and tested on **Starknet Sepolia testnet** (ready for StarkZap bounty submissions and safe testing).
- Core principles: **Simplicity + Privacy**. No AI suggestions, absolute prices only for TP/SL, fat-finger protection built-in.

## Features

### Natural Language Mode (one-shot)
- `long sol 20x 500 usdc tp @ 90 sl @ 85`
- `short btc 50x with 2000 margin tp @ 92000 sl @ 85000`
- `close my sol position`

### Strict Button-Driven Guided Flow (`/long` or `/short`)
- Inline keyboard: BIG GREEN **LONG** | BIG RED **SHORT** buttons
- Choose market from 4 demo perps: **BTC-USD**, **ETH-USD**, **SOL-USD**, **STRK-USD**
- Leverage presets: 5x | 10x | 20x | 50x | 100x | Custom
- Shielded capital presets (USDC): 100 | 500 | 1000 | 5000 | Custom
- Enter absolute **TP price** (or skip)
- Enter absolute **SL price** (or skip)
- Final preview card → reply exactly **`CONFIRM`** to execute

### Other Commands
- `/positions` — View your open positions (shielded)
- `/close SOL` — Market close a position
- `/tp SOL @ 95` — Update take-profit
- `/sl BTC @ 82000` — Update stop-loss
- `/cancel` — Abort current wizard or flow

**Privacy-first**: Margin uses StarkZap confidential/shielded transfers. Your collateral and position details stay private where possible on explorers.

**Fat-finger protection**: Every order shows notional size, estimated liquidation price, high-leverage warning (>50x), and a clear privacy note before you confirm.

## Tech Stack

- Node.js + TypeScript
- Telegraf (Telegram bot with inline keyboards & callback queries)
- StarkZap SDK (onboarding via Privy/Cartridge, shielded wallet, gasless where possible)
- Extended testnet API for order placement (including conditional TP/SL)
- Deployable on Railway or Render (free tier works perfectly)

## Quick Start (Local)

1. Clone the repo:
   ```bash
   git clone https://github.com/Alajemba-Paul/CairoBot.git
   cd CairoBot
