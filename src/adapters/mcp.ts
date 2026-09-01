#!/usr/bin/env node
/**
 * CairoBot MCP stdio server.
 * Tools: preview_trade, confirm_trade, list_positions, close_position, privacy_status.
 * Leverage ≥ 20 requires explicit confirmHighLeverage on confirm_trade.
 */
import { parseTradeIntent } from "../core/intent.ts";
import { closePosition, confirmTrade, listPositions, previewTrade, privacyStatus } from "../core/engine.ts";
import { getOperatorSession } from "../core/privacy.ts";
import type { Market } from "../core/types.ts";
import { MARKETS } from "../core/types.ts";

type RpcReq = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

const TOOLS = [
  {
    name: "preview_trade",
    description:
      "Parse a TradeIntent (or take structured fields) and return a 60s fat-finger preview against Extended mainnet marks. No funds move.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: 'NL order, e.g. "long sol 10x 50 usdc tp @ 200"' },
        owner: { type: "string" },
        market: { type: "string", enum: [...MARKETS] },
        side: { type: "string", enum: ["LONG", "SHORT"] },
        leverage: { type: "number" },
        marginUsdc: { type: "number" },
        tpPrice: { type: "number" },
        slPrice: { type: "number" },
      },
    },
  },
  {
    name: "confirm_trade",
    description:
      "Fund the helper via STRK20 privacy_invoke (op=0 FundMargin) then place the Extended order. Fails closed without a wallet session. Leverage ≥ 20 requires confirmHighLeverage=true.",
    inputSchema: {
      type: "object",
      properties: {
        previewId: { type: "string" },
        confirmHighLeverage: { type: "boolean" },
      },
      required: ["previewId"],
    },
  },
  {
    name: "list_positions",
    description: "List open Extended positions for owner.",
    inputSchema: {
      type: "object",
      properties: { owner: { type: "string" } },
    },
  },
  {
    name: "close_position",
    description: "Reduce-only close, then SweepPnl (op=1) back into the pool as one open note.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        market: { type: "string", enum: [...MARKETS] },
      },
      required: ["market"],
    },
  },
  {
    name: "privacy_status",
    description: "Honest public/private claim table plus pool, helper, and session state.",
    inputSchema: {
      type: "object",
      properties: { owner: { type: "string" } },
    },
  },
];

function ok(id: RpcReq["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function err(id: RpcReq["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function textResult(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text", text }] };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const owner = typeof args.owner === "string" && args.owner ? args.owner : "mcp";
  const session = getOperatorSession();

  if (name === "preview_trade") {
    const intent =
      typeof args.text === "string" && args.text.trim()
        ? parseTradeIntent(args.text, owner)
        : {
            owner,
            market: args.market as Market,
            side: args.side as "LONG" | "SHORT",
            leverage: Number(args.leverage),
            marginUsdc: Number(args.marginUsdc),
            tpPrice: args.tpPrice !== undefined ? Number(args.tpPrice) : undefined,
            slPrice: args.slPrice !== undefined ? Number(args.slPrice) : undefined,
          };
    if (!intent.market || !intent.side) {
      throw new Error("preview_trade needs `text` or {market, side, leverage, marginUsdc}");
    }
    return previewTrade(intent);
  }

  if (name === "confirm_trade") {
    const previewId = String(args.previewId ?? "");
    if (!previewId) throw new Error("previewId required");
    return confirmTrade(previewId, {
      session,
      adapter: "mcp",
      confirmHighLeverage: Boolean(args.confirmHighLeverage),
    });
  }

  if (name === "list_positions") {
    return listPositions(owner);
  }

  if (name === "close_position") {
    const market = args.market as Market;
    if (!market) throw new Error("market required");
    return closePosition({ owner, market }, { session, adapter: "mcp" });
  }

  if (name === "privacy_status") {
    return privacyStatus(owner, session);
  }

  throw new Error(`unknown tool ${name}`);
}

async function handle(req: RpcReq): Promise<unknown> {
  const { method, id, params } = req;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "cairobot", version: "2.0.0" },
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    try {
      const result = await callTool(name, args);
      return ok(id, textResult(result));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ok(id, { isError: true, ...textResult({ error: message }) });
    }
  }
  if (method === "ping") return ok(id, {});
  return err(id, -32601, `method not found: ${method}`);
}

async function stdio(): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  process.stdin.on("data", async (chunk: Buffer) => {
    buffer += decoder.decode(chunk);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      const nlEnd = buffer.indexOf("\n\n");
      let split = -1;
      let sepLen = 0;
      if (headerEnd >= 0) {
        split = headerEnd;
        sepLen = 4;
      } else if (nlEnd >= 0) {
        split = nlEnd;
        sepLen = 2;
      }
      if (split < 0) {
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd < 0) break;
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line) continue;
        try {
          const req = JSON.parse(line) as RpcReq;
          const res = await handle(req);
          if (res) process.stdout.write(JSON.stringify(res) + "\n");
        } catch (e) {
          process.stdout.write(
            JSON.stringify(err(null, -32700, e instanceof Error ? e.message : "parse error")) + "\n",
          );
        }
        continue;
      }
      const header = buffer.slice(0, split);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(split + sepLen);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = split + sepLen;
      if (buffer.length < bodyStart + length) break;
      const body = buffer.slice(bodyStart, bodyStart + length);
      buffer = buffer.slice(bodyStart + length);
      try {
        const req = JSON.parse(body) as RpcReq;
        const res = await handle(req);
        if (res) {
          const payload = JSON.stringify(res);
          process.stdout.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
        }
      } catch (e) {
        const payload = JSON.stringify(err(null, -32700, e instanceof Error ? e.message : "parse error"));
        process.stdout.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
      }
    }
  });
}

stdio();
