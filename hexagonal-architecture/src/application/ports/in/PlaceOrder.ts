// ─────────────────────────────────────────────────────────────────────────────
// INPUT PORT (driving port): something the application OFFERS.
// Driving adapters (HTTP, CLI, a Slack slash-command...) call this interface.
// They don't know HOW an order is placed, only that they can ask for one.
// ─────────────────────────────────────────────────────────────────────────────

import type { Order } from "../../../domain/Order.ts";

export interface RequestedItem {
  sku: string;
  quantity: number;
  // Deliberately no price: the caller is untrusted, so the application looks
  // prices up itself through the ProductCatalog port.
}

export interface PlaceOrderCommand {
  customerId: string;
  items: RequestedItem[];
  /**
   * Optional key chosen by the client, once per checkout attempt, and sent
   * again on every retry. A repeated key returns the existing order instead
   * of creating (and charging) a new one.
   */
  idempotencyKey?: string;
}

export interface PlaceOrder {
  /**
   * Resolves with the order in one of three states:
   *   PAID / PAYMENT_FAILED: the payment outcome is final.
   *   PENDING: the payment outcome is unknown. Retry with the same idempotency key.
   */
  execute(command: PlaceOrderCommand): Promise<Order>;
}
