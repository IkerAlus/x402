import { describe, expect, it } from "vitest";
import { ONE_CLICK_BLOCKCHAINS } from "../../src/constants";
import { findToken } from "../../src/oneclick/assets";
import { defaultTokens } from "./fixtures/oneclick.fixture";

const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC_ARBITRUM = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

describe("findToken", () => {
  it("resolves EVM assets case-insensitively", () => {
    const token = findToken(
      defaultTokens,
      "eip155:42161",
      "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    );
    expect(token?.assetId).toBe("nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near");
    expect(token?.decimals).toBe(6);
    expect(
      findToken(defaultTokens, "eip155:8453", "0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913")?.symbol,
    ).toBe("USDC");
  });

  it("resolves Solana mints exactly and NEAR contracts by account id", () => {
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    expect(findToken(defaultTokens, SOLANA, mint)?.blockchain).toBe("sol");
    expect(findToken(defaultTokens, SOLANA, mint.toLowerCase())).toBeUndefined();
    expect(findToken(defaultTokens, "near:mainnet", "wrap.near")?.assetId).toBe("nep141:wrap.near");
  });

  it("never matches chain-native assets or assets on the wrong network", () => {
    expect(findToken(defaultTokens, "eip155:42161", "ETH")).toBeUndefined();
    expect(findToken(defaultTokens, "eip155:42161", "nep141:arb.omft.near")).toBeUndefined();
    expect(findToken(defaultTokens, "eip155:8453", USDC_ARBITRUM)).toBeUndefined();
  });

  it("returns undefined for unmapped networks and accepts an extended network table", () => {
    expect(findToken(defaultTokens, "eip155:999999", USDC_ARBITRUM)).toBeUndefined();
    const networks = { ...ONE_CLICK_BLOCKCHAINS, "eip155:999999": "arb" };
    expect(findToken(defaultTokens, "eip155:999999", USDC_ARBITRUM, networks)?.symbol).toBe("USDC");
  });
});
