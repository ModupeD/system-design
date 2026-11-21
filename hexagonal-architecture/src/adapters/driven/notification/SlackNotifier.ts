// DRIVEN ADAPTER: posts to a Slack channel via an Incoming Webhook URL.
// Formatting (Slack's *bold* markdown, emoji codes) is a Slack concern, so it
// lives here and not in the core.

import type { Notifier } from "../../../application/ports/out/Notifier.ts";
import type { Order } from "../../../domain/Order.ts";
import { formatMoney } from "../../shared/formatMoney.ts";

export class SlackNotifier implements Notifier {
  readonly #webhookUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: { webhookUrl: string; fetchFn?: typeof fetch }) {
    this.#webhookUrl = options.webhookUrl;
    this.#fetch = options.fetchFn ?? fetch;
  }

  async orderPlaced(order: Order): Promise<void> {
    const icon = order.status === "PAID" ? ":white_check_mark:" : ":x:";
    const text = `${icon} *New order* \`${order.id}\` from *${order.customerId}*: ${formatMoney(order.totalCents)} (${order.status})`;

    const res = await this.#fetch(this.#webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Slack webhook failed: HTTP ${res.status}`);
  }
}
