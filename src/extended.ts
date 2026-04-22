import axios from 'axios';
import { randomUUID } from 'crypto';
import { ec, typedData } from 'starknet';
import { config } from '../config';
import { OrderDetails } from './types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface MarketStats {
  markPrice: number;
  indexPrice: number;
  lastPrice: number;
}

export interface Position {
  id: number;
  market: string;
  side: 'LONG' | 'SHORT';
  size: string;
  value: string;
  openPrice: string;
  markPrice: string;
  liquidationPrice: string;
  margin: string;
  unrealisedPnl: string;
  leverage: string;
  tpTriggerPrice?: string;
  slTriggerPrice?: string;
}

export interface StarkSettlement {
  signature: { r: string; s: string };
  starkKey: string;
  collateralPosition: string;
}

export interface TpSlOrder {
  triggerPrice: string;
  triggerPriceType: 'LAST' | 'MARK' | 'INDEX';
  price: string;
  priceType: 'MARKET' | 'LIMIT';
  settlement?: StarkSettlement;
}

export interface OrderRequest {
  id: string;
  market: string;
  type: 'MARKET' | 'LIMIT' | 'CONDITIONAL' | 'TPSL';
  side: 'BUY' | 'SELL';
  qty: string;
  price: string;
  timeInForce: 'GTT' | 'IOC';
  expiryEpochMillis: number;
  fee: string;
  settlement: StarkSettlement;
  reduceOnly?: boolean;
  cancelId?: string;
  takeProfit?: TpSlOrder;
  stopLoss?: TpSlOrder;
}

export interface OrderResponse {
  id: number;
  externalId: string;
}

export interface PriceCacheEntry {
  price: number;
  fetchedAt: number; // epoch ms
}

