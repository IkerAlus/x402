import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createOneClickClient, OneClickUnavailableError } from "../../src/oneclick/client";

const livePending = JSON.parse(
  readFileSync(new URL("./fixtures/oneclick-status-pending.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

/**
 * A fetch that always answers with `status` and `body`.
 *
 * @param status - HTTP status
 * @param body - JSON body
 * @returns The fetch function
 */
function answering(status: number, body: unknown): typeof globalThis.fetch {
  return async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("1Click client against live-shaped bodies", () => {
  it("parses a live PENDING_DEPOSIT status with null swap details", async () => {
    const client = createOneClickClient({ fetch: answering(200, livePending) });
    const status = await client.status("0xd96d773A95F87258d40dc9F3892D21AfA4cc8A37");
    expect(status).toMatchObject({
      status: "PENDING_DEPOSIT",
      updatedAt: "2026-10-30T14:01:48.294Z",
      swapDetails: {
        originChainTxHashes: [],
        destinationChainTxHashes: [],
        refundedAmount: "0",
      },
      quoteResponse: {
        quoteRequest: {
          destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
          amount: "1000000",
        },
        quote: {
          depositAddress: "0xd96d773A95F87258d40dc9F3892D21AfA4cc8A37",
          amountIn: "1007565",
        },
      },
    });
    expect(status!.swapDetails.amountIn).toBeUndefined();
    expect(status!.swapDetails.refundReason).toBeUndefined();
    expect(status!.swapDetails.depositedAmount).toBeUndefined();
  });

  it("treats 1Click's internal errors reported as 400 as unavailability", async () => {
    const client = createOneClickClient({
      fetch: answering(400, { message: "Internal server error", correlationId: "x" }),
    });
    await expect(client.tokens()).rejects.toBeInstanceOf(OneClickUnavailableError);
    const validation = createOneClickClient({
      fetch: answering(400, { message: "refundTo is not valid", statusCode: 400 }),
    });
    await expect(validation.tokens()).rejects.toThrow(/refundTo is not valid/);
    await expect(validation.tokens()).rejects.not.toBeInstanceOf(OneClickUnavailableError);
  });

  it("honours a per-call timeout over the client default", async () => {
    const hanging: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    const client = createOneClickClient({ fetch: hanging, timeoutMs: 60_000 });
    await expect(client.tokens({ timeoutMs: 5 })).rejects.toBeInstanceOf(OneClickUnavailableError);
  });
});
