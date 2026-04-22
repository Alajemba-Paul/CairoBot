import { StarkZap, StarkSigner, OnboardStrategy } from 'starkzap';
import type { Call } from 'starkzap';
import type { WalletInterface } from 'starkzap';
import { config } from '../config';

// STRK20 confidential fund contract address on Starknet Sepolia
const STRK20_CONFIDENTIAL_CONTRACT =
  '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';

export interface RealWallet {
  address: string;
  execute: (calls: Call[]) => Promise<{ transaction_hash: string; explorerUrl: string }>;
  shieldedTransfer: (amount: number) => Promise<void>;
}

export class StarkZapService {
  private sdk!: StarkZap;
  private walletCache: Map<string, RealWallet> = new Map();

  async init(): Promise<void> {
    this.sdk = new StarkZap({ network: config.NETWORK });
  }

  async getWallet(userId: number | string): Promise<RealWallet> {
    const key = String(userId);

    if (this.walletCache.has(key)) {
      return this.walletCache.get(key)!;
    }

    const { wallet } = await this.sdk.onboard({
      strategy: OnboardStrategy.Signer,
      account: { signer: new StarkSigner(config.EXTENDED_STARK_PRIVATE_KEY) },
      deploy: 'if_needed',
    });

    const realWallet = this.toRealWallet(wallet);
    this.walletCache.set(key, realWallet);
    return realWallet;
  }

  async enableShieldedMargin(walletAddress: string, amount: number): Promise<void> {
    const cached = [...this.walletCache.values()].find(
      (w) => w.address === walletAddress
    );

    if (!cached) {
      throw new Error(`No cached wallet found for address ${walletAddress}`);
    }

    // Re-fetch the underlying SDK wallet to access tx() builder
    const { wallet } = await this.sdk.onboard({
      strategy: OnboardStrategy.Signer,
      account: { signer: new StarkSigner(config.EXTENDED_STARK_PRIVATE_KEY) },
      deploy: 'if_needed',
    });

    // Build a raw confidential_fund call via the STRK20 privacy module
    const amountLow = BigInt(Math.floor(amount * 1e6)).toString();
    const amountHigh = '0';

    const tx = await wallet
      .tx()
      .add({
        contractAddress: STRK20_CONFIDENTIAL_CONTRACT,
        entrypoint: 'confidential_fund',
        calldata: [amountLow, amountHigh],
      })
      .send();

    await tx.wait();
    console.log(`[StarkZap] Shielded ${amount} USDC for ${walletAddress} — tx: ${tx.hash}`);
  }

  private toRealWallet(wallet: WalletInterface): RealWallet {
    return {
      address: wallet.address,
      execute: async (calls: Call[]) => {
        const tx = await wallet.execute(calls);
        return { transaction_hash: tx.hash, explorerUrl: tx.explorerUrl };
      },
      shieldedTransfer: async (amount: number) => {
        await this.enableShieldedMargin(wallet.address, amount);
      },
    };
  }
}

export const starkZap = new StarkZapService();
