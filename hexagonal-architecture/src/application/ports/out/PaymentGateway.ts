// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT PORT (driven port): taking payment.
// The shape is OURS, not Stripe's: there are no PaymentIntents or
// client_secrets here. Each payment adapter translates between the two worlds.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChargeRequest {
  /**
   * Stable for the lifetime of the order (it is saved before charging), so
   * adapters use it as the provider's idempotency key: charging the same
   * order twice must never take money twice.
   */
  orderId: string;
  customerId: string;
  amountCents: number;
}

/**
 * Three outcomes, not two. A timeout is NOT a decline: the provider may have
 * charged the card before the connection dropped.
 */
export type ChargeResult =
  | { status: "succeeded"; paymentId: string } // money was taken
  | { status: "declined"; reason: string } // the provider definitively did NOT take money
  | { status: "unknown"; reason: string }; // we can't tell (network error, timeout, 5xx...)

export interface PaymentGateway {
  /** Should return "unknown" for infrastructure failures instead of throwing. */
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
