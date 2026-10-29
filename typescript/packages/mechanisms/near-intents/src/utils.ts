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

/**
 * Identity of an operation on every role: `<network>:<depositAddress>[:<depositMemo>]`.
 * The parts are used as presented, since the operation token binds them byte for byte.
 *
 * @param network - CAIP-2 origin network
 * @param depositAddress - 1Click deposit address
 * @param depositMemo - Deposit memo, on origin networks that require one
 * @returns The operation key
 */
export function operationKey(
  network: string,
  depositAddress: string,
  depositMemo?: string,
): string {
  const memo = depositMemo === undefined ? "" : `:${depositMemo}`;
  return `${network}:${depositAddress}${memo}`;
}
