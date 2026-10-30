import { describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import { createEvmOrigin } from "../../src/origins/evm";
import { createFakeEvmChain, type FakeTransfer } from "./fixtures/evm.fixture";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const DEPOSIT = "0x76b4c56085ED136a8744D52bE956396624a730E8" as Address;
const PAYER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const TX = `0x${"ab".repeat(32)}` as Hash;
const target = { network: "eip155:8453", depositAddress: DEPOSIT, asset: USDC_BASE };
const order = { ...target, amount: "1000000" };

const transfer = (overrides: Partial<FakeTransfer> = {}): FakeTransfer => ({
  asset: USDC_BASE,
  from: PAYER,
  to: DEPOSIT,
  amount: 1_000_000n,
  ...overrides,
});

describe("createEvmOrigin", () => {
  it("validates addresses and transaction hashes", () => {
    const origin = createEvmOrigin();
    expect(origin.isAddress(DEPOSIT)).toBe(true);
    expect(origin.isAddress(DEPOSIT.toLowerCase())).toBe(true);
    expect(origin.isAddress(`0x${DEPOSIT.slice(2).toUpperCase()}`)).toBe(false);
    expect(origin.isAddress("0x1234")).toBe(false);
    expect(origin.isTxHash(TX)).toBe(true);
    expect(origin.isTxHash(`0x${"0".repeat(64)}`)).toBe(false);
    expect(origin.isTxHash("0xabc")).toBe(false);
    expect(origin.isTxHash(TX.slice(2))).toBe(false);
  });

  it("exposes the EVM default-asset table for spend controls", () => {
    const origin = createEvmOrigin();
    expect(origin.findDefaultAsset?.(USDC_BASE, "eip155:8453")?.symbol).toBe("USDC");
    expect(origin.findDefaultAsset?.(OTHER, "eip155:8453")).toBeUndefined();
  });

  it("offers reading and sending only with the matching clients", () => {
    const { publicClient, walletClient } = createFakeEvmChain();
    expect(createEvmOrigin().readDeposit).toBeUndefined();
    expect(createEvmOrigin({ publicClient }).readDeposit).toBeDefined();
    expect(createEvmOrigin({ publicClient }).sendDeposit).toBeUndefined();
    expect(createEvmOrigin({ walletClient }).sendDeposit).toBeUndefined();
    expect(createEvmOrigin({ publicClient, walletClient }).sendDeposit).toBeDefined();
  });

  describe("readDeposit", () => {
    it("reports unknown, pending and confirmed transactions", async () => {
      const chain = createFakeEvmChain();
      const origin = createEvmOrigin({ publicClient: chain.publicClient });
      expect(await origin.readDeposit!(target, TX)).toEqual({ state: "unknown" });
      chain.broadcast(TX);
      expect(await origin.readDeposit!(target, TX)).toEqual({ state: "pending" });
      chain.mine(TX, [transfer()]);
      expect(await origin.readDeposit!(target, TX)).toEqual({ state: "confirmed", payer: PAYER });
    });

    it("matches the asset and the deposit address regardless of case", async () => {
      const chain = createFakeEvmChain();
      const origin = createEvmOrigin({ publicClient: chain.publicClient });
      chain.mine(TX, [transfer({ asset: USDC_BASE.toLowerCase() as Address })]);
      const lowercase = { ...target, depositAddress: DEPOSIT.toLowerCase() };
      expect(await origin.readDeposit!(lowercase, TX)).toEqual({
        state: "confirmed",
        payer: PAYER,
      });
    });

    it("rejects reverted transactions and transfers that do not pay the instrument", async () => {
      const chain = createFakeEvmChain();
      const origin = createEvmOrigin({ publicClient: chain.publicClient });
      const cases: [Hash, FakeTransfer[], "success" | "reverted"][] = [
        [`0x${"01".repeat(32)}`, [transfer()], "reverted"],
        [`0x${"02".repeat(32)}`, [transfer({ to: OTHER })], "success"],
        [`0x${"03".repeat(32)}`, [transfer({ asset: OTHER })], "success"],
        [`0x${"04".repeat(32)}`, [], "success"],
      ];
      for (const [hash, transfers, status] of cases) {
        chain.mine(hash, transfers, status);
        expect(await origin.readDeposit!(target, hash)).toEqual({ state: "confirmed-no-match" });
      }
    });

    it("propagates RPC failures", async () => {
      const publicClient = {
        ...createFakeEvmChain().publicClient,
        getTransactionReceipt: async () => {
          throw new Error("rpc down");
        },
      };
      const origin = createEvmOrigin({ publicClient });
      await expect(origin.readDeposit!(target, TX)).rejects.toThrow("rpc down");
    });
  });

  describe("sendDeposit", () => {
    it("transfers the amount, reports the broadcast hash first and returns the confirmed hash", async () => {
      const chain = createFakeEvmChain();
      const origin = createEvmOrigin(chain);
      const onBroadcast = vi.fn((hash: string) => {
        chain.mine(hash as Hash, [transfer()]);
      });
      const result = await origin.sendDeposit!(order, onBroadcast);
      expect(chain.writes).toHaveLength(1);
      expect(chain.writes[0]).toMatchObject({
        address: USDC_BASE,
        functionName: "transfer",
        args: [DEPOSIT, 1_000_000n],
      });
      expect(onBroadcast).toHaveBeenCalledWith(chain.writes[0].hash);
      expect(result).toEqual({ txHash: chain.writes[0].hash });
    });

    it("returns the replacement hash when the wallet replaced the transaction", async () => {
      const chain = createFakeEvmChain();
      const origin = createEvmOrigin(chain);
      const replacement = `0x${"99".repeat(32)}` as Hash;
      const result = await origin.sendDeposit!(order, hash => {
        chain.replace(hash as Hash, replacement, [transfer()]);
      });
      expect(result).toEqual({ txHash: replacement });
    });

    it("returns the broadcast hash when confirmation times out", async () => {
      const chain = createFakeEvmChain();
      const origin = createEvmOrigin({ ...chain, confirmationTimeoutMs: 10 });
      const result = await origin.sendDeposit!(order);
      expect(result).toEqual({ txHash: chain.writes[0].hash });
    });

    it("propagates other confirmation failures", async () => {
      const chain = createFakeEvmChain();
      const publicClient = {
        ...chain.publicClient,
        waitForTransactionReceipt: async () => {
          throw new Error("rpc down");
        },
      };
      const origin = createEvmOrigin({ publicClient, walletClient: chain.walletClient });
      await expect(origin.sendDeposit!(order)).rejects.toThrow("rpc down");
    });
  });
});

describe("createEvmOrigin bound to a network", () => {
  const BASE = "eip155:8453";

  it("refuses clients connected to another chain and non-eip155 networks", () => {
    const chain = createFakeEvmChain();
    const onArbitrum = { ...chain.publicClient, chain: { id: 42161 } };
    expect(() => createEvmOrigin({ network: BASE, publicClient: onArbitrum })).toThrow(
      /chain 42161/,
    );
    expect(() => createEvmOrigin({ network: "solana:mainnet" })).toThrow(/not an eip155/);
    const onBase = { ...chain.publicClient, chain: { id: 8453 } };
    expect(createEvmOrigin({ network: BASE, publicClient: onBase }).network).toBe(BASE);
  });

  it("serves only its network", async () => {
    const chain = createFakeEvmChain();
    const origin = createEvmOrigin({ network: BASE, ...chain });
    const onBase = { network: BASE, depositAddress: DEPOSIT, asset: USDC_BASE };
    expect(await origin.readDeposit!(onBase, TX)).toEqual({ state: "unknown" });
    await expect(origin.readDeposit!({ ...onBase, network: "eip155:42161" }, TX)).rejects.toThrow(
      /cannot serve eip155:42161/,
    );
    await expect(
      origin.sendDeposit!({ ...onBase, network: "eip155:1", amount: "1" }),
    ).rejects.toThrow(/cannot serve eip155:1/);
    expect(chain.writes).toHaveLength(0);
  });
});
