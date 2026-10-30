import { findDefaultAsset } from "@x402/evm";
import {
  erc20Abi,
  isAddress,
  isHash,
  parseEventLogs,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import type { Log } from "viem";
import type { DepositOrder, DepositReading, DepositTarget, OriginAdapter } from "./index";

type Hex = `0x${string}`;

/** The viem `PublicClient` methods the adapter uses. */
export interface EvmPublicClient {
  /** Configured chain, when the client carries one; checked against the bound network. */
  chain?: { id: number };
  getTransactionReceipt(args: { hash: Hex }): Promise<{ status: string; logs: Log[] }>;
  getTransaction(args: { hash: Hex }): Promise<unknown>;
  waitForTransactionReceipt(args: {
    hash: Hex;
    timeout?: number;
    onReplaced?: (replacement: { transaction: { hash: Hex } }) => void;
  }): Promise<unknown>;
}

/** The viem `WalletClient` method the adapter uses; the client must carry its account and chain. */
export interface EvmWalletClient {
  /** Configured chain, when the client carries one; checked against the bound network. */
  chain?: { id: number };
  writeContract(args: {
    address: Hex;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<Hex>;
}

export interface EvmOriginConfig {
  /**
   * CAIP-2 network the clients are connected to, e.g. `eip155:8453`. The adapter then refuses
   * targets on any other network. Omit only for a single-chain deployment keyed by namespace.
   */
  network?: string;
  /** Enables `readDeposit`, and the confirmation wait of `sendDeposit`. */
  publicClient?: EvmPublicClient;
  /** Enables `sendDeposit`, together with `publicClient`. */
  walletClient?: EvmWalletClient;
  /** Bound on the confirmation wait after sending. Defaults to viem's 180 000. */
  confirmationTimeoutMs?: number;
}

/**
 * Origin adapter for `eip155` networks: ERC-20 deposits, read through `Transfer` logs.
 *
 * @param config - viem clients, the network they serve and the confirmation bound
 * @returns The adapter, with reading and sending only where the clients allow
 */
export function createEvmOrigin(config: EvmOriginConfig = {}): OriginAdapter {
  const { network, publicClient, walletClient, confirmationTimeoutMs } = config;
  if (network !== undefined) {
    const chainId = evmChainId(network);
    for (const [label, client] of [
      ["publicClient", publicClient],
      ["walletClient", walletClient],
    ] as const) {
      if (client?.chain !== undefined && client.chain.id !== chainId) {
        throw new Error(
          `near-intents: ${label} is connected to chain ${client.chain.id}, not to ${network}`,
        );
      }
    }
  }
  const assertNetwork = (requested: string): void => {
    if (network !== undefined && requested !== network) {
      throw new Error(`near-intents: origin adapter for ${network} cannot serve ${requested}`);
    }
  };
  const adapter: OriginAdapter = {
    ...(network !== undefined && { network }),
    isAddress: address => isAddress(address),
    isTxHash: hash => isHash(hash) && !/^0x0+$/.test(hash),
    findDefaultAsset,
  };
  if (publicClient) {
    adapter.readDeposit = async (target, txHash) => {
      assertNetwork(target.network);
      return readDeposit(publicClient, target, txHash);
    };
  }
  if (publicClient && walletClient) {
    adapter.sendDeposit = async (order, onBroadcast) => {
      assertNetwork(order.network);
      return sendDeposit(publicClient, walletClient, confirmationTimeoutMs, order, onBroadcast);
    };
  }
  return adapter;
}

/**
 * Chain id of an `eip155` CAIP-2 network.
 *
 * @param network - CAIP-2 network
 * @returns The chain id
 */
function evmChainId(network: string): number {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match) {
    throw new Error(`near-intents: "${network}" is not an eip155 network`);
  }
  return Number(match[1]);
}

/**
 * Reads the receipt of `txHash` and looks for an ERC-20 `Transfer` of the target's asset to
 * its deposit address.
 *
 * @param client - Public client
 * @param target - Instrument and asset
 * @param txHash - Transaction to read
 * @returns The reading
 */
async function readDeposit(
  client: EvmPublicClient,
  target: DepositTarget,
  txHash: string,
): Promise<DepositReading> {
  const hash = txHash as Hex;
  let receipt: { status: string; logs: Log[] };
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (!(error instanceof TransactionReceiptNotFoundError)) {
      throw error;
    }
    try {
      await client.getTransaction({ hash });
      return { state: "pending" };
    } catch (inner) {
      if (inner instanceof TransactionNotFoundError) {
        return { state: "unknown" };
      }
      throw inner;
    }
  }
  if (receipt.status !== "success") {
    return { state: "confirmed-no-match" };
  }
  const asset = target.asset.toLowerCase();
  const depositAddress = target.depositAddress.toLowerCase();
  const transfer = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs,
  }).find(
    log => log.address.toLowerCase() === asset && log.args.to.toLowerCase() === depositAddress,
  );
  return transfer
    ? { state: "confirmed", payer: transfer.args.from }
    : { state: "confirmed-no-match" };
}

/**
 * Sends an ERC-20 `transfer` and waits for it to confirm, following wallet replacements.
 *
 * @param publicClient - Public client for the confirmation wait
 * @param walletClient - Wallet client that sends the transfer
 * @param timeout - Confirmation wait bound in milliseconds
 * @param order - Instrument, asset and amount
 * @param onBroadcast - Called with the broadcast hash before the wait
 * @returns The hash to present
 */
async function sendDeposit(
  publicClient: EvmPublicClient,
  walletClient: EvmWalletClient,
  timeout: number | undefined,
  order: DepositOrder,
  onBroadcast?: (txHash: string) => void | Promise<void>,
): Promise<{ txHash: string }> {
  const sent = await walletClient.writeContract({
    address: order.asset as Hex,
    abi: erc20Abi,
    functionName: "transfer",
    args: [order.depositAddress as Hex, BigInt(order.amount)],
  });
  await onBroadcast?.(sent);
  let confirmed: Hex = sent;
  try {
    await publicClient.waitForTransactionReceipt({
      hash: sent,
      timeout,
      onReplaced: replacement => {
        confirmed = replacement.transaction.hash;
      },
    });
  } catch (error) {
    if (!(error instanceof WaitForTransactionReceiptTimeoutError)) {
      throw error;
    }
  }
  return { txHash: confirmed };
}
