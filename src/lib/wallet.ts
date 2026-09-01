import { MARGIN_ROUTER } from "@/config";
import { SN_MAIN } from "@/core/constants";
import { sendPoolCall } from "@/core/privacy";
import {
  NoWalletSessionError,
  type Preview,
  type Receipt,
  type Strk20InvokePayload,
  type WalletSession,
} from "@/core/types";

type Injected = {
  id?: string;
  name?: string;
  isConnected?: boolean;
  selectedAddress?: string;
  account?: {
    address?: string;
    strk20InvokeTransaction?: (
      payload: Strk20InvokePayload,
    ) => Promise<{ transaction_hash?: string }>;
  };
  enable?: (opts?: { starknetVersion?: string }) => Promise<string[] | void>;
  request?: (args: { type: string; params?: unknown }) => Promise<unknown>;
};

function injectedWallets(): Injected[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as Record<string, Injected | undefined>;
  const keys = [
    "starknet_ready",
    "starknet-ready",
    "starknet_argentX",
    "starknet-argentX",
    "starknet_xverse",
    "starknet-xverse",
    "starknet",
  ];
  const found: Injected[] = [];
  for (const key of keys) {
    const wallet = w[key];
    if (wallet && !found.includes(wallet)) found.push(wallet);
  }
  return found;
}

export function isEmbeddedPreview(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function hasInjectedWallet(): boolean {
  return injectedWallets().length > 0;
}

function addressOf(wallet: Injected): string {
  return (
    wallet.selectedAddress ||
    wallet.account?.address ||
    ""
  );
}

export async function connectWallet(): Promise<WalletSession> {
  const wallets = injectedWallets();
  if (wallets.length === 0) {
    throw new NoWalletSessionError(
      "no wallet session — install Ready or Xverse, then open this desk outside an iframe",
    );
  }
  const wallet = wallets[0];
  if (typeof wallet.enable === "function") {
    await wallet.enable({ starknetVersion: "v5" });
  } else if (typeof wallet.request === "function") {
    await wallet.request({ type: "wallet_requestAccount" }).catch(() => undefined);
  }
  const address = addressOf(wallet);
  if (!address) throw new NoWalletSessionError();

  const account = {
    strk20InvokeTransaction: async (payload: Strk20InvokePayload) => {
      if (typeof wallet.account?.strk20InvokeTransaction === "function") {
        return wallet.account.strk20InvokeTransaction(payload);
      }
      if (typeof wallet.request === "function") {
        const result = (await wallet.request({
          type: "wallet_strk20InvokeTransaction",
          params: payload,
        })) as { transaction_hash?: string };
        return result;
      }
      throw new NoWalletSessionError();
    },
  };

  return { address, account };
}

export function helperAddress(): string {
  try {
    const vite = (import.meta as { env?: Record<string, string | undefined> }).env;
    const fromVite = vite?.VITE_MARGIN_ROUTER;
    if (fromVite && fromVite.length > 0) return fromVite;
  } catch {
    /* Node CLI has no Vite env */
  }
  return MARGIN_ROUTER;
}

export async function confirmWithWallet(
  preview: Preview,
  session: WalletSession,
): Promise<Receipt> {
  const helper = helperAddress();
  if (!helper) {
    throw new Error(
      "MarginRouter undeployed. Deploy cairo/ on SN_MAIN and set VITE_MARGIN_ROUTER.",
    );
  }
  const noteId = `0x${Date.now().toString(16)}`;
  const fundTxHash = await sendPoolCall({
    session,
    poolAddress: SN_MAIN.POOL,
    openNoteIds: [noteId],
    helper,
    token: SN_MAIN.USDC,
    noteId,
    op: 0,
    venue: SN_MAIN.EXTENDED_VENUE,
    user: session.address,
  });
  return {
    previewId: preview.id,
    owner: session.address,
    market: preview.intent.market,
    side: preview.intent.side,
    leverage: preview.intent.leverage,
    marginUsdc: preview.intent.marginUsdc,
    fundTxHash,
    placedAt: Date.now(),
  };
}

export function telegramUrl(): string {
  try {
    const vite = (import.meta as { env?: Record<string, string | undefined> }).env;
    const bot = vite?.VITE_TELEGRAM_BOT;
    if (bot && bot.length > 0) return `https://t.me/${bot.replace(/^@/, "")}`;
  } catch {
    /* ignore */
  }
  return "";
}
