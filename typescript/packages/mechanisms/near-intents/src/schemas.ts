import { z } from "zod";
import { ASSET_TRANSFER_METHOD, PAYMENT_FLOW } from "./constants";

const BaseUnits = z.string().regex(/^\d+$/);

export const DestinationSchema = z.object({
  network: z.string().min(1),
  asset: z.string().min(1),
  amount: BaseUnits,
  recipient: z.string().min(1),
});

/** `extra` of the unquoted entry, as the resource server advertises it. */
export const UnquotedExtraSchema = z.object({
  assetTransferMethod: z.literal(ASSET_TRANSFER_METHOD),
  paymentFlow: z.literal(PAYMENT_FLOW),
  indicativeAmount: z.string().optional(),
  destination: DestinationSchema,
});
export type UnquotedExtra = z.infer<typeof UnquotedExtraSchema>;

/** `extra` of the quoted entry in the corrective 402. */
export const QuotedExtraSchema = UnquotedExtraSchema.extend({
  refundDeadline: z.string().min(1),
  operationToken: z.string().min(1),
  depositMemo: z.string().optional(),
});
export type QuotedExtra = z.infer<typeof QuotedExtraSchema>;

export const QuotePayloadSchema = z.object({
  type: z.literal("quote"),
  refundTo: z.string().min(1),
  /** Basis points. */
  slippageTolerance: z.number().int().nonnegative().optional(),
});
export type QuotePayload = z.infer<typeof QuotePayloadSchema>;

export const DepositPayloadSchema = z.object({
  type: z.literal("deposit"),
  operationToken: z.string().min(1),
  depositAddress: z.string().min(1),
  depositMemo: z.string().optional(),
  txHash: z.string().min(1),
});
export type DepositPayload = z.infer<typeof DepositPayloadSchema>;

/** `VerifyResponse.extra` of a successful quote. */
export const QuoteExtraSchema = z.object({
  depositAddress: z.string().min(1),
  amountIn: BaseUnits,
  refundDeadline: z.string().min(1),
  operationToken: z.string().min(1),
  depositMemo: z.string().optional(),
});
export type QuoteExtra = z.infer<typeof QuoteExtraSchema>;
