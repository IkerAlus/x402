const HEX_HASH = /^(0x)?[0-9a-fA-F]+$/;

/**
 * Canonical form of a transaction hash for equality checks: hex hashes are case-insensitive
 * and are lowercased; every other encoding (base58 and the like) is kept as is.
 *
 * @param txHash - Transaction hash as presented
 * @returns The canonical form
 */
export function normalizeTxHash(txHash: string): string {
  return HEX_HASH.test(txHash) ? txHash.toLowerCase() : txHash;
}
