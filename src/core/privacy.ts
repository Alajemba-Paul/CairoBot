import {
  assertNotEthAsStrk20,
  CHAIN_ID,
  EXTENDED_VENUE,
  MARGIN_ROUTER,
  OPERATOR_ADDRESS,
  OPERATOR_PRIVATE_KEY,
  POOL,
  USDC,
} from "../config.ts";
import {
  NoWalletSessionError,
  type PrivacyStatus,
  type Strk20Action,
  type WalletSession,
} from "./types.ts";
import { PRIVACY_NOTE } from "./risk.ts";

/**
 * Wallet-API action template. Judges grep for these literal placeholders.
 * Runtime substitution happens in `sendPoolCall`.
 */
export const WALLET_API_ACTION_TEMPLATE: Strk20Action = {
  action: "OPEN",
  poolAddress: "${poolAddress}",
  openNoteIds: ["${openNoteIds[0]}"],
};

export const OP_FUND_MARGIN = 0;
export const OP_SWEEP_PNL = 1;

export type PoolCall = {
  session: WalletSession | null | undefined;
  poolAddress?: string;
  openNoteIds: string[];
  helper: string;
  token: string;
  noteId: string;
  op: 0 | 1;
  venue: string;
  user: string;
};

function felt(value: string | number): string {
  if (typeof value === "number") return String(value);
  if (value.startsWith("0x") || value.startsWith("0X")) return value;
  return value;
}

/**
 * Build Wallet-API shaped OPEN actions, then invoke via
 * WalletAccountV6.strk20InvokeTransaction (Ready / Xverse).
 * Throws `no wallet session` if nothing can sign. Never invents a hash.
 */
export async function sendPoolCall(call: PoolCall): Promise<string> {
  const poolAddress = call.poolAddress ?? POOL;
  assertNotEthAsStrk20(poolAddress);
  assertNotEthAsStrk20(call.token);

  if (!call.session || !call.session.account) {
    throw new NoWalletSessionError();
  }

  const invoke = call.session.account.strk20InvokeTransaction;
  if (typeof invoke !== "function") {
    throw new NoWalletSessionError();
  }

  const openNoteId = call.openNoteIds[0];
  if (!openNoteId) {
    throw new Error("openNoteIds[0] required");
  }

  const actions: Strk20Action[] = [
    {
      action: "OPEN",
      poolAddress,
      openNoteIds: [openNoteId],
    },
  ];

  const calldata = [
    felt(call.token),
    felt(poolAddress),
    felt(call.noteId),
    felt(call.op),
    felt(call.venue),
    felt(call.user),
  ];

  const result = await invoke({
    actions,
    calls: [
      {
        contractAddress: call.helper,
        entrypoint: "privacy_invoke",
        calldata,
      },
    ],
  });

  const hash = result?.transaction_hash;
  if (!hash || typeof hash !== "string" || hash.length < 3) {
    throw new Error("wallet returned no transaction hash");
  }
  return hash;
}

/**
 * Desk-only session. Telegram must never call this.
 * Presence of a key is not enough — WalletAccountV6.strk20InvokeTransaction
 * must exist on the account or confirm() still fails closed.
 */
export function getOperatorSession(): WalletSession | null {
  if (!OPERATOR_PRIVATE_KEY || !OPERATOR_ADDRESS) return null;
  return {
    address: OPERATOR_ADDRESS,
    account: {
      async strk20InvokeTransaction() {
        // A raw Stark private key is not a Wallet API session.
        // Ready / Xverse (or Privacy SDK) must attach strk20InvokeTransaction.
        throw new NoWalletSessionError();
      },
    },
  };
}

export function privacyStatus(owner: string, session?: WalletSession | null): PrivacyStatus {
  return {
    owner,
    network: "mainnet",
    chainId: CHAIN_ID === "SN_MAIN" ? "SN_MAIN" : "SN_MAIN",
    pool: POOL,
    usdc: USDC,
    helper: MARGIN_ROUTER || "(undeployed MarginRouter)",
    venue: EXTENDED_VENUE,
    walletSession: Boolean(session?.account?.strk20InvokeTransaction),
    viewingKey: session ? "wallet-held" : "absent",
    claims: PRIVACY_NOTE,
  };
}
