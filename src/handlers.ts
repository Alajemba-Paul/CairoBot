import { Telegraf, Markup, Context } from 'telegraf';
import { WizardState, WizardStep, OrderDetails, Side } from './types';
import { DEMO_MARKETS, formatPreviewCard } from './utils';
import { parseNaturalLanguageOrder, parseCloseIntent } from './parser';
import { starkZap } from './starkzap';
import {
  buildOrderPayload,
  fetchMarkPrice,
  fetchPositions,
  placeOrder,
  serializeOrder,
} from './extended';
import { withRetry } from './retry';

// TODO: Replace Map with Redis for distributed production environments
const userState = new Map<number, WizardState>();

function clearState(userId: number) {
  userState.delete(userId);
}

// ---------------------------------------------------------------------------
// Supported markets for NL close validation
// ---------------------------------------------------------------------------
const SUPPORTED_MARKETS = new Set(DEMO_MARKETS);

// ---------------------------------------------------------------------------
// handleClose — /close <MARKET>
// ---------------------------------------------------------------------------
export async function handleClose(ctx: Context) {
  const userId = ctx.from!.id;
  const text = (ctx.message as { text?: string })?.text ?? '';
  // Extract market from command args: /close SOL  or  /close SOL-USD
  const parts = text.trim().split(/\s+/);
  let rawMarket = parts[1] ?? '';

  // Normalise: append -USD if not already present
  if (rawMarket && !rawMarket.includes('-')) {
    rawMarket = rawMarket.toUpperCase() + '-USD';
  } else {
    rawMarket = rawMarket.toUpperCase();
  }

  if (!rawMarket) {
    return ctx.reply('Usage: /close <MARKET>  e.g. /close SOL');
  }

  // Validate supported market
  if (!SUPPORTED_MARKETS.has(rawMarket)) {
    return ctx.reply(
      `Unsupported market. Supported markets: ${DEMO_MARKETS.join(', ')}.`
    );
  }

  // Ensure wallet exists and cache address
  let walletAddress: string;
  try {
    const wallet = await starkZap.getWallet(userId);
    walletAddress = wallet.address;
  } catch {
    return ctx.reply('Wallet provisioning failed. Please try again.');
  }

  // Fetch open position
  let positions;
  try {
    positions = await fetchPositions(walletAddress, rawMarket);
  } catch {
    return ctx.reply('Position data temporarily unavailable.');
  }

  if (!positions || positions.length === 0) {
    return ctx.reply(`No open position found for ${rawMarket}.`);
  }

  const position = positions[0];

  // Fetch current mark price for display
  let markPrice: number;
  try {
    markPrice = await fetchMarkPrice(rawMarket);
  } catch {
    return ctx.reply('Price feed unavailable. Please try again.');
  }

  const pnl = parseFloat(position.unrealisedPnl);
  const pnlStr = pnl >= 0 ? `+${pnl.toFixed(4)}` : pnl.toFixed(4);

  const prompt =
    `⚠️ **Close Position Confirmation**\n\n` +
    `Market: ${position.market}\n` +
    `Side: ${position.side}\n` +
    `Size: ${position.size}\n` +
    `Mark Price: ${markPrice.toFixed(4)}\n` +
    `Unrealized PnL: ${pnlStr} USDC\n\n` +
    `Reply exactly with **CONFIRM** to close this position, or /cancel to abort.`;

  userState.set(userId, {
    step: WizardStep.AWAIT_CLOSE_CONFIRM,
    order: {},
    walletAddress,
    closeMarket: rawMarket,
    closePosition: position,
  });

  return ctx.replyWithMarkdown(prompt);
}