export class ExtendedApiSchemaError extends Error {
  constructor(public missingFields: string[]) {
    super(`ExtendedApiSchemaError: missing or invalid fields: ${missingFields.join(', ')}`);
    this.name = 'ExtendedApiSchemaError';
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RawExtendedPosition {
  id: number;
  accountId: number;
  market: string;
  side: 'LONG' | 'SHORT';
  leverage: string;
  size: string;
  value: string;
  openPrice: string;
  markPrice: string;
  liquidationPrice: string;
  margin: string;
  unrealisedPnl: string;
  realisedPnl: string;
  tpTriggerPrice?: string;
  tpLimitPrice?: string;
  slTriggerPrice?: string;
  slLimitPrice?: string;
  createdTime: number;
  updatedTime: number;
}

export interface Call {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

const api = axios.create({
  baseURL: config.EXTENDED_API_BASE + '/api/v1',
  timeout: 5000,
});

// ---------------------------------------------------------------------------
// Price cache (10-second TTL)
// ---------------------------------------------------------------------------

const PRICE_CACHE_TTL_MS = 10_000;
export const priceCache = new Map<string, PriceCacheEntry>();

/** Clears the price cache. Exposed for testing. */
export function clearPriceCache(): void {
  priceCache.clear();
}

// ---------------------------------------------------------------------------
// fetchMarkPrice
// ---------------------------------------------------------------------------

export async function fetchMarkPrice(market: string): Promise<number> {
  const now = Date.now();
  const cached = priceCache.get(market);
  if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cached.price;
  }

  const response = await api.get<{ data: { markPrice: string } }>(
    `/info/markets/${encodeURIComponent(market)}/stats`
  );
  const price = parseFloat(response.data.data.markPrice);
  priceCache.set(market, { price, fetchedAt: Date.now() });
  return price;
}



// ---------------------------------------------------------------------------
// fetchPositions
// ---------------------------------------------------------------------------

export async function fetchPositions(
  walletAddress: string,
  market?: string
): Promise<Position[]> {
  const params: Record<string, string> = {};
  if (market) params.market = market;

  const response = await api.get<{ data: RawExtendedPosition[] }>(
    '/user/positions',
    {
      params,
      headers: {
        'X-Api-Key': config.EXTENDED_API_KEY,
        'X-Wallet-Address': walletAddress,
      },
    }
  );

  return (response.data.data ?? []).map(parsePosition);
}

// ---------------------------------------------------------------------------
// serializeOrder
// ---------------------------------------------------------------------------

export function serializeOrder(
  order: OrderDetails,
  walletAddress: string,
  markPrice: number
): OrderRequest {
  const externalId = randomUUID();
  const expiryEpochMillis = Date.now() + 60 * 60 * 1000; // 1 hour from now

  // Build the typed data message for SNIP-12 signing
  const domain = {
    name: 'Extended Exchange',
    version: '1',
    chainId: config.NETWORK === 'mainnet' ? '0x534e5f4d41494e' : '0x534e5f5345504f4c4941',
  };

  const types = {
    StarkNetDomain: [
      { name: 'name', type: 'felt' },
      { name: 'version', type: 'felt' },
      { name: 'chainId', type: 'felt' },
    ],
    Order: [
      { name: 'id', type: 'felt' },
      { name: 'market', type: 'felt' },
      { name: 'side', type: 'felt' },
      { name: 'qty', type: 'felt' },
      { name: 'price', type: 'felt' },
    ],
  };

  const qty = (order.margin * order.leverage).toString();
  const price = markPrice.toString();

  // Use a numeric nonce derived from timestamp for the felt-encoded id
  const numericId = Date.now().toString();

  const message = {
    id: numericId,
    market: order.market,
    side: order.side === 'LONG' ? '1' : '0',
    qty,
    price,
  };

  const msgHash = typedData.getMessageHash(
    { types, primaryType: 'Order', domain, message },
    walletAddress
  );

  const privateKey = config.EXTENDED_STARK_PRIVATE_KEY;
  const sig = ec.starkCurve.sign(msgHash, privateKey);
  const starkKey = ec.starkCurve.getPublicKey(privateKey, false);

  const settlement: StarkSettlement = {
    signature: {
      r: '0x' + sig.r.toString(16),
      s: '0x' + sig.s.toString(16),
    },
    starkKey: '0x' + Buffer.from(starkKey).toString('hex'),
    collateralPosition: walletAddress,
  };

  const req: OrderRequest = {
    id: externalId,
    market: order.market,
    type: 'MARKET',
    side: order.side === 'LONG' ? 'BUY' : 'SELL',
    qty,
    price,
    timeInForce: 'IOC',
    expiryEpochMillis,
    fee: '0',
    settlement,
  };

  if (order.tpPrice !== undefined) {
    req.takeProfit = {
      triggerPrice: order.tpPrice.toString(),
      triggerPriceType: 'MARK',
      price: order.tpPrice.toString(),
      priceType: 'MARKET',
    };
  }

  if (order.slPrice !== undefined) {
    req.stopLoss = {
      triggerPrice: order.slPrice.toString(),
      triggerPriceType: 'MARK',
      price: order.slPrice.toString(),
      priceType: 'MARKET',
    };
  }

  return req;
}

// ---------------------------------------------------------------------------
// deserializeOrderResponse
// ---------------------------------------------------------------------------

export function deserializeOrderResponse(raw: unknown): OrderResponse {
  const missing: string[] = [];
  const obj = raw as Record<string, unknown>;

  if (!obj || typeof obj !== 'object') {
    throw new ExtendedApiSchemaError(['id', 'externalId']);
  }

  if (obj.id === undefined || obj.id === null) missing.push('id');
  if (!obj.externalId) missing.push('externalId');

  if (missing.length > 0) {
    throw new ExtendedApiSchemaError(missing);
  }

  return {
    id: obj.id as number,
    externalId: obj.externalId as string,
  };
}

// ---------------------------------------------------------------------------
// parsePosition
// ---------------------------------------------------------------------------

const REQUIRED_POSITION_FIELDS: (keyof RawExtendedPosition)[] = [
  'id',
  'market',
  'side',
  'size',
  'value',
  'openPrice',
  'markPrice',
  'liquidationPrice',
  'margin',
  'unrealisedPnl',
  'leverage',
];

export function parsePosition(raw: unknown): Position {
  if (!raw || typeof raw !== 'object') {
    throw new ExtendedApiSchemaError(REQUIRED_POSITION_FIELDS as string[]);
  }

  const obj = raw as Record<string, unknown>;
  const missing: string[] = [];

  for (const field of REQUIRED_POSITION_FIELDS) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new ExtendedApiSchemaError(missing);
  }

  return {
    id: obj.id as number,
    market: obj.market as string,
    side: obj.side as 'LONG' | 'SHORT',
    size: obj.size as string,
    value: obj.value as string,
    openPrice: obj.openPrice as string,
    markPrice: obj.markPrice as string,
    liquidationPrice: obj.liquidationPrice as string,
    margin: obj.margin as string,
    unrealisedPnl: obj.unrealisedPnl as string,
    leverage: obj.leverage as string,
    tpTriggerPrice: obj.tpTriggerPrice as string | undefined,
    slTriggerPrice: obj.slTriggerPrice as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// placeOrder
// ---------------------------------------------------------------------------

export async function placeOrder(order: OrderRequest): Promise<OrderResponse> {
  const response = await api.post<unknown>('/user/order', order, {
    headers: {
      'X-Api-Key': config.EXTENDED_API_KEY,
    },
  });
  return deserializeOrderResponse(response.data);
}

// ---------------------------------------------------------------------------
// buildOrderPayload
// ---------------------------------------------------------------------------

export async function buildOrderPayload(
  order: OrderDetails,
  walletAddress: string
): Promise<Call[]> {
  const markPrice = await fetchMarkPrice(order.market);
  const orderRequest = serializeOrder(order, walletAddress, markPrice);

  return [
    {
      contractAddress: config.EXTENDED_API_BASE,
      entrypoint: 'place_order',
      calldata: [
        orderRequest.id,
        orderRequest.market,
        orderRequest.side === 'BUY' ? '1' : '0',
        orderRequest.qty,
        orderRequest.price,
        orderRequest.fee,
        orderRequest.expiryEpochMillis.toString(),
        orderRequest.settlement.signature.r,
        orderRequest.settlement.signature.s,
        orderRequest.settlement.starkKey,
        orderRequest.settlement.collateralPosition,
      ],
    },
  ];
}
