// DRIVEN ADAPTER: prints notifications to the terminal. The default for development.

import type { Notifier } from "../../../application/ports/out/Notifier.ts";
import type { Order } from "../../../domain/Order.ts";
import { formatMoney } from "../../shared/formatMoney.ts";

export class ConsoleNotifier implements Notifier {
  async orderPlaced(order: Order): Promise<void> {
    const icon = order.status === "PAID" ? "✅" : "❌";
    console.log(`[notify] ${icon} Order ${order.id} for ${order.customerId}: ${formatMoney(order.totalCents)} → ${order.status}`);
  }
}
