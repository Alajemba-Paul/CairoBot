"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    STARKZAP_API_KEY: process.env.STARKZAP_API_KEY || '',
    EXTENDED_API_BASE: process.env.EXTENDED_API_BASE || 'https://api.starknet.sepolia.extended.exchange',
    EXTENDED_API_KEY: process.env.EXTENDED_API_KEY || '',
    EXTENDED_STARK_PRIVATE_KEY: process.env.EXTENDED_STARK_PRIVATE_KEY || '',
    NETWORK: process.env.NETWORK || 'sepolia',
    PRIVY_APP_ID: process.env.PRIVY_APP_ID,
    CARTRIDGE_API_KEY: process.env.CARTRIDGE_API_KEY,
};
const REQUIRED_VARS = [
    'BOT_TOKEN',
    'STARKZAP_API_KEY',
    'EXTENDED_API_BASE',
    'EXTENDED_API_KEY',
    'EXTENDED_STARK_PRIVATE_KEY',
];
const missing = REQUIRED_VARS.filter((key) => !exports.config[key]);
if (missing.length > 0) {
    for (const name of missing) {
        console.error(`Missing required environment variable: ${name}`);
    }
    process.exit(1);
}
