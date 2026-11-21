// ─────────────────────────────────────────────────────────────────────────────
// DRIVEN ADAPTER: Stripe, TEST MODE ONLY.
// This is the only file in the project that knows Stripe exists.
//
// ⚠ This is NOT a production checkout. It always charges Stripe's test card
// `pm_card_visa`. A real integration collects the card in the browser (Stripe
// Elements / Checkout, so card data never touches this server), handles 3-D
// Secure, and learns the final result from webhooks. The constructor refuses
// live keys so it can't be pointed at real money by accident.
//
// Its job is translation:
//   our ChargeRequest      ──▶  a Stripe PaymentIntent request
//   Stripe's answer        ──▶  succeeded | declined | unknown
//
// The important distinction: "declined" means Stripe definitively did NOT take
// money. Anything we can't be sure about (no response, a timeout, a 5xx, an
// unreadable body, a payment still processing) is "unknown", never "declined".
// ─────────────────────────────────────────────────────────────────────────────

import type { ChargeRequest, ChargeResult, PaymentGateway } from "../../../application/ports/out/PaymentGateway.ts";

interface StripeResponseBody {
  id?: string;
  status?: string;
  error?: { message?: string };
}

export class StripePaymentGateway implements PaymentGateway {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  // `fetchFn` is injectable so Stripe can be faked without the network.
  constructor(options: { apiKey: string; fetchFn?: typeof fetch; timeoutMs?: number }) {
    if (!options.apiKey.startsWith("sk_test_")) {
      throw new Error("StripePaymentGateway is a test-mode demo: use a Stripe test key (sk_test_...)");
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchFn ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const body = new URLSearchParams({
      amount: String(request.amountCents),
      currency: "usd",
      confirm: "true",
      payment_method: "pm_card_visa", // test card: see the warning above
      "automatic_payment_methods[enabled]": "true",
      "automatic_payment_methods[allow_redirects]": "never",
      "metadata[orderId]": request.orderId,
      "metadata[customerId]": request.customerId,
    });

    let response: Response;
    try {
      response = await this.#fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // The orderId is saved before charging and reused on retries, so a
          // retry for the same order is deduplicated by Stripe.
          "Idempotency-Key": `order-${request.orderId}`,
        },
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      // The request may or may not have reached Stripe.
      return { status: "unknown", reason: "No response from Stripe (network error or timeout)" };
    }

    let json: StripeResponseBody;
    try {
      json = (await response.json()) as StripeResponseBody;
    } catch {
      return { status: "unknown", reason: `Unreadable response from Stripe (HTTP ${response.status})` };
    }

    if (response.status === 402) {
      return { status: "declined", reason: json.error?.message ?? "Card declined" };
    }
    // 409: an identical request is still in flight. 429: rate limited. 5xx: Stripe-side trouble.
    if (response.status === 409 || response.status === 429 || response.status >= 500) {
      return { status: "unknown", reason: `Stripe could not confirm the outcome (HTTP ${response.status})` };
    }
    if (!response.ok) {
      // Other 4xx (bad request, bad key): Stripe rejected the request, so no charge was made.
      return { status: "declined", reason: json.error?.message ?? `Stripe rejected the request (HTTP ${response.status})` };
    }

    switch (json.status) {
      case "succeeded":
        return json.id
          ? { status: "succeeded", paymentId: json.id }
          : { status: "unknown", reason: "Stripe reported success without a payment id" };
      case "requires_payment_method":
      case "canceled":
        return { status: "declined", reason: `Payment ${json.status}` };
      default:
        // "processing", "requires_action", ...: not final yet.
        return { status: "unknown", reason: `Payment not final yet (status: ${json.status})` };
    }
  }
}
