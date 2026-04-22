import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  BOT_TOKEN: string;
  STARKZAP_API_KEY: string;           // Privy/Cartridge app ID or private key
  EXTENDED_API_BASE: string;
  EXTENDED_API_KEY: string;           // X-Api-Key for Extended REST API
  EXTENDED_STARK_PRIVATE_KEY: string; // L2 private key for Stark signatures
  NETWORK: 'sepolia' | 'mainnet';
  PRIVY_APP_ID?: string;              // Required if using Privy onboarding strategy
  CARTRIDGE_API_KEY?: string;         // Required if using Cartridge onboarding strategy
}

export const config: AppConfig = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  STARKZAP_API_KEY: process.env.STARKZAP_API_KEY || '',
  EXTENDED_API_BASE: process.env.EXTENDED_API_BASE || 'https://api.starknet.sepolia.extended.exchange',
  EXTENDED_API_KEY: process.env.EXTENDED_API_KEY || '',
  EXTENDED_STARK_PRIVATE_KEY: process.env.EXTENDED_STARK_PRIVATE_KEY || '',
  NETWORK: (process.env.NETWORK as 'sepolia' | 'mainnet') || 'sepolia',
  PRIVY_APP_ID: process.env.PRIVY_APP_ID,
  CARTRIDGE_API_KEY: process.env.CARTRIDGE_API_KEY,
};

const REQUIRED_VARS: (keyof AppConfig)[] = [
  'BOT_TOKEN',
  'STARKZAP_API_KEY',
  'EXTENDED_API_BASE',
  'EXTENDED_API_KEY',
  'EXTENDED_STARK_PRIVATE_KEY',
];

const missing = REQUIRED_VARS.filter((key) => !config[key]);

if (missing.length > 0) {
  for (const name of missing) {
    console.error(`Missing required environment variable: ${name}`);
  }
  process.exit(1);
}
