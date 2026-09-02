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
      payload: Strk20Action[] | Strk20InvokePayload,
    ) => Promise<{ transaction_hash?: string }>;
    strk20PrepareInvoke?: (
      actions: Strk20Action[],
      simulate?: boolean,
    ) => Promise<unknown>;
  };
};

/** Official Wallet API 0.10.3 transfer. amount "OPEN" creates the leftover note. */
export type Strk20TransferAction = {
  type: "transfer";
  token: string;
  amount: "OPEN" | string;
  recipient: string;
};

/** Official Wallet API invoke. Calldata may contain ${openNoteIds[N]} and ${poolAddress}. */
export type Strk20InvokeAction = {
  type: "invoke";
  contract: string;
  calldata: string[];
};

export type Strk20Action = Strk20TransferAction | Strk20InvokeAction;

/** Compatibility wrapper some injected wallets still accept. */
export type Strk20InvokePayload = {
  actions: Strk20Action[];
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
