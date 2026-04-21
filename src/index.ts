import { Telegraf } from 'telegraf';
import { config } from '../config';
import { setupHandlers } from './handlers';
import { starkZap } from './starkzap';

async function bootstrap() {
  console.log("Starting CairoBot...");
  
  // Initialize StarkZap SDK
  await starkZap.init();

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
