import { OrderDetails } from './types';

export function parseNaturalLanguageOrder(text: string): Partial<OrderDetails> | null {
  // Matches: long sol 20x 500 usdc tp @ 90 sl @ 85
  // Matches: short btc 50x with 2000 margin tp @ 92000 sl @ 85000
  const regex = /(long|short)\s+([a-zA-Z]+)\s+(\d+)x(?:\s+with)?\s+(\d+)\s+(?:usdc|margin)(?:\s+tp\s+@\s+(\d+(?:\.\d+)?))?(?:\s+sl\s+@\s+(\d+(?:\.\d+)?))?/i;
  
  const match = text.match(regex);
  if (!match) return null;

  return {
    side: match[1].toUpperCase() as 'LONG' | 'SHORT',
    market: `${match[2].toUpperCase()}-USD`,
    leverage: parseInt(match[3], 10),
    margin: parseFloat(match[4]),
    tpPrice: match[5] ? parseFloat(match[5]) : undefined,
    slPrice: match[6] ? parseFloat(match[6]) : undefined
  };
}
