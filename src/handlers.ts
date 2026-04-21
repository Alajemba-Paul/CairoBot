import { Telegraf, Markup, Context } from 'telegraf';
import { WizardState, WizardStep, OrderDetails, Side } from './types';
import { DEMO_MARKETS, formatPreviewCard } from './utils';
import { parseNaturalLanguageOrder } from './parser';
import { starkZap } from './starkzap';
import { buildOrderPayload, fetchMockPrice } from './extended';

// TODO: Replace Map with Redis for distributed production environments
const userState = new Map<number, WizardState>();

function clearState(userId: number) {
  userState.delete(userId);
}

export function setupHandlers(bot: Telegraf) {
  
  // COMMANDS
  bot.command('cancel', (ctx) => {
    clearState(ctx.from.id);
    ctx.reply("Wizard cancelled and state cleared.");
  });

  bot.command('positions', (ctx) => {
    ctx.reply("Fetching positions from Extended Exchange...\n\n(Mocked) No open positions found.");
  });

  // STRICT GUIDED FLOW INITIATORS
  const startFlow = (ctx: Context, side: Side) => {
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
      const parsed = parseNaturalLanguageOrder(text);
      if (parsed) {
        userState.set(userId, { step: WizardStep.AWAIT_CONFIRM, order: parsed });
        const currentPrice = await fetchMockPrice(parsed.market || '');
        const preview = formatPreviewCard(parsed, currentPrice);
        return ctx.replyWithMarkdown(preview);
      }
      return; // Ignore general chatter if not parsed
    }

    // Step Processing
    switch (state.step) {
      case WizardStep.AWAIT_CUSTOM_LEVERAGE:
        const lev = parseInt(text, 10);
        if (isNaN(lev) || lev <= 0) return ctx.reply("Invalid leverage. Enter a valid number:");
        state.order.leverage = lev;
        state.step = WizardStep.AWAIT_MARGIN;
        ctx.reply("Select Shielded Margin (USDC):", Markup.inlineKeyboard([
          [Markup.button.callback('100', 'cap_100'), Markup.button.callback('500', 'cap_500')],
          [Markup.button.callback('1000', 'cap_1000'), Markup.button.callback('Custom', 'cap_custom')]
        ]));
        break;

      case WizardStep.AWAIT_CUSTOM_MARGIN:
        const margin = parseFloat(text);
        if (isNaN(margin) || margin <= 0) return ctx.reply("Invalid margin. Enter a valid number:");
        state.order.margin = margin;
        state.step = WizardStep.AWAIT_TP;
        ctx.reply("Enter absolute Take Profit price (or type 'skip'/'none'):");
        break;

      case WizardStep.AWAIT_TP:
        if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'none') {
          const tp = parseFloat(text);
          if (isNaN(tp)) return ctx.reply("Invalid TP price. Enter a number or 'skip':");
          state.order.tpPrice = tp;
        }
        state.step = WizardStep.AWAIT_SL;
        ctx.reply("Enter absolute Stop Loss price (or type 'skip'/'none'):");
        break;

      case WizardStep.AWAIT_SL:
        if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'none') {
          const sl = parseFloat(text);
          if (isNaN(sl)) return ctx.reply("Invalid SL price. Enter a number or 'skip':");
          state.order.slPrice = sl;
        }
        state.step = WizardStep.AWAIT_CONFIRM;
        const currentPrice = await fetchMockPrice(state.order.market || '');
        const preview = formatPreviewCard(state.order, currentPrice);
        ctx.replyWithMarkdown(preview);
        break;

      case WizardStep.AWAIT_CONFIRM:
        if (text === 'CONFIRM') {
          ctx.reply("Initiating shielded transfer and executing order via StarkZap...");
          
          try {
            const wallet = await starkZap.getWallet(userId);
            await starkZap.enableShieldedMargin(wallet.address, state.order.margin!);
            const payload = await buildOrderPayload(state.order as OrderDetails, wallet.address);
            
            const tx = await wallet.execute(payload);
            
            ctx.reply(`✅ **Order Executed Successfully!**\nTx Hash: \`${tx.transaction_hash}\`\nNetwork: Starknet Sepolia\nExchange: Extended Exchange`, { parse_mode: 'Markdown' });
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
  });
}
