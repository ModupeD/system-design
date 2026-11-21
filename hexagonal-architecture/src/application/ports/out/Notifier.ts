// OUTPUT PORT (driven port): telling people something happened.
// It is named after a business event ("an order was placed"), not "send a
// string". Each adapter (console, Slack, Teams) formats the message for its
// own platform.

import type { Order } from "../../../domain/Order.ts";

export interface Notifier {
  /** Called once the order's payment outcome is final (PAID or PAYMENT_FAILED). */
  orderPlaced(order: Order): Promise<void>;
}
