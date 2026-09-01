#!/usr/bin/env node
/**
 * Telegram adapter. Buttons only fill TradeIntent. No in-bot key cache.
 * CONFIRM is a reply, never a hidden auto-sign. Operator key is never read.
 */
import { BOT_TOKEN, DESK_URL, MARKETS } from "../config.ts";
import { REPO_BRANCH, REPO_URL } from "../core/constants.ts";
import { parseCloseIntent, parseTradeIntent, tryParse } from "../core/intent.ts";
import { closePosition, confirmTrade, listPositions, previewTrade, privacyStatus } from "../core/engine.ts";
import { formatPreviewCard } from "../core/risk.ts";
import type { Market, Side, TradeIntent } from "../core/types.ts";
import { NoWalletSessionError } from "../core/types.ts";

type Wizard = Partial<TradeIntent> & { previewId?: string };

const wizards = new Map<string, Wizard>();

function ownerOf(chatId: number | string): string {
  return `tg:${chatId}`;
}

async function api(method: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("telegram", method, res.status, text.slice(0, 200));
  }
}

function keyboard(rows: Array<Array<{ text: string; callback_data: string }>>) {
  return { inline_keyboard: rows };
}

function seedButtons() {
  return keyboard([
    [
      { text: "LONG", callback_data: "side:LONG" },
      { text: "SHORT", callback_data: "side:SHORT" },
    ],
    MARKETS.map((m) => ({ text: m.replace("-USD", ""), callback_data: `mkt:${m}` })),
    [5, 10, 20, 50].map((x) => ({ text: `${x}x`, callback_data: `lev:${x}` })),
    [50, 100, 500, 1000].map((n) => ({ text: `${n} USDC`, callback_data: `mar:${n}` })),
  ]);
}

function help(): string {
  return [
    "CairoBot — private perps on Extended mainnet.",
    "",
    "Type an order:",
    "  long sol 10x 50 usdc tp @ 200",
    "Or tap LONG / SHORT and fill the intent.",
    "",
    "/positions   open positions",
    "/privacy     what is actually private",
    "/cancel      drop the draft",
    "",
    "Preview lasts 60s. Reply CONFIRM — this bot never signs.",
    "Signing uses Ready or Xverse on the web desk or CLI. No shared key.",
  ].join("\n");
}

function signHint(): string {
  const desk = DESK_URL || "the CairoBot web desk (Vercel)";
  return [
    "no wallet session",
    "",
    "Telegram never signs. Identity stays off the book.",
    `Sign with Ready or Xverse: ${desk}`,
    "",
    "CLI:",
    `git clone ${REPO_URL}.git && cd CairoBot && git checkout ${REPO_BRANCH}`,
    "npm install",
    'npm run cli -- preview "long sol 10x 50 usdc tp @ 200"',
    "",
    "Agent: copy mcp.json from the desk (OpenClaw / Hermes).",
  ].join("\n");
}

function signMarkup() {
  if (!DESK_URL) return undefined;
  return {
    inline_keyboard: [[{ text: "Open desk to sign", url: DESK_URL }]],
  };
}

async function send(chatId: number, text: string, extra?: Record<string, unknown>) {
  await api("sendMessage", { chat_id: chatId, text, ...extra });
}

function merge(chatId: string, patch: Wizard): Wizard {
  const next = { ...(wizards.get(chatId) ?? {}), ...patch };
  wizards.set(chatId, next);
  return next;
}

function ready(w: Wizard): w is TradeIntent {
  return Boolean(w.owner && w.market && w.side && w.leverage && w.marginUsdc);
}

async function maybePreview(chatId: number, w: Wizard) {
  if (!ready(w)) {
    const missing = ["side", "market", "leverage", "marginUsdc"].filter((k) => !(w as Record<string, unknown>)[k]);
    await send(chatId, `Draft: ${JSON.stringify(w)}\nStill need: ${missing.join(", ")}`, {
      reply_markup: seedButtons(),
    });
    return;
  }
  const preview = await previewTrade(w);
  merge(String(chatId), { previewId: preview.id });
  await send(chatId, formatPreviewCard(preview));
}

