export const MARKETS = ["BTC-USD", "ETH-USD", "SOL-USD", "STRK-USD"] as const;
export type Market = (typeof MARKETS)[number];

export type Side = "LONG" | "SHORT";

export type TradeIntent = {
  owner: string;
  market: Market;
  side: Side;
  leverage: number;
  marginUsdc: number;
  tpPrice?: number;
  slPrice?: number;
};

export type CloseIntent = {
  owner: string;
  market: Market;
};

export type Preview = {
  id: string;
  intent: TradeIntent;
  markPrice: number;
  indexPrice: number;
  notionalUsdc: number;
  estLiqPrice: number;
  feeUsdc: number;
  highLeverage: boolean;
  warnings: string[];
  privacy: PrivacyNote;
  createdAt: number;
  expiresAt: number;
};

export type PrivacyNote = {
  public: string[];
  private: string[];
  never: string;
};

export type Receipt = {
  previewId: string;
  owner: string;
  market: Market;
  side: Side;
  leverage: number;
  marginUsdc: number;
  fundTxHash: string;
  orderId?: string;
  placedAt: number;
};

export type Position = {
  owner: string;
  market: Market;
  side: Side;
  size: string;
  marginUsdc: string;
  leverage: string;
  openPrice: string;
  markPrice: string;
  liquidationPrice: string;
  unrealisedPnl: string;
  tpTriggerPrice?: string;
  slTriggerPrice?: string;
};

export type PrivacyStatus = {
  owner: string;
  network: "mainnet";
  chainId: "SN_MAIN";
  pool: string;
  usdc: string;
  helper: string;
  venue: string;
  walletSession: boolean;
  viewingKey: "wallet-held" | "absent";
  claims: PrivacyNote;
};

export type WalletSession = {
  address: string;
  account?: {
    strk20InvokeTransaction?: (
      payload: Strk20InvokePayload,
    ) => Promise<{ transaction_hash?: string }>;
  };
};

export type Strk20Action = {
  action: "OPEN";
  poolAddress: string;
  openNoteIds: string[];
};

export type Strk20InvokePayload = {
  actions: Strk20Action[];
  calls?: Array<{
    contractAddress: string;
    entrypoint: string;
    calldata: string[];
  }>;
};

export class NoWalletSessionError extends Error {
  constructor(message = "no wallet session") {
    super(message);
    this.name = "NoWalletSessionError";
  }
}

export class PreviewExpiredError extends Error {
  constructor(id: string) {
    super(`preview expired: ${id}`);
    this.name = "PreviewExpiredError";
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
