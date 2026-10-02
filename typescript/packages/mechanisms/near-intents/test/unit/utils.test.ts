import { describe, expect, it } from "vitest";
import { normalizeTxHash } from "../../src/utils";

describe("normalizeTxHash", () => {
  it("lowercases hex hashes with or without the 0x prefix", () => {
    expect(normalizeTxHash("0xABCDef0123")).toBe("0xabcdef0123");
    expect(normalizeTxHash("ABCDEF0123")).toBe("abcdef0123");
    expect(normalizeTxHash("0xABCDef0123")).toBe(normalizeTxHash("0xabcdEF0123"));
  });

  it("keeps non-hex hashes exactly as presented", () => {
    const solana =
      "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
    expect(normalizeTxHash(solana)).toBe(solana);
    expect(normalizeTxHash("0xnothex")).toBe("0xnothex");
  });
});
