import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import type { Address, Hash, Log } from "viem";
import type { EvmPublicClient, EvmWalletClient } from "../../../src/origins/evm";

export interface FakeTransfer {
  asset: Address;
  from: Address;
  to: Address;
  amount: bigint;
}

export interface FakeEvmChain {
  publicClient: EvmPublicClient;
  walletClient: EvmWalletClient;
  /** Contract writes made through `walletClient`, oldest first. */
  writes: { address: Address; functionName: string; args: readonly unknown[]; hash: Hash }[];
  /** Makes `hash` visible as an unmined transaction. */
  broadcast(hash: Hash): void;
  /** Mines `hash` with one ERC-20 `Transfer` log per entry of `transfers`. */
  mine(hash: Hash, transfers: FakeTransfer[], status?: "success" | "reverted"): void;
  /** The next receipt wait for `hash` reports `replacement` instead, mined with `transfers`. */
  replace(hash: Hash, replacement: Hash, transfers: FakeTransfer[]): void;
}

const ZERO_HASH = `0x${"0".repeat(64)}` as Hash;

/**
 * Minimal stand-in for the viem client methods the EVM origin adapter uses, with real
 * ABI-encoded `Transfer` logs so the adapter's log parsing is exercised.
 *
 * @returns The fake chain and its handles
 */
export function createFakeEvmChain(): FakeEvmChain {
  const receipts = new Map<Hash, { status: "success" | "reverted"; logs: Log[] }>();
  const mempool = new Set<Hash>();
  const replacements = new Map<Hash, Hash>();
  const writes: FakeEvmChain["writes"] = [];

  const transferLog = (hash: Hash, transfer: FakeTransfer, logIndex: number): Log => ({
    address: transfer.asset,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: transfer.from, to: transfer.to },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [transfer.amount]),
    blockHash: ZERO_HASH,
    blockNumber: 1n,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex,
    removed: false,
  });

  const mine: FakeEvmChain["mine"] = (hash, transfers, status = "success") => {
    receipts.set(hash, {
      status,
      logs: transfers.map((transfer, index) => transferLog(hash, transfer, index)),
    });
    mempool.delete(hash);
  };

  return {
    publicClient: {
      async getTransactionReceipt({ hash }) {
        const receipt = receipts.get(hash);
        if (!receipt) {
          throw new TransactionReceiptNotFoundError({ hash });
        }
        return receipt;
      },
      async getTransaction({ hash }) {
        if (!mempool.has(hash) && !receipts.has(hash)) {
          throw new TransactionNotFoundError({ hash });
        }
        return { hash };
      },
      async waitForTransactionReceipt({ hash, onReplaced }) {
        const replacement = replacements.get(hash);
        if (replacement !== undefined) {
          onReplaced?.({ transaction: { hash: replacement } });
          return receipts.get(replacement);
        }
        const receipt = receipts.get(hash);
        if (!receipt) {
          throw new WaitForTransactionReceiptTimeoutError({ hash });
        }
        return receipt;
      },
    },
    walletClient: {
      async writeContract({ address, functionName, args }) {
        const hash = `0x${(writes.length + 1).toString(16).padStart(64, "0")}` as Hash;
        writes.push({ address, functionName, args, hash });
        mempool.add(hash);
        return hash;
      },
    },
    writes,
    broadcast(hash) {
      mempool.add(hash);
    },
    mine,
    replace(hash, replacement, transfers) {
      replacements.set(hash, replacement);
      mine(replacement, transfers);
    },
  };
}
