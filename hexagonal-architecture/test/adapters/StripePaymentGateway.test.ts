// Driven-adapter tests check the TRANSLATION: Stripe's world → our port's world.
// `fetch` is faked, so no network call or Stripe account is needed.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StripePaymentGateway } from "../../src/adapters/driven/payment/StripePaymentGateway.ts";

const request = { orderId: "o1", customerId: "alice", amountCents: 2500 };

function gatewayReturning(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}) {
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return new StripePaymentGateway({ apiKey: "sk_test_x", fetchFn });
}

describe("StripePaymentGateway (test mode)", () => {
  it("sends a PaymentIntent with the order id as idempotency key, and maps success", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const gw = gatewayReturning(200, { id: "pi_1", status: "succeeded" }, seen);

    assert.deepEqual(await gw.charge(request), { status: "succeeded", paymentId: "pi_1" });
    assert.equal(seen.url, "https://api.stripe.com/v1/payment_intents");
    assert.equal(new URLSearchParams(seen.init!.body as URLSearchParams).get("amount"), "2500");
    assert.equal((seen.init!.headers as Record<string, string>)["Idempotency-Key"], "order-o1");
  });

  it("maps a card error (402) to declined", async () => {
    const gw = gatewayReturning(402, { error: { message: "Your card was declined." } });
    assert.deepEqual(await gw.charge(request), { status: "declined", reason: "Your card was declined." });
  });

  it("maps network failures, 5xx, unreadable bodies and non-final statuses to unknown, never declined", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const results = [
      await new StripePaymentGateway({ apiKey: "sk_test_x", fetchFn: failing }).charge(request),
      await gatewayReturning(503, { error: { message: "overloaded" } }).charge(request),
      await gatewayReturning(502, "<html>Bad gateway</html>").charge(request),
      await gatewayReturning(200, { id: "pi_2", status: "processing" }).charge(request),
    ];
    for (const result of results) assert.equal(result.status, "unknown");
  });

  it("refuses live keys", () => {
    assert.throws(() => new StripePaymentGateway({ apiKey: "sk_live_x" }), /test-mode/);
  });
});
