import { HIGH_LEVERAGE_WARN } from "../config.ts";
import type { Preview, PrivacyNote, TradeIntent } from "./types.ts";

const LIQ_PENALTY = 0.05;
const TAKER_FEE = 0.0005;

export const PRIVACY_NOTE: PrivacyNote = {
  public: [
    "Shield depositor, token, and amount are visible when you enter the pool.",
    "Helper size and timing are visible on the MarginRouter invoke.",
    "The Extended fill is public once the order hits the book.",
  ],
  private: [
    "Note-to-note parties and amounts stay inside the pool.",
    "Which note funded the helper is not published.",
    "Who initiated pool → helper is not published.",
  ],
  never: "Never amount-private perps. Extended fills are public.",
};

export function estimateLiquidation(
  side: "LONG" | "SHORT",
  markPrice: number,
  leverage: number,
): number {
  const effectiveLev = Math.max(leverage, 1);
  const priceMoveToLiq = markPrice * (1 / effectiveLev) * (1 - LIQ_PENALTY);
  return side === "LONG" ? markPrice - priceMoveToLiq : markPrice + priceMoveToLiq;
}

export function buildPreviewMath(
  intent: TradeIntent,
  markPrice: number,
  indexPrice: number,
  id: string,
  now = Date.now(),
): Omit<Preview, "id" | "createdAt" | "expiresAt"> & {
  id: string;
  createdAt: number;
  expiresAt: number;
} {
  const notionalUsdc = intent.marginUsdc * intent.leverage;
  const estLiqPrice = estimateLiquidation(intent.side, markPrice, intent.leverage);
  const feeUsdc = notionalUsdc * TAKER_FEE;
  const warnings: string[] = [];

  if (intent.leverage >= HIGH_LEVERAGE_WARN) {
    warnings.push(
      `HIGH LEVERAGE (${intent.leverage}x). Rapid liquidation is likely.`,
    );
  }
  if (intent.tpPrice !== undefined) {
    if (intent.side === "LONG" && intent.tpPrice <= markPrice) {
      warnings.push("Take-profit is at or below mark for a long.");
    }
    if (intent.side === "SHORT" && intent.tpPrice >= markPrice) {
      warnings.push("Take-profit is at or above mark for a short.");
    }
  }
  if (intent.slPrice !== undefined) {
    if (intent.side === "LONG" && intent.slPrice >= markPrice) {
      warnings.push("Stop-loss is at or above mark for a long.");
    }
    if (intent.side === "SHORT" && intent.slPrice <= markPrice) {
      warnings.push("Stop-loss is at or below mark for a short.");
    }
  } else {
    warnings.push("No stop-loss. Reply sl @ PRICE or set it on the desk.");
  }
  if (markPrice <= 0) {
    warnings.push("Mark price unavailable — refuse to size this order.");
  }

  return {
    id,
    intent,
    markPrice,
    indexPrice,
    notionalUsdc,
    estLiqPrice,
    feeUsdc,
    highLeverage: intent.leverage >= HIGH_LEVERAGE_WARN,
    warnings,
    privacy: PRIVACY_NOTE,
    createdAt: now,
    expiresAt: now + 60_000,
  };
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function formatPreviewCard(preview: Preview): string {
  const { intent } = preview;
  const slLine =
    intent.slPrice !== undefined
      ? `SL         $${money(intent.slPrice)}`
      : "SL         UNSET  —  reply  sl @ PRICE";
  const tpLine =
    intent.tpPrice !== undefined
      ? `TP         $${money(intent.tpPrice)}`
      : "TP         UNSET  —  reply  tp @ PRICE";
  const lines = [
    "Order Preview  ·  60s TTL  ·  no funds moved",
    "",
    `Market     ${intent.market}`,
    `Side       ${intent.side}`,
    `Margin     ${intent.marginUsdc} USDC`,
    `Leverage   ${intent.leverage}x`,
    `Notional   $${preview.notionalUsdc.toFixed(2)}`,
    `Mark       $${money(preview.markPrice)}`,
    `Est. liq   ~$${money(preview.estLiqPrice)}`,
    `Fee (est)  $${preview.feeUsdc.toFixed(4)}`,
    tpLine,
    slLine,
  ];
  if (preview.warnings.length > 0) {
    lines.push("", ...preview.warnings.map((w) => `WARNING: ${w}`));
  }
  lines.push(
    "",
    `Preview ID  ${preview.id}`,
    "Reply CONFIRM to sign on the desk. This chat never signs.",
  );
  return lines.join("\n");
}
