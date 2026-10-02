/** Merchant terms carried in `PaymentRequirements.extra.destination`. */
export interface DestinationTerms {
  /** CAIP-2 network the merchant receives on. */
  network: string;
  /** Asset the merchant receives, in that network's x402 identifier. */
  asset: string;
  /** Exact amount the merchant receives, in base units. */
  amount: string;
  /** Merchant address on `network`. */
  recipient: string;
}
