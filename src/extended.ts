import axios from 'axios';
import { config } from '../config';
import { OrderDetails } from './types';

const api = axios.create({
  baseURL: config.EXTENDED_API_BASE,
  timeout: 5000
});

export async function buildOrderPayload(order: OrderDetails, walletAddress: string) {
  // Generates the call payload required by StarkZap wallet.execute() 
  // to interact with the Extended Exchange smart contracts.
  return [
    {
      contractAddress: '0xExtendedExchangeRouterProxy',
      entrypoint: 'place_order',
      calldata: [
        order.market,
        order.side === 'LONG' ? '1' : '0',
        order.margin.toString(),
        order.leverage.toString(),
        order.tpPrice?.toString() || '0',
        order.slPrice?.toString() || '0'
      ]
    }
  ];
}

export async function fetchMockPrice(market: string): Promise<number> {
  // In production, fetch from Extended API. Using mock data for Sepolia simulation.
  const prices: Record<string, number> = {
    'BTC-USD': 65000,
    'ETH-USD': 3500,
    'SOL-USD': 150,
    'STRK-USD': 1.2
  };
  return prices[market] || 100;
}
