import { describe, expect, it } from "vitest";
import {
  checkOperationToken,
  destinationHash,
  issueOperationToken,
  type TokenInput,
  type TokenKeys,
} from "../../src/token";

const keys: TokenKeys = { keys: { k1: "k1-secret" }, activeKeyId: "k1" };
const expiry = 1790244600;
const beforeExpiry = (expiry - 1) * 1000;
const input: TokenInput = {
  network: "eip155:42161",
  depositAddress: "0x76b4c56085ED136a8744D52bE956396624a730E8",
  resource: "https://api.example.com/premium-data",
  destination: {
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "1000000",
    recipient: "0xMerchantOnBase",
  },
};
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("operation token", () => {
  // Vectors computed independently with Python's hashlib/hmac.
  it("matches independently computed vectors", () => {
    expect(destinationHash(input.destination)).toBe(
      "1899af08cd6580ac71e600a45e37c22deba6e7ef366eb91ebd7c5ca2c1e1e0d3",
    );
    expect(issueOperationToken(keys, input, expiry)).toBe(
      "k1.1790244600.uEJof7Mwg3dZrAO7L8XLXT1Ncb7w5oOLgzuDLAlpcKE",
    );
    const memoInput: TokenInput = {
      ...input,
      network: "stellar:pubnet",
      depositAddress: "GDEPOSIT",
      depositMemo: "777",
    };
    const memoToken = issueOperationToken(keys, memoInput, expiry);
    expect(memoToken).toBe("k1.1790244600.4nroGQxs9I0v30nIQMX8QH_79jkplem6g74Qvp0iiUw");
    expect(checkOperationToken(keys, memoToken, memoInput, beforeExpiry)).toBe("ok");
  });

  it("verifies a token it issued and rejects it once expired", () => {
    const token = issueOperationToken(keys, input, expiry);
    expect(checkOperationToken(keys, token, input, beforeExpiry)).toBe("ok");
    expect(checkOperationToken(keys, token, input, expiry * 1000)).toBe("expired");
    expect(checkOperationToken(keys, token, input, expiry * 1000 + 1)).toBe("expired");
  });

  it("reports expiry before looking at the key or the MAC", () => {
    expect(checkOperationToken(keys, `unknown.${expiry}.not-a-mac`, input, expiry * 1000)).toBe(
      "expired",
    );
  });

  it("rejects an unknown key id, a tampered MAC and a key that was rotated out", () => {
    const token = issueOperationToken(keys, input, expiry);
    const [keyId, exp, mac] = token.split(".");
    expect(checkOperationToken(keys, `k2.${exp}.${mac}`, input, beforeExpiry)).toBe("invalid");
    const flipped = mac.startsWith("u") ? `v${mac.slice(1)}` : `u${mac.slice(1)}`;
    expect(checkOperationToken(keys, `${keyId}.${exp}.${flipped}`, input, beforeExpiry)).toBe(
      "invalid",
    );

    const rotated: TokenKeys = { keys: { k1: "k1-secret", k2: "k2-secret" }, activeKeyId: "k2" };
    expect(checkOperationToken(rotated, token, input, beforeExpiry)).toBe("ok");
    const retired: TokenKeys = { keys: { k2: "k2-secret" }, activeKeyId: "k2" };
    expect(checkOperationToken(retired, token, input, beforeExpiry)).toBe("invalid");
  });

  it("accepts only the canonical encoding of a valid MAC", () => {
    const memoInput: TokenInput = {
      ...input,
      network: "stellar:pubnet",
      depositAddress: "GDEPOSIT",
      depositMemo: "777",
    };
    const token = issueOperationToken(keys, memoInput, expiry);
    const [keyId, exp, mac] = token.split(".");
    const lastAlias = BASE64URL[BASE64URL.indexOf(mac.at(-1)!) ^ 1];
    const aliases = [`${mac}=`, `${mac.slice(0, -1)}${lastAlias}`, mac.replace(/_/g, "/")];
    for (const alias of aliases) {
      expect(alias).not.toBe(mac);
      expect(Buffer.from(alias, "base64url").equals(Buffer.from(mac, "base64url"))).toBe(true);
      expect(checkOperationToken(keys, `${keyId}.${exp}.${alias}`, memoInput, beforeExpiry)).toBe(
        "invalid",
      );
    }
    expect(checkOperationToken(keys, `${keyId}.0${exp}.${mac}`, memoInput, beforeExpiry)).toBe(
      "invalid",
    );
  });

  it("binds the instrument, the resource and the destination terms", () => {
    const token = issueOperationToken(keys, input, expiry);
    const variants: TokenInput[] = [
      { ...input, network: "eip155:8453" },
      { ...input, depositAddress: "0x76b4c56085ed136a8744d52be956396624a730e8" },
      { ...input, depositMemo: "1" },
      { ...input, resource: "https://api.example.com/other" },
      { ...input, destination: { ...input.destination, amount: "1000001" } },
      { ...input, destination: { ...input.destination, recipient: "0xSomeoneElse" } },
    ];
    for (const variant of variants) {
      expect(checkOperationToken(keys, token, variant, beforeExpiry)).toBe("invalid");
    }
  });

  it("treats malformed tokens as invalid", () => {
    const malformed = [
      "",
      "k1",
      "k1.1790244600",
      "k1.1790244600.",
      "k1.abc.mac",
      "k1.1790244600.m.x",
    ];
    for (const token of malformed) {
      expect(checkOperationToken(keys, token, input, beforeExpiry)).toBe("invalid");
    }
  });

  it("refuses to issue with a bad key id or expiry", () => {
    expect(() =>
      issueOperationToken({ keys: { "k.1": "s" }, activeKeyId: "k.1" }, input, expiry),
    ).toThrow(/invalid id/);
    expect(() => issueOperationToken({ keys: {}, activeKeyId: "k1" }, input, expiry)).toThrow(
      /missing/,
    );
    expect(() => issueOperationToken(keys, input, 1.5)).toThrow(/expiry/);
    expect(() => issueOperationToken(keys, input, 0)).toThrow(/expiry/);
    expect(() => issueOperationToken(keys, input, -1)).toThrow(/expiry/);
  });
});
