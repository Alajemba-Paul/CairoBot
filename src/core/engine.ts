import { MCP_LEVERAGE_CONFIRM, MARGIN_ROUTER, PREVIEW_TTL_MS, USDC } from "../config.ts";
import { EXTENDED_VENUE } from "../config.ts";
import { parseTradeIntent } from "./intent.ts";
import { sendPoolCall, privacyStatus as privacyStatusOf } from "./privacy.ts";
import { buildPreviewMath } from "./risk.ts";
import {
  buildUnsignedOrder,
  fetchMarkPrice,
  fetchPositions,
  placeOrder,
} from "./venues/extended.ts";
import {
  NoWalletSessionError,
  PreviewExpiredError,
  type CloseIntent,
  type Position,
  type Preview,
  type PrivacyStatus,
  type Receipt,
  type TradeIntent,
  type WalletSession,
} from "./types.ts";

const previews = new Map<string, Preview>();
const receipts: Receipt[] = [];
const localPositions = new Map<string, Position[]>();

function prunePreviews(now = Date.now()): void {
  for (const [id, preview] of previews) {
    if (preview.expiresAt <= now) previews.delete(id);
  }
}

function previewId(): string {
  return `pv_${crypto.randomUUID().slice(0, 8)}`;
}

export async function previewTrade(intent: TradeIntent): Promise<Preview> {
  prunePreviews();
  const mark = await fetchMarkPrice(intent.market);
  const preview = buildPreviewMath(
    intent,
    mark.markPrice,
    mark.indexPrice,
    previewId(),
  ) as Preview;
  preview.expiresAt = preview.createdAt + PREVIEW_TTL_MS;
  previews.set(preview.id, preview);
  return preview;
}

export async function previewFromText(text: string, owner = "cli"): Promise<Preview> {
  return previewTrade(parseTradeIntent(text, owner));
}

export type ConfirmOpts = {
  session?: WalletSession | null;
  confirmHighLeverage?: boolean;
  adapter?: "cli" | "mcp" | "telegram" | "web";
};

export async function confirmTrade(previewId: string, opts: ConfirmOpts = {}): Promise<Receipt> {
  const session = opts.session;
  if (!session) {
    throw new NoWalletSessionError();
  }

  prunePreviews();
  const preview = previews.get(previewId);
  if (!preview) throw new PreviewExpiredError(previewId);
  if (Date.now() > preview.expiresAt) {
    previews.delete(previewId);
    throw new PreviewExpiredError(previewId);
  }

  if (opts.adapter === "mcp" && preview.intent.leverage >= MCP_LEVERAGE_CONFIRM && !opts.confirmHighLeverage) {
    throw new Error(
      `leverage ${preview.intent.leverage}x requires explicit confirm (confirmHighLeverage)`,
    );
  }

  const helper = MARGIN_ROUTER;
  if (!helper) {
    throw new Error(
      "MarginRouter undeployed. Deploy cairo/ on SN_MAIN and set MARGIN_ROUTER.",
    );
  }

  const noteId = `0x${Date.now().toString(16)}`;
  const fundTxHash = await sendPoolCall({
    session,
    openNoteIds: [noteId],
    helper,
    token: USDC,
    noteId,
    op: 0,
    venue: EXTENDED_VENUE,
    user: session.address,
  });

  const order = buildUnsignedOrder(preview.intent, preview.markPrice);
  const placed = await placeOrder(order);

  const receipt: Receipt = {
    previewId,
    owner: preview.intent.owner,
    market: preview.intent.market,
    side: preview.intent.side,
    leverage: preview.intent.leverage,
    marginUsdc: preview.intent.marginUsdc,
    fundTxHash,
    orderId: placed?.id,
    placedAt: Date.now(),
  };
  previews.delete(previewId);
  receipts.push(receipt);

  const positions = localPositions.get(receipt.owner) ?? [];
  positions.push({
    owner: receipt.owner,
    market: receipt.market,
    side: receipt.side,
    size: String(receipt.marginUsdc * receipt.leverage),
    marginUsdc: String(receipt.marginUsdc),
    leverage: String(receipt.leverage),
    openPrice: String(preview.markPrice),
    markPrice: String(preview.markPrice),
    liquidationPrice: String(preview.estLiqPrice),
    unrealisedPnl: "0",
    tpTriggerPrice: preview.intent.tpPrice !== undefined ? String(preview.intent.tpPrice) : undefined,
    slTriggerPrice: preview.intent.slPrice !== undefined ? String(preview.intent.slPrice) : undefined,
  });
  localPositions.set(receipt.owner, positions);
  return receipt;
}

export async function listPositions(owner: string): Promise<Position[]> {
  const remote = await fetchPositions(owner).catch(() => [] as Position[]);
  if (remote.length > 0) return remote;
  return localPositions.get(owner) ?? [];
}

export async function closePosition(
  input: CloseIntent,
  opts: ConfirmOpts = {},
): Promise<{ reduceOnly: true; sweepTxHash: string }> {
  if (!opts.session) throw new NoWalletSessionError();
  const helper = MARGIN_ROUTER;
  if (!helper) {
    throw new Error(
      "MarginRouter undeployed. Deploy cairo/ on SN_MAIN and set MARGIN_ROUTER.",
    );
  }

  const noteId = `0x${Date.now().toString(16)}`;
  const sweepTxHash = await sendPoolCall({
    session: opts.session,
    openNoteIds: [noteId],
    helper,
    token: USDC,
    noteId,
    op: 1,
    venue: "0",
    user: opts.session.address,
  });

  const current = localPositions.get(input.owner) ?? [];
  localPositions.set(
    input.owner,
    current.filter((p) => p.market !== input.market),
  );
  return { reduceOnly: true, sweepTxHash };
}

export function privacyStatus(owner: string, session?: WalletSession | null): PrivacyStatus {
  return privacyStatusOf(owner, session);
}

export function getPreview(id: string): Preview | undefined {
  prunePreviews();
  return previews.get(id);
}
