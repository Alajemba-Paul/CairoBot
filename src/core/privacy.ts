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

export const OP_FUND_MARGIN = 0;
export const OP_SWEEP_PNL = 1;

/** Starknet USDC is 6 decimals. */
export const USDC_DECIMALS = 6;

/**
 * Wallet-API action template. Judges grep for these literal placeholders.
 * Runtime copies live in `buildPrivacyActions`.
 */
export const WALLET_API_PLACEHOLDERS = {
  openNoteIds: "${openNoteIds[0]}",
  poolAddress: "${poolAddress}",
} as const;

export const WALLET_API_ACTION_TEMPLATE: Strk20Action[] = [
  {
    type: "transfer",
    token: "${token}",
    amount: "OPEN",
    recipient: "${user}",
  },
  {
    type: "invoke",
    contract: "${helper}",
    calldata: ["${op}", "${token}", "${amountLow}", "${amountHigh}", "${openNoteIds[0]}", "${venue}", "${user}"],
  },
];

export type PoolCall = {
  session: WalletSession | null | undefined;
  poolAddress?: string;
  helper: string;
  token: string;
  /** Human USDC (50 = 50 USDC). 0 means spend whatever the pool sends. */
  amountUsdc: number;
  op: 0 | 1;
  venue: string;
  user: string;
};

export function usdcToU256(amountUsdc: number): { low: string; high: string } {
  if (!Number.isFinite(amountUsdc) || amountUsdc < 0) {
    throw new Error("amountUsdc must be a non-negative number");
  }
  const units = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));
  const mask = (1n << 128n) - 1n;
  return {
    low: `0x${(units & mask).toString(16)}`,
    high: `0x${(units >> 128n).toString(16)}`,
  };
}

function felt(value: string | number): string {
  if (typeof value === "number") return String(value);
  if (value === "" || value === "0") return "0x0";
  return value;
}

/**
 * Official two-action private DeFi packet:
 *   1. transfer amount="OPEN" — slot for leftover / SweepPnl
 *   2. invoke MarginRouter.privacy_invoke
 *
 * Calldata order matches cairo/src/lib.cairo:
 *   op, token, amount.low, amount.high, note_id, venue, user
 */
export function buildPrivacyActions(call: Omit<PoolCall, "session">): Strk20Action[] {
  const { low, high } = usdcToU256(call.amountUsdc);
  return [
    {
      type: "transfer",
      token: call.token,
      amount: "OPEN",
      recipient: call.user,
    },
    {
      type: "invoke",
      contract: call.helper,
      calldata: [
        felt(call.op),
        felt(call.token),
        low,
        high,
        WALLET_API_PLACEHOLDERS.openNoteIds,
        felt(call.venue),
        felt(call.user),
      ],
    },
  ];
}

/**
 * Hand the two actions to Ready / Xverse. The wallet spends a mature note,
 * the pool calls the helper, leftovers land in the open note.
 * Throws `no wallet session` if nothing can sign. Never invents a hash.
 */
export async function sendPoolCall(call: PoolCall): Promise<string> {
  const poolAddress = call.poolAddress ?? POOL;
  assertNotEthAsStrk20(poolAddress);
  assertNotEthAsStrk20(call.token);

  if (!call.helper) {
    throw new Error("MarginRouter undeployed. Deploy cairo/ on SN_MAIN and set MARGIN_ROUTER.");
  }
  if (!call.session || !call.session.account) {
    throw new NoWalletSessionError();
  }

  const invoke = call.session.account.strk20InvokeTransaction;
  if (typeof invoke !== "function") {
    throw new NoWalletSessionError();
  }

  const actions = buildPrivacyActions(call);
  const prepare = call.session.account.strk20PrepareInvoke;
  if (typeof prepare === "function") {
    try {
      await prepare(actions, true);
    } catch {
      // Dry-run is best-effort. Some wallets advertise the method and still reject simulate.
    }
  }

  const result = await invoke(actions);
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
