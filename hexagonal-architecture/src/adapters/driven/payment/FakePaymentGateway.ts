// ─────────────────────────────────────────────────────────────────────────────
// DRIVEN ADAPTER: a pretend payment provider for local development.
// It moves no money. It lets you see all three outcomes of the PaymentGateway port:
//   - amounts over $500                → declined
//   - customerId "timeout"             → unknown on the FIRST attempt for an order
//                                        (a simulated lost connection), then, when the
//                                        same order is retried, the "provider" reports
//                                        the original attempt's outcome, the way a real
//                                        provider replays a request with the same
//                                        idempotency key
//   - everything else                  → succeeded
// ─────────────────────────────────────────────────────────────────────────────

import type { ChargeRequest, ChargeResult, PaymentGateway } from "../../../application/ports/out/PaymentGateway.ts";

export const FAKE_DECLINE_ABOVE_CENTS = 50_000;
export const FAKE_TIMEOUT_CUSTOMER = "timeout";

export class FakePaymentGateway implements PaymentGateway {
  readonly #timedOutOrders = new Set<string>();

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (request.customerId === FAKE_TIMEOUT_CUSTOMER && !this.#timedOutOrders.has(request.orderId)) {
      this.#timedOutOrders.add(request.orderId);
      return { status: "unknown", reason: "Simulated timeout: the fake provider did not answer in time" };
    }
    if (request.amountCents > FAKE_DECLINE_ABOVE_CENTS) {
      return { status: "declined", reason: "Card declined (fake gateway declines amounts over $500)" };
    }
    // Deterministic per order, like a provider honouring an idempotency key.
    return { status: "succeeded", paymentId: `fake_pay_${request.orderId}` };
  }
}