// ---------------------------------------------------------------------------
// handleTp — /tp <MARKET> @ <PRICE>
// ---------------------------------------------------------------------------
export async function handleTp(ctx: Context) {
  const userId = ctx.from!.id;
  const text = (ctx.message as { text?: string })?.text ?? '';
  // Expected: /tp SOL @ 95  or  /tp SOL-USD @ 95
  const match = text.match(/^\/tp\s+([a-zA-Z0-9-]+)\s+@\s+(\S+)/i);
  if (!match) {
    return ctx.reply('Usage: /tp <MARKET> @ <PRICE>  e.g. /tp SOL @ 95');
  }

  let rawMarket = match[1].toUpperCase();
  if (!rawMarket.includes('-')) rawMarket += '-USD';

  const price = parseFloat(match[2]);
  if (!isFinite(price) || price <= 0) {
    return ctx.reply('Invalid price. Please enter a positive number.');
  }

  if (!SUPPORTED_MARKETS.has(rawMarket)) {
    return ctx.reply(
      `Unsupported market. Supported markets: ${DEMO_MARKETS.join(', ')}.`
    );
  }

  // Ensure wallet
  let walletAddress: string;
  try {
    const wallet = await starkZap.getWallet(userId);
    walletAddress = wallet.address;
  } catch {
    return ctx.reply('Wallet provisioning failed. Please try again.');
  }

  // Verify open position
  let positions;
  try {
    positions = await fetchPositions(walletAddress, rawMarket);
  } catch {
    return ctx.reply('Position data temporarily unavailable.');
  }

  if (!positions || positions.length === 0) {
    return ctx.reply(`No open position found for ${rawMarket}.`);
  }

  const position = positions[0];

  // Build and place conditional TP update order
  try {
    const markPrice = await fetchMarkPrice(rawMarket);
    const orderReq = serializeOrder(
      {
        market: rawMarket,
        side: position.side === 'LONG' ? 'LONG' : 'SHORT',
        leverage: parseFloat(position.leverage),
        margin: parseFloat(position.margin),
        tpPrice: price,
      },
      walletAddress,
      markPrice
    );
    // Override to conditional TP update
    orderReq.type = 'TPSL';
    orderReq.reduceOnly = true;
    if (orderReq.takeProfit) {
      orderReq.takeProfit.triggerPrice = price.toString();
      orderReq.takeProfit.price = price.toString();
    } else {
      orderReq.takeProfit = {
        triggerPrice: price.toString(),
        triggerPriceType: 'MARK',
        price: price.toString(),
        priceType: 'MARKET',
      };
    }

    await withRetry(() => placeOrder(orderReq));
    return ctx.reply(`✅ Take-profit updated to ${price} for ${rawMarket}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return ctx.reply(`❌ Failed to update TP: ${msg}\nPlease retry manually.`);
  }
}

// ---------------------------------------------------------------------------
// handleSl — /sl <MARKET> @ <PRICE>
// ---------------------------------------------------------------------------
export async function handleSl(ctx: Context) {
  const userId = ctx.from!.id;
  const text = (ctx.message as { text?: string })?.text ?? '';
  // Expected: /sl BTC @ 82000  or  /sl BTC-USD @ 82000
  const match = text.match(/^\/sl\s+([a-zA-Z0-9-]+)\s+@\s+(\S+)/i);
  if (!match) {
    return ctx.reply('Usage: /sl <MARKET> @ <PRICE>  e.g. /sl BTC @ 82000');
  }

  let rawMarket = match[1].toUpperCase();
  if (!rawMarket.includes('-')) rawMarket += '-USD';

  const price = parseFloat(match[2]);
  if (!isFinite(price) || price <= 0) {
    return ctx.reply('Invalid price. Please enter a positive number.');
  }

  if (!SUPPORTED_MARKETS.has(rawMarket)) {
    return ctx.reply(
      `Unsupported market. Supported markets: ${DEMO_MARKETS.join(', ')}.`
    );
  }

  // Ensure wallet
  let walletAddress: string;
  try {
    const wallet = await starkZap.getWallet(userId);
    walletAddress = wallet.address;
  } catch {
    return ctx.reply('Wallet provisioning failed. Please try again.');
  }

  // Verify open position
  let positions;
  try {
    positions = await fetchPositions(walletAddress, rawMarket);
  } catch {
    return ctx.reply('Position data temporarily unavailable.');
  }

  if (!positions || positions.length === 0) {
    return ctx.reply(`No open position found for ${rawMarket}.`);
  }

  const position = positions[0];

  // Build and place conditional SL update order
  try {
    const markPrice = await fetchMarkPrice(rawMarket);
    const orderReq = serializeOrder(
      {
        market: rawMarket,
        side: position.side === 'LONG' ? 'LONG' : 'SHORT',
        leverage: parseFloat(position.leverage),
        margin: parseFloat(position.margin),
        slPrice: price,
      },
      walletAddress,
      markPrice
    );
    // Override to conditional SL update
    orderReq.type = 'TPSL';
    orderReq.reduceOnly = true;
    if (orderReq.stopLoss) {
      orderReq.stopLoss.triggerPrice = price.toString();
      orderReq.stopLoss.price = price.toString();
    } else {
      orderReq.stopLoss = {
        triggerPrice: price.toString(),
        triggerPriceType: 'MARK',
        price: price.toString(),
        priceType: 'MARKET',
      };
    }

    await withRetry(() => placeOrder(orderReq));
    return ctx.reply(`✅ Stop-loss updated to ${price} for ${rawMarket}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return ctx.reply(`❌ Failed to update SL: ${msg}\nPlease retry manually.`);
  }
}

// ---------------------------------------------------------------------------
// setupHandlers
// ---------------------------------------------------------------------------
export function setupHandlers(bot: Telegraf) {

  // COMMANDS
  bot.command('cancel', (ctx) => {
    clearState(ctx.from.id);
    ctx.reply("Wizard cancelled and state cleared.");
  });

  bot.command('positions', async (ctx) => {
    const userId = ctx.from.id;
    let walletAddress: string;
    try {
      const wallet = await starkZap.getWallet(userId);
      walletAddress = wallet.address;
      // Cache wallet address in session
      const existing = userState.get(userId);
      if (existing) {
        existing.walletAddress = walletAddress;
      }
    } catch {
      return ctx.reply('Wallet provisioning failed. Please try again.');
    }

    let positions;
    try {
      positions = await fetchPositions(walletAddress);
    } catch {
      return ctx.reply('Position data temporarily unavailable.');
    }

    if (!positions || positions.length === 0) {
      return ctx.reply('No open positions found.');
    }

    const lines = positions.map((p) => {
      const pnl = parseFloat(p.unrealisedPnl);
      const pnlStr = pnl >= 0 ? `+${pnl.toFixed(4)}` : pnl.toFixed(4);
      return (
        `📌 ${p.market} ${p.side}\n` +
        `  Size: ${p.size}  Entry: ${p.openPrice}\n` +
        `  Mark: ${p.markPrice}  Liq: ${p.liquidationPrice}\n` +
        `  PnL: ${pnlStr} USDC`
      );
    });

    return ctx.reply(lines.join('\n\n'));
  });

  // New commands
  bot.command('close', handleClose);
  bot.command('tp', handleTp);
  bot.command('sl', handleSl);

  // STRICT GUIDED FLOW INITIATORS
  const startFlow = (ctx: Context, _side: Side) => {
    ctx.reply('Select an action to begin:', Markup.inlineKeyboard([
      Markup.button.callback('🟢 LONG', 'action_LONG'),
      Markup.button.callback('🔴 SHORT', 'action_SHORT'),
      Markup.button.callback('Cancel', 'cancel_flow')
    ]));
  };

  bot.command('long', (ctx) => startFlow(ctx, 'LONG'));
  bot.command('short', (ctx) => startFlow(ctx, 'SHORT'));

  // CALLBACK QUERIES (BUTTON CLICKS)
  bot.action('cancel_flow', (ctx) => {
    clearState(ctx.from!.id);
    ctx.editMessageText("Flow cancelled.");
  });

  bot.action(/action_(LONG|SHORT)/, (ctx) => {
    const side = ctx.match[1] as Side;
    userState.set(ctx.from!.id, { step: WizardStep.AWAIT_MARKET, order: { side } });

    const buttons = DEMO_MARKETS.map(m => Markup.button.callback(m, `market_${m}`));
    ctx.editMessageText(`You selected ${side}.\nChoose a market:`, Markup.inlineKeyboard(buttons, { columns: 2 }));
  });

  bot.action(/market_(.+)/, (ctx) => {
    const market = ctx.match[1];
    const state = userState.get(ctx.from!.id);
    if (!state) return ctx.reply("Session expired. Start over with /long or /short.");

    state.order.market = market;
    state.step = WizardStep.AWAIT_LEVERAGE;

    const levs = [5, 10, 20, 50, 100];
    const buttons = levs.map(l => Markup.button.callback(`${l}x`, `lev_${l}`));
    buttons.push(Markup.button.callback('Custom', 'lev_custom'));

    ctx.editMessageText(`Market: ${market}\nSelect Leverage:`, Markup.inlineKeyboard(buttons, { columns: 3 }));
  });

  bot.action(/lev_(\d+|custom)/, (ctx) => {
    const val = ctx.match[1];
    const state = userState.get(ctx.from!.id);
    if (!state) return;

    if (val === 'custom') {
      state.step = WizardStep.AWAIT_CUSTOM_LEVERAGE;
      ctx.editMessageText("Please type your custom leverage (e.g., 15):");
      return;
    }

    state.order.leverage = parseInt(val, 10);
    state.step = WizardStep.AWAIT_MARGIN;

    const caps = [100, 500, 1000, 5000];
    const buttons = caps.map(c => Markup.button.callback(`${c} USDC`, `cap_${c}`));
    buttons.push(Markup.button.callback('Custom', 'cap_custom'));

    ctx.editMessageText(`Leverage: ${val}x\nSelect Shielded Margin (USDC):`, Markup.inlineKeyboard(buttons, { columns: 2 }));
  });

  bot.action(/cap_(\d+|custom)/, (ctx) => {
    const val = ctx.match[1];
    const state = userState.get(ctx.from!.id);
    if (!state) return;

    if (val === 'custom') {
      state.step = WizardStep.AWAIT_CUSTOM_MARGIN;
      ctx.editMessageText("Please type your custom margin amount in USDC (e.g., 250):");
      return;
    }

    state.order.margin = parseFloat(val);
    state.step = WizardStep.AWAIT_TP;
    ctx.editMessageText(`Margin set to ${val} USDC.\n\nEnter absolute Take Profit price (or type 'skip'/'none'):`);
  });

  // TEXT INPUT HANDLERS
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    const state = userState.get(userId);

    // Natural Language Parsing and Confirmations
    if (!state || state.step === WizardStep.IDLE) {
      // Check NL close intent first
      const closeIntent = parseCloseIntent(text);
      if (closeIntent) {
        const market = closeIntent.market.includes('-')
          ? closeIntent.market
          : closeIntent.market + '-USD';

        if (!SUPPORTED_MARKETS.has(market)) {
          return ctx.reply(
            `Unsupported market. Supported markets: ${DEMO_MARKETS.join(', ')}.`
          );
        }

        // Synthesise a fake message context so handleClose can parse it
        // We inject the market directly into state instead
        let walletAddress: string;
        try {
          const wallet = await starkZap.getWallet(userId);
          walletAddress = wallet.address;
        } catch {
          return ctx.reply('Wallet provisioning failed. Please try again.');
        }

        let positions;
        try {
          positions = await fetchPositions(walletAddress, market);
        } catch {
          return ctx.reply('Position data temporarily unavailable.');
        }

        if (!positions || positions.length === 0) {
          return ctx.reply(`No open position found for ${market}.`);
        }

        const position = positions[0];

        let markPrice: number;
        try {
          markPrice = await fetchMarkPrice(market);
        } catch {
          return ctx.reply('Price feed unavailable. Please try again.');
        }

        const pnl = parseFloat(position.unrealisedPnl);
        const pnlStr = pnl >= 0 ? `+${pnl.toFixed(4)}` : pnl.toFixed(4);

        const prompt =
          `⚠️ **Close Position Confirmation**\n\n` +
          `Market: ${position.market}\n` +
          `Side: ${position.side}\n` +
          `Size: ${position.size}\n` +
          `Mark Price: ${markPrice.toFixed(4)}\n` +
          `Unrealized PnL: ${pnlStr} USDC\n\n` +
          `Reply exactly with **CONFIRM** to close this position, or /cancel to abort.`;

        userState.set(userId, {
          step: WizardStep.AWAIT_CLOSE_CONFIRM,
          order: {},
          walletAddress,
          closeMarket: market,
          closePosition: position,
        });

        return ctx.replyWithMarkdown(prompt);
      }

      // NL order intent
      const parsed = parseNaturalLanguageOrder(text);
      if (parsed) {
        userState.set(userId, { step: WizardStep.AWAIT_CONFIRM, order: parsed });
        const currentPrice = await fetchMarkPrice(parsed.market || '').catch(() => 0);
        const preview = formatPreviewCard(parsed, currentPrice);
        return ctx.replyWithMarkdown(preview);
      }
      return; // Ignore general chatter if not parsed
    }

    // Step Processing
    switch (state.step) {
      case WizardStep.AWAIT_CUSTOM_LEVERAGE: {
        const lev = parseInt(text, 10);
        if (isNaN(lev) || lev <= 0) return ctx.reply("Invalid leverage. Enter a valid number:");
        state.order.leverage = lev;
        state.step = WizardStep.AWAIT_MARGIN;
        ctx.reply("Select Shielded Margin (USDC):", Markup.inlineKeyboard([
          [Markup.button.callback('100', 'cap_100'), Markup.button.callback('500', 'cap_500')],
          [Markup.button.callback('1000', 'cap_1000'), Markup.button.callback('Custom', 'cap_custom')]
        ]));
        break;
      }

      case WizardStep.AWAIT_CUSTOM_MARGIN: {
        const margin = parseFloat(text);
        if (isNaN(margin) || margin <= 0) return ctx.reply("Invalid margin. Enter a valid number:");
        state.order.margin = margin;
        state.step = WizardStep.AWAIT_TP;
        ctx.reply("Enter absolute Take Profit price (or type 'skip'/'none'):");
        break;
      }

      case WizardStep.AWAIT_TP: {
        if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'none') {
          const tp = parseFloat(text);
          if (isNaN(tp)) return ctx.reply("Invalid TP price. Enter a number or 'skip':");
          state.order.tpPrice = tp;
        }
        state.step = WizardStep.AWAIT_SL;
        ctx.reply("Enter absolute Stop Loss price (or type 'skip'/'none'):");
        break;
      }

      case WizardStep.AWAIT_SL: {
        if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'none') {
          const sl = parseFloat(text);
          if (isNaN(sl)) return ctx.reply("Invalid SL price. Enter a number or 'skip':");
          state.order.slPrice = sl;
        }
        state.step = WizardStep.AWAIT_CONFIRM;
        const currentPrice = await fetchMarkPrice(state.order.market || '').catch(() => 0);
        const preview = formatPreviewCard(state.order, currentPrice);
        ctx.replyWithMarkdown(preview);
        break;
      }

      case WizardStep.AWAIT_CONFIRM: {
        if (text === 'CONFIRM') {
          ctx.reply("Initiating shielded transfer and executing order via StarkZap...");

          try {
            const wallet = await starkZap.getWallet(userId);
            // Store wallet address in session
            state.walletAddress = wallet.address;

            await starkZap.enableShieldedMargin(wallet.address, state.order.margin!);
            const payload = await buildOrderPayload(state.order as OrderDetails, wallet.address);

            let txHash: string;
            try {
              const tx = await withRetry(() => wallet.execute(payload));
              txHash = tx.transaction_hash;
            } catch (retryErr) {
              const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              ctx.reply(`❌ Order execution failed: ${msg}\nPlease retry manually.`);
              clearState(userId);
              return;
            }

            ctx.reply(
              `✅ **Order Executed Successfully!**\nTx Hash: \`${txHash}\`\nNetwork: Starknet Sepolia\nExchange: Extended Exchange`,
              { parse_mode: 'Markdown' }
            );
            clearState(userId);
          } catch (error) {
            console.error(error);
            ctx.reply("❌ Error executing order. Please try again or type /cancel.");
          }
        } else {
          ctx.reply("Input not recognized. Reply exactly with CONFIRM to execute, or /cancel to abort.");
        }
        break;
      }

      case WizardStep.AWAIT_CLOSE_CONFIRM: {
        if (text === 'CONFIRM') {
          const { walletAddress, closeMarket, closePosition } = state;
          if (!walletAddress || !closeMarket || !closePosition) {
            ctx.reply("Session data missing. Please start over with /close.");
            clearState(userId);
            return;
          }

          ctx.reply("Closing position...");

          try {
            const markPrice = await fetchMarkPrice(closeMarket).catch(() => 0);
            const closeOrderReq = serializeOrder(
              {
                market: closeMarket,
                side: closePosition.side === 'LONG' ? 'LONG' : 'SHORT',
                leverage: parseFloat(closePosition.leverage),
                margin: parseFloat(closePosition.margin),
              },
              walletAddress,
              markPrice
            );
            closeOrderReq.type = 'MARKET';
            closeOrderReq.reduceOnly = true;
            closeOrderReq.timeInForce = 'IOC';
            closeOrderReq.qty = closePosition.size;

            const orderResp = await withRetry(() => placeOrder(closeOrderReq));
            ctx.reply(
              `✅ Position closed.\nOrder ID: ${orderResp.id}\nMarket: ${closeMarket}`
            );
            clearState(userId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.reply(`❌ Failed to close position: ${msg}\nPlease retry manually.`);
            clearState(userId);
          }
        } else {
          ctx.reply("Input not recognized. Reply exactly with CONFIRM to close, or /cancel to abort.");
        }
        break;
      }

      case WizardStep.AWAIT_TP_CONFIRM:
      case WizardStep.AWAIT_SL_CONFIRM: {
        // These states are reserved for future multi-step TP/SL flows
        ctx.reply("Input not recognized. Use /cancel to abort.");
        break;
      }
    }
  });
}
