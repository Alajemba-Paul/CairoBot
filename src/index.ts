import { Telegraf } from 'telegraf';
import { config } from '../config';
import { setupHandlers } from './handlers';
import { starkZap } from './starkzap';

async function bootstrap() {
  console.log("Starting CairoBot...");

  // Config validation already ran at import time (config/index.ts module level).
  // Calling config here ensures it is referenced before any network calls.
  void config;

  // Initialize StarkZap SDK — must happen before new Telegraf(...)
  try {
    await starkZap.init();
  } catch (err) {
    console.error('[StarkZap] SDK initialization failed:', err);
    process.exit(1);
  }
  console.log(`[StarkZap] SDK initialized on ${config.NETWORK}`);

  const bot = new Telegraf(config.BOT_TOKEN);
  
  // Register Telegraf handlers
  setupHandlers(bot);

  // Catch unhandled errors securely
  bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}`, err);
    ctx.reply('An unexpected error occurred.').catch(console.error);
  });

  bot.launch();
  console.log("CairoBot is running on Starknet Sepolia. Awaiting commands...");

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

bootstrap().catch(err => {
  console.error("Fatal error during bot initialization:", err);
  process.exit(1);
});
