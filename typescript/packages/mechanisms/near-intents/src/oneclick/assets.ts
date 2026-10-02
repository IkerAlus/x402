import { ONE_CLICK_BLOCKCHAINS } from "../constants";
import type { Token } from "./client";

/**
 * Resolves an x402 `(network, asset)` pair to the 1Click token listed by `GET /v0/tokens`.
 * EVM contract addresses compare case-insensitively; every other namespace compares exactly.
 * Chain-native assets never match: x402 identifies assets by contract and 1Click lists
 * natives without `contractAddress`.
 *
 * @param tokens - Token list
 * @param network - CAIP-2 network
 * @param asset - Asset identifier in the network's x402 convention
 * @param networks - CAIP-2 to 1Click blockchain code table
 * @returns The token, or `undefined` when the network is unmapped or the asset is not listed
 */
export function findToken(
  tokens: readonly Token[],
  network: string,
  asset: string,
  networks: Readonly<Record<string, string>> = ONE_CLICK_BLOCKCHAINS,
): Token | undefined {
  const blockchain = networks[network];
  if (blockchain === undefined) {
    return undefined;
  }
  const wanted = canonicalAsset(network, asset);
  return tokens.find(
    token =>
      token.blockchain === blockchain &&
      token.contractAddress !== undefined &&
      canonicalAsset(network, token.contractAddress) === wanted,
  );
}

/**
 * Asset identifier in the network's comparison form.
 *
 * @param network - CAIP-2 network
 * @param asset - Asset identifier
 * @returns Lowercase for EVM networks, unchanged otherwise
 */
function canonicalAsset(network: string, asset: string): string {
  return network.startsWith("eip155:") ? asset.toLowerCase() : asset;
}
