import { describe, expect, it } from "vitest";
import {
  createOneClickClient,
  OneClickError,
  OneClickUnavailableError,
  type QuoteRequest,
} from "../../src/oneclick/client";
import { createFakeOneClick, defaultTokens } from "./fixtures/oneclick.fixture";

const wetQuote: QuoteRequest = {
  dry: false,
  swapType: "EXACT_OUTPUT",
  depositType: "ORIGIN_CHAIN",
  recipientType: "DESTINATION_CHAIN",
  refundType: "ORIGIN_CHAIN",
  originAsset: defaultTokens[0].assetId,
  destinationAsset: defaultTokens[1].assetId,
  amount: "1000000",
  recipient: "0x1111111111111111111111111111111111111111",
  refundTo: "0x2222222222222222222222222222222222222222",
  slippageTolerance: 50,
  deadline: "2026-09-23T10:10:00.000Z",
};

function setup() {
  const fake = createFakeOneClick();
  const client = createOneClickClient({ fetch: fake.fetch, apiKey: "k" });
  return { fake, client };
}

describe("1Click client", () => {
  it("sends the API key and JSON body, and parses a wet quote", async () => {
    const { fake, client } = setup();
    const response = await client.quote(wetQuote);

    expect(fake.requests[0]).toMatchObject({
      method: "POST",
      path: "/v0/quote",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: wetQuote,
    });
    expect(response.quote.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(response.quote.amountIn).toBe("1005000");
    expect(response.quote.minAmountIn).toBe("1000000");
    expect(response.quoteRequest.recipient).toBe(wetQuote.recipient);
  });

  it("returns a dry quote without a deposit address and sends no API key when unset", async () => {
    const fake = createFakeOneClick();
    const client = createOneClickClient({ fetch: fake.fetch });
    const response = await client.quote({ ...wetQuote, dry: true });

    expect(response.quote.depositAddress).toBeUndefined();
    expect(response.quote.deadline).toBeUndefined();
    expect(fake.requests[0].headers["x-api-key"]).toBeUndefined();
    expect(fake.quotes.size).toBe(0);
  });

  it("surfaces 1Click's message on 4xx as OneClickError", async () => {
    const { client } = setup();
    await expect(
      client.submitDeposit({ txHash: "0xabc", depositAddress: "0xnope" }),
    ).rejects.toThrow(OneClickError);
    await expect(
      client.submitDeposit({ txHash: "0xabc", depositAddress: "0xnope" }),
    ).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("Deposit address not found"),
    });
  });

  it("maps 5xx, transport failures and unreadable 2xx bodies to OneClickUnavailableError", async () => {
    const { fake, client } = setup();
    fake.failNextRequests(1);
    await expect(client.tokens()).rejects.toBeInstanceOf(OneClickUnavailableError);

    const offline = createOneClickClient({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await offline.tokens().catch(e => e);
    expect(error).toBeInstanceOf(OneClickUnavailableError);
    expect(error.status).toBe(0);
    expect(error.cause).toBeInstanceOf(TypeError);

    const truncated = createOneClickClient({
      fetch: async () => new Response("<html>not json", { status: 200 }),
    });
    await expect(truncated.tokens()).rejects.toBeInstanceOf(OneClickUnavailableError);
  });

  it("times out through the abort signal", async () => {
    const hanging = createOneClickClient({
      timeoutMs: 10,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    await expect(hanging.tokens()).rejects.toBeInstanceOf(OneClickUnavailableError);
  });

  it("resolves status to null for an unknown deposit address", async () => {
    const { client } = setup();
    expect(await client.status("0x3333333333333333333333333333333333333333")).toBeNull();
  });

  it("tracks a deposit through submit and status, including the memo query", async () => {
    const { fake, client } = setup();
    fake.nextQuote({ depositMemo: "777" });
    const minted = await client.quote({ ...wetQuote, depositMode: "MEMO" });
    const depositAddress = minted.quote.depositAddress!;
    expect(minted.quote.depositMemo).toBe("777");

    expect(await client.status(depositAddress)).toBeNull();
    const pending = await client.status(depositAddress, "777");
    expect(pending?.status).toBe("PENDING_DEPOSIT");
    expect(fake.requests.at(-1)?.query).toEqual({ depositAddress, depositMemo: "777" });

    const known = await client.submitDeposit({ txHash: "0xdeposit", depositAddress, memo: "777" });
    expect(known.status).toBe("KNOWN_DEPOSIT_TX");
    expect(known.swapDetails.originChainTxHashes).toEqual([{ hash: "0xdeposit" }]);

    fake.setStatus(depositAddress, "SUCCESS", { amountOut: "1000000" });
    const done = await client.status(depositAddress, "777");
    expect(done?.status).toBe("SUCCESS");
    expect(done?.swapDetails.amountOut).toBe("1000000");
    expect(done?.swapDetails.destinationChainTxHashes[0].hash).toMatch(/^0xdest/);
  });

  it("passes undocumented status values through instead of failing", async () => {
    const { fake, client } = setup();
    const minted = await client.quote(wetQuote);
    const depositAddress = minted.quote.depositAddress!;
    fake.setStatus(depositAddress, "KYT_BLOCKED");
    expect((await client.status(depositAddress))?.status).toBe("KYT_BLOCKED");
  });

  it("parses the token list and rejects an unexpected shape", async () => {
    const { client } = setup();
    const tokens = await client.tokens();
    expect(tokens.map(t => t.symbol)).toEqual(["USDC", "USDC", "ETH", "USDC", "wNEAR"]);
    expect(tokens[2].contractAddress).toBeUndefined();

    const garbage = createOneClickClient({
      fetch: async () => new Response(JSON.stringify([{ assetId: 1 }]), { status: 200 }),
    });
    await expect(garbage.tokens()).rejects.toThrow(/unexpected shape/);
  });
});
