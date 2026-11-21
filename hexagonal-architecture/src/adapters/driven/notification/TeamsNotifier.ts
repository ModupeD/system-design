// DRIVEN ADAPTER: posts to Microsoft Teams via a webhook URL.
// Same port as SlackNotifier, different platform, different message format.

import type { Notifier } from "../../../application/ports/out/Notifier.ts";
import type { Order } from "../../../domain/Order.ts";
import { formatMoney } from "../../shared/formatMoney.ts";

export class TeamsNotifier implements Notifier {
  readonly #webhookUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: { webhookUrl: string; fetchFn?: typeof fetch }) {
    this.#webhookUrl = options.webhookUrl;
    this.#fetch = options.fetchFn ?? fetch;
  }

  async orderPlaced(order: Order): Promise<void> {
    const text = `**New order** ${order.id} from **${order.customerId}**: ${formatMoney(order.totalCents)} (${order.status})`;

    const res = await this.#fetch(this.#webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Teams webhook failed: HTTP ${res.status}`);
  }
}
