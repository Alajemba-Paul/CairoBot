import { OrderDetails } from './types';

export const DEMO_MARKETS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'STRK-USD'];

export function formatPreviewCard(order: Partial<OrderDetails>, currentPrice: number = 0): string {
  const notional = (order.margin || 0) * (order.leverage || 1);
  
  // Mock estimation for liquidation price. In production, fetch index price and apply protocol formula.
  const isLong = order.side === 'LONG';
  const liqPenalty = 0.05; 
  const effectiveLev = order.leverage || 1;
  const priceMoveToLiq = currentPrice * (1 / effectiveLev) * (1 - liqPenalty);
  const estLiqPrice = isLong ? currentPrice - priceMoveToLiq : currentPrice + priceMoveToLiq;

  let card = `📊 **Order Preview**\n\n`;
  card += `Market: ${order.market}\n`;
  card += `Side: ${order.side === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}\n`;
  card += `Margin: ${order.margin} USDC\n`;
  card += `Leverage: ${order.leverage}x\n`;
  card += `Notional Size: $${notional.toFixed(2)}\n`;
  
  if (order.tpPrice) card += `Take Profit: $${order.tpPrice}\n`;
  else card += `Take Profit: None\n`;

  if (order.slPrice) card += `Stop Loss: $${order.slPrice}\n`;
  else card += `Stop Loss: None\n`;

  if (currentPrice > 0) {
    card += `\n*Est. Liq Price: ~$${estLiqPrice.toFixed(2)}*\n`;
  }

  card += `\n🛡️ **Privacy Note:** Your margin is shielded via StarkZap protocol.\n`;

  if (effectiveLev >= 50) {
    card += `\n⚠️ **WARNING: HIGH LEVERAGE** (>50x). You are at extreme risk of rapid liquidation.\n`;
  }

  card += `\nReply exactly with **CONFIRM** to execute this trade.`;
  
  return card;
}
