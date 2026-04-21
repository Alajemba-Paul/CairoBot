import dotenv from 'dotenv';
dotenv.config();

export const config = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  STARKZAP_API_KEY: process.env.STARKZAP_API_KEY || '',
  EXTENDED_API_BASE: process.env.EXTENDED_API_BASE || 'https://api.starknet.sepolia.extended.exchange',
  NETWORK: 'sepolia'
};

if (!config.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in .env");
}
