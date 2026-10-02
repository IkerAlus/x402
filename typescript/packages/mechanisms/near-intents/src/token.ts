import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DestinationTerms } from "./types";

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const EXPIRY_PATTERN = /^[1-9]\d{0,11}$/;

export interface TokenKeys {
  /** Secrets by key id. A key must stay here while any token issued with it is unexpired. */
  keys: Record<string, string | Uint8Array>;
  /** Key id used for newly issued tokens. */
  activeKeyId: string;
}

/** What an operation token binds: the deposit instrument, the resource and the destination terms. */
export interface TokenInput {
  network: string;
  depositAddress: string;
  depositMemo?: string;
  /** `resource.url` of the payment payload. */
  resource: string;
  destination: DestinationTerms;
}

export type TokenCheck = "ok" | "expired" | "invalid";

/**
 * Lowercase hex SHA-256 of `network:asset:amount:recipient`.
 *
 * @param destination - Destination terms from the resource server's requirements
 * @returns The destination hash used inside the token MAC
 */
export function destinationHash(destination: DestinationTerms): string {
  const { network, asset, amount, recipient } = destination;
  return createHash("sha256").update(`${network}:${asset}:${amount}:${recipient}`).digest("hex");
}

/**
 * Issues `<keyId>.<expiry>.<mac>` with the active key.
 *
 * @param keys - Facilitator key set
 * @param input - Instrument, resource and destination terms to bind
 * @param expiry - Unix time in seconds after which the token is rejected
 * @returns The operation token
 */
export function issueOperationToken(keys: TokenKeys, input: TokenInput, expiry: number): string {
  const key = keys.keys[keys.activeKeyId];
  if (!KEY_ID_PATTERN.test(keys.activeKeyId) || key === undefined) {
    throw new Error(
      `near-intents: active token key "${keys.activeKeyId}" is missing or has an invalid id`,
    );
  }
  if (!Number.isInteger(expiry) || !EXPIRY_PATTERN.test(String(expiry))) {
    throw new Error("near-intents: token expiry must be a positive integer of unix seconds");
  }
  return encode(keys.activeKeyId, key, input, expiry);
}

/**
 * Checks a presented token. Expiry is decided before any key lookup or MAC work, and only
 * the exact string this facilitator would issue is accepted, so no alternative encoding of
 * the same MAC verifies.
 *
 * @param keys - Facilitator key set
 * @param token - Token presented by the client
 * @param input - Instrument, resource and destination terms the token must bind
 * @param nowMs - Current time in milliseconds
 * @returns `ok`, `expired`, or `invalid` (malformed, unknown key id, or MAC mismatch)
 */
export function checkOperationToken(
  keys: TokenKeys,
  token: string,
  input: TokenInput,
  nowMs: number = Date.now(),
): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return "invalid";
  }
  const [keyId, expiryText] = parts;
  if (!KEY_ID_PATTERN.test(keyId) || !EXPIRY_PATTERN.test(expiryText)) {
    return "invalid";
  }
  const expiry = Number(expiryText);
  if (expiry * 1000 <= nowMs) {
    return "expired";
  }
  const key = keys.keys[keyId];
  if (key === undefined) {
    return "invalid";
  }
  const expected = Buffer.from(encode(keyId, key, input, expiry));
  const presented = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected)
    ? "ok"
    : "invalid";
}

/**
 * Builds the canonical token string for a key.
 *
 * @param keyId - Key id
 * @param key - Secret
 * @param input - Token input
 * @param expiry - Unix time in seconds
 * @returns `<keyId>.<expiry>.<mac>` with an unpadded base64url MAC
 */
function encode(
  keyId: string,
  key: string | Uint8Array,
  input: TokenInput,
  expiry: number,
): string {
  const memo = input.depositMemo === undefined ? "" : `:${input.depositMemo}`;
  const hash = destinationHash(input.destination);
  const message = `${input.network}:${input.depositAddress}${memo}:${input.resource}:${hash}:${expiry}`;
  const mac = createHmac("sha256", key).update(message).digest("base64url");
  return `${keyId}.${expiry}.${mac}`;
}
