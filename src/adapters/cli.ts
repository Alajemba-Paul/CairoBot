#!/usr/bin/env node
/**
 * CairoBot CLI — parse | preview | confirm | positions | close | privacy
 * `parse` works with no env. `preview` hits Extended mainnet marks.
 * `confirm` fails closed without a wallet session (never a fake hash).
 */
import { parseCloseIntent, parseTradeIntent } from "../core/intent.ts";
import { confirmTrade, listPositions, previewTrade, privacyStatus, closePosition } from "../core/engine.ts";
import { formatPreviewCard } from "../core/risk.ts";
import { getOperatorSession } from "../core/privacy.ts";
import { NoWalletSessionError } from "../core/types.ts";

type Json = Record<string, unknown> | unknown[];

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((a) => a.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

function restText(fromIndex: number): string {
  return process.argv
    .slice(fromIndex)
    .filter((a) => a !== "--json" && !a.startsWith("--market") && a !== "--owner" && !a.startsWith("--owner="))
    .join(" ")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function print(data: unknown, json: boolean, fallback: string): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(fallback);
}

function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (hasFlag("--json")) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
  process.exit(1);
}

function usage(): string {
  return `CairoBot — private perps on Extended

Usage:
  cairobot parse    "<nl>" [--json]
  cairobot preview  "<nl>" [--json]
  cairobot confirm  <previewId> [--json]
  cairobot positions [--owner <addr>] [--json]
  cairobot close    --market SOL-USD [--json]
  cairobot privacy  [--owner <addr>] [--json]

Examples:
  cairobot parse "long sol 10x 50 usdc tp @ 200"
  cairobot preview "short btc 5x 100 usdc sl @ 90000"
`;
}

async function main(): Promise<void> {
  const json = hasFlag("--json");
  const argv = process.argv.slice(2).filter((a) => a !== "--json");
  const command = (argv[0] ?? "help").toLowerCase();
  const owner = argValue("--owner") ?? process.env.OPERATOR_ADDRESS ?? "cli";

  try {
    if (command === "help" || command === "-h" || command === "--help") {
      console.log(usage());
      return;
    }

    if (command === "parse") {
      const text = restText(process.argv.indexOf("parse") + 1);
      if (!text) fail(new Error("parse requires a quoted order, e.g. long sol 10x 50 usdc tp @ 200"));
      const intent = parseTradeIntent(text, owner);
      print(intent as unknown as Json, json, JSON.stringify(intent, null, 2));
      return;
    }

    if (command === "preview") {
      const text = restText(process.argv.indexOf("preview") + 1);
      if (!text) fail(new Error("preview requires a quoted order"));
      const intent = parseTradeIntent(text, owner);
      const preview = await previewTrade(intent);
      print(preview as unknown as Json, json, formatPreviewCard(preview));
      return;
    }

    if (command === "confirm") {
      const previewId = argv[1];
      if (!previewId) fail(new Error("confirm requires a preview id"));
      const session = getOperatorSession();
      const receipt = await confirmTrade(previewId, { session, adapter: "cli" });
      print(receipt as unknown as Json, json, `filled ${receipt.market}  fund=${receipt.fundTxHash}`);
      return;
    }

    if (command === "positions") {
      const rows = await listPositions(owner);
      print(rows as unknown as Json, json, rows.length === 0 ? "no open positions" : JSON.stringify(rows, null, 2));
      return;
    }

    if (command === "close") {
      const marketRaw = argValue("--market") ?? argv[1];
      if (!marketRaw) fail(new Error("close requires --market BTC-USD|ETH-USD|SOL-USD|STRK-USD"));
      const close = parseCloseIntent(`close ${marketRaw}`, owner);
      const session = getOperatorSession();
      const result = await closePosition(close, { session, adapter: "cli" });
      print(result as unknown as Json, json, `closed ${close.market}  sweep=${result.sweepTxHash}`);
      return;
    }

    if (command === "privacy") {
      const status = privacyStatus(owner, getOperatorSession());
      print(status as unknown as Json, json, JSON.stringify(status, null, 2));
      return;
    }

    fail(new Error(usage()));
  } catch (err) {
    if (err instanceof NoWalletSessionError) fail(err);
    fail(err);
  }
}

main();