async function handleText(chatId: number, text: string) {
  const owner = ownerOf(chatId);
  const trimmed = text.trim();

  if (trimmed === "/start" || trimmed === "/help") {
    await send(chatId, help(), { reply_markup: seedButtons() });
    return;
  }
  if (trimmed === "/cancel") {
    wizards.delete(String(chatId));
    await send(chatId, "Draft dropped.");
    return;
  }
  if (trimmed === "/privacy") {
    await send(chatId, JSON.stringify(privacyStatus(owner, null), null, 2));
    return;
  }
  if (trimmed === "/positions" || trimmed.startsWith("/positions")) {
    const rows = await listPositions(owner);
    await send(chatId, rows.length ? JSON.stringify(rows, null, 2) : "No open positions.");
    return;
  }
  if (trimmed.toUpperCase() === "CONFIRM") {
    const w = wizards.get(String(chatId));
    if (!w?.previewId) {
      await send(chatId, "Nothing to confirm. Send an order first.");
      return;
    }
    try {
      await confirmTrade(w.previewId, { session: null, adapter: "telegram" });
    } catch (err) {
      const message =
        err instanceof NoWalletSessionError
          ? signHint()
          : err instanceof Error
            ? err.message
            : String(err);
      const markup = err instanceof NoWalletSessionError ? signMarkup() : undefined;
      await send(chatId, message, markup ? { reply_markup: markup } : undefined);
      return;
    }
    return;
  }

  const parsed = tryParse(trimmed, owner);
  if (parsed?.kind === "close") {
    try {
      await closePosition(parsed.intent, { session: null, adapter: "telegram" });
    } catch (err) {
      const message = err instanceof NoWalletSessionError ? signHint() : err instanceof Error ? err.message : String(err);
      await send(chatId, message);
    }
    return;
  }
  if (parsed?.kind === "trade") {
    merge(String(chatId), parsed.intent);
    await maybePreview(chatId, parsed.intent);
    return;
  }

  if (trimmed.startsWith("/close")) {
    const close = parseCloseIntent(trimmed.replace("/close", "close"), owner);
    try {
      await closePosition(close, { session: null, adapter: "telegram" });
    } catch (err) {
      const message = err instanceof NoWalletSessionError ? signHint() : err instanceof Error ? err.message : String(err);
      await send(chatId, message);
    }
    return;
  }

  try {
    const intent = parseTradeIntent(trimmed, owner);
    merge(String(chatId), intent);
    await maybePreview(chatId, intent);
  } catch (err) {
    await send(chatId, `${err instanceof Error ? err.message : String(err)}\n\n${help()}`, {
      reply_markup: seedButtons(),
    });
  }
}

async function handleCallback(chatId: number, data: string, cbId: string) {
  await api("answerCallbackQuery", { callback_query_id: cbId });
  const owner = ownerOf(chatId);
  const [kind, value] = data.split(":");
  const patch: Wizard = { owner };
  if (kind === "side") patch.side = value as Side;
  if (kind === "mkt") patch.market = value as Market;
  if (kind === "lev") patch.leverage = Number(value);
  if (kind === "mar") patch.marginUsdc = Number(value);
  const w = merge(String(chatId), patch);
  await maybePreview(chatId, w);
}

async function poll(): Promise<void> {
  if (!BOT_TOKEN) {
    console.error("BOT_TOKEN missing. Telegram adapter not started. CLI and MCP do not need it.");
    process.exit(1);
  }
  let offset = 0;
  console.log("CairoBot telegram adapter on mainnet. No shared-key cache.");
  for (;;) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=50&offset=${offset}`,
      );
      const payload = (await res.json()) as {
        ok?: boolean;
        result?: Array<{
          update_id: number;
          message?: { chat: { id: number }; text?: string };
          callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
        }>;
      };
      if (!payload.ok || !payload.result) continue;
      for (const update of payload.result) {
        offset = update.update_id + 1;
        if (update.message?.text) {
          await handleText(update.message.chat.id, update.message.text);
        } else if (update.callback_query?.data && update.callback_query.message) {
          await handleCallback(
            update.callback_query.message.chat.id,
            update.callback_query.data,
            update.callback_query.id,
          );
        }
      }
    } catch (err) {
      console.error("poll", err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

poll();
