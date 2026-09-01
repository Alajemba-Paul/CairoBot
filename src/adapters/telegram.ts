#!/usr/bin/env node
/**
 * Telegram adapter. Buttons only fill TradeIntent. No in-bot key cache.
 * CONFIRM is a reply, never a hidden auto-sign. Operator key is never read.
 * Poll when run as CLI. Vercel webhook imports handleUpdate.
 */
import { BOT_TOKEN, DESK_URL, MARKETS } from "../config.ts";
import { PUBLIC_DESK_URL, REPO_BRANCH, REPO_URL } from "../core/constants.ts";
import { parseCloseIntent, parseTradeIntent, tryParse } from "../core/intent.ts";
import { closePosition, confirmTrade, listPositions, previewTrade, privacyStatus } from "../core/engine.ts";
import { formatPreviewCard } from "../core/risk.ts";
import type { Market, Side, TradeIntent } from "../core/types.ts";
import { NoWalletSessionError } from "../core/types.ts";

type Wizard = Partial<TradeIntent> & { previewId?: string };

export type TelegramUpdate = {
  update_id?: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

const wizards = new Map<string, Wizard>();

const TICKER: Record<string, Market> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  STRK: "STRK-USD",
};

function ownerOf(chatId: number | string): string {
  return `tg:${chatId}`;
}

function desk(): string {
  return DESK_URL || PUBLIC_DESK_URL;
}

function token(): string {
  try {
    return process.env.BOT_TOKEN || BOT_TOKEN;
  } catch {
    return BOT_TOKEN;
  }
}

async function api(method: string, body: Record<string, unknown>): Promise<void> {
  const bot = token();
  if (!bot) return;
  const res = await fetch(`https://api.telegram.org/bot${bot}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("telegram", method, res.status, text.slice(0, 200));
  }
}

function keyboard(rows: Array<Array<{ text: string; callback_data?: string; url?: string }>>) {
  return { inline_keyboard: rows };
}

function encodeDraft(w: Wizard): string {
  const side = w.side === "SHORT" ? "S" : w.side === "LONG" ? "L" : "";
  const mkt = w.market ? w.market.replace("-USD", "") : "";
  const lev = w.leverage ? String(w.leverage) : "";
  const mar = w.marginUsdc ? String(w.marginUsdc) : "";
  return `w:${side}:${mkt}:${lev}:${mar}`;
}

function decodeDraft(data: string, owner: string): Wizard {
  if (!data.startsWith("w:")) return { owner };
  const parts = data.split(":");
  const w: Wizard = { owner };
  if (parts[1] === "L") w.side = "LONG";
  if (parts[1] === "S") w.side = "SHORT";
  if (parts[2] && TICKER[parts[2]]) w.market = TICKER[parts[2]];
  if (parts[3]) w.leverage = Number(parts[3]);
  if (parts[4]) w.marginUsdc = Number(parts[4]);
  return w;
}

function seedButtons(w: Wizard = {}) {
  return keyboard([
    [
      { text: "LONG", callback_data: encodeDraft({ ...w, side: "LONG" }) },
      { text: "SHORT", callback_data: encodeDraft({ ...w, side: "SHORT" }) },
    ],
    MARKETS.map((m) => ({
      text: m.replace("-USD", ""),
      callback_data: encodeDraft({ ...w, market: m }),
    })),
    [5, 10, 20, 50].map((x) => ({
      text: `${x}x`,
      callback_data: encodeDraft({ ...w, leverage: x }),
    })),
    [50, 100, 500, 1000].map((n) => ({
      text: `${n} USDC`,
      callback_data: encodeDraft({ ...w, marginUsdc: n }),
    })),
    [{ text: "Open desk to sign", url: desk() }],
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
    `Signing uses Ready or Xverse on ${desk()}. No shared key.`,
  ].join("\n");
}

function signHint(): string {
  return [
    "no wallet session",
    "",
    "Telegram never signs. Identity stays off the book.",
    `Sign with Ready or Xverse: ${desk()}`,
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
  return {
    inline_keyboard: [[{ text: "Open desk to sign", url: desk() }]],
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
    const missing = ["side", "market", "leverage", "marginUsdc"].filter(
      (k) => !(w as Record<string, unknown>)[k],
    );
    await send(chatId, `Draft: ${JSON.stringify(w)}\nStill need: ${missing.join(", ")}`, {
      reply_markup: seedButtons(w),
    });
    return;
  }
  const preview = await previewTrade(w);
  merge(String(chatId), { ...w, previewId: preview.id });
  await send(chatId, formatPreviewCard(preview), { reply_markup: signMarkup() });
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
    await send(chatId, JSON.stringify(privacyStatus(owner, null), null, 2), {
      reply_markup: signMarkup(),
    });
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
      await send(chatId, `${signHint()}`, { reply_markup: signMarkup() });
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
      await send(chatId, message, { reply_markup: signMarkup() });
      return;
    }
    return;
  }

  const parsed = tryParse(trimmed, owner);
  if (parsed?.kind === "close") {
    try {
      await closePosition(parsed.intent, { session: null, adapter: "telegram" });
    } catch (err) {
      const message =
        err instanceof NoWalletSessionError ? signHint() : err instanceof Error ? err.message : String(err);
      await send(chatId, message, { reply_markup: signMarkup() });
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
      const message =
        err instanceof NoWalletSessionError ? signHint() : err instanceof Error ? err.message : String(err);
      await send(chatId, message, { reply_markup: signMarkup() });
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
  let w: Wizard;
  if (data.startsWith("w:")) {
    w = decodeDraft(data, owner);
  } else {
    const [kind, value] = data.split(":");
    const patch: Wizard = { owner };
    if (kind === "side") patch.side = value as Side;
    if (kind === "mkt") patch.market = value as Market;
    if (kind === "lev") patch.leverage = Number(value);
    if (kind === "mar") patch.marginUsdc = Number(value);
    w = merge(String(chatId), patch);
  }
  w = merge(String(chatId), w);
  await maybePreview(chatId, w);
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
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

async function poll(): Promise<void> {
  const bot = token();
  if (!bot) {
    console.error("BOT_TOKEN missing. Telegram adapter not started. CLI and MCP do not need it.");
    process.exit(1);
  }
  await api("setMyCommands", {
    commands: [
      { command: "start", description: "Help and order buttons" },
      { command: "privacy", description: "What is actually private" },
      { command: "positions", description: "Open positions" },
      { command: "cancel", description: "Drop the draft" },
    ],
  });
  await api("deleteWebhook", { drop_pending_updates: false });
  let offset = 0;
  console.log("CairoBot telegram adapter on mainnet. No shared-key cache.");
  for (;;) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${bot}/getUpdates?timeout=50&offset=${offset}`,
      );
      const payload = (await res.json()) as {
        ok?: boolean;
        result?: TelegramUpdate[];
      };
      if (!payload.ok || !payload.result) continue;
      for (const update of payload.result) {
        offset = (update.update_id ?? offset) + 1;
        await handleUpdate(update);
      }
    } catch (err) {
      console.error("poll", err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const isCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv.some((a) => /adapters\/telegram\.ts$/.test(a) || /telegram\.ts$/.test(a));

if (isCli) {
  void poll();
}
