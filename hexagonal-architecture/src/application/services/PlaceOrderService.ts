// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION SERVICE (use case): placing an order.
//
// It implements the PlaceOrder input port and orchestrates the domain rules
// and the output ports. It decides the ORDER of the steps; the domain decides
// what is ALLOWED. It depends only on interfaces, which the composition root
// passes in through the constructor (constructor-based dependency injection).
// ─────────────────────────────────────────────────────────────────────────────

import { DomainError } from "../../domain/errors.ts";
import { createOrder, markPaid, markPaymentFailed, type Order, type OrderItem } from "../../domain/Order.ts";
import { IdempotencyConflictError } from "../errors.ts";
import type { PlaceOrder, PlaceOrderCommand, RequestedItem } from "../ports/in/PlaceOrder.ts";
import type { Notifier } from "../ports/out/Notifier.ts";
import type { OrderRepository } from "../ports/out/OrderRepository.ts";
import type { PaymentGateway } from "../ports/out/PaymentGateway.ts";
import type { ProductCatalog } from "../ports/out/ProductCatalog.ts";
import type { Clock, IdGenerator } from "../ports/out/System.ts";

export interface PlaceOrderDeps {
  orders: OrderRepository;
  payments: PaymentGateway;
  catalog: ProductCatalog;
  notifier: Notifier;
  ids: IdGenerator;
  clock: Clock;
}

export class PlaceOrderService implements PlaceOrder {
  readonly #deps: PlaceOrderDeps;

  constructor(deps: PlaceOrderDeps) {
    this.#deps = deps;
  }

  async execute(command: PlaceOrderCommand): Promise<Order> {
    const { orders, ids, clock } = this.#deps;

    // 1. Idempotency: a repeated request must not create or charge a second order.
    if (command.idempotencyKey !== undefined) {
      const existing = await orders.findByIdempotencyKey(command.idempotencyKey);
      if (existing) {
        if (!isSameRequest(existing, command)) throw new IdempotencyConflictError(command.idempotencyKey);
        // PENDING means the last attempt's payment outcome was unknown. Charging
        // again is safe because the gateway gets the same orderId, which it uses
        // as the provider's idempotency key.
        return existing.status === "PENDING" ? this.#collectPayment(existing) : existing;
      }
    }

    // 2. Prices come from the server-side catalog, never from the client.
    const items = await this.#priceItems(command.items);

    // 3. Business rules. Throws DomainError for an invalid order, before
    //    anything is saved or charged.
    const pending = createOrder({ id: ids.next(), customerId: command.customerId, items, createdAt: clock.now() });

    // 4. Save BEFORE charging. If the process dies after the charge, a PENDING
    //    record still exists, tagged with the same orderId the provider knows,
    //    so the situation is recoverable. If this save fails, nothing was charged.
    await orders.save(pending, command.idempotencyKey);

    // 5. Charge, then record the outcome.
    return this.#collectPayment(pending);
  }

  async #priceItems(requested: readonly RequestedItem[]): Promise<OrderItem[]> {
    return Promise.all(
      requested.map(async ({ sku, quantity }) => {
        const unitPriceCents = await this.#deps.catalog.priceOf(sku);
        if (unitPriceCents === undefined) throw new DomainError(`Unknown product "${sku}"`);
        return { sku, quantity, unitPriceCents };
      }),
    );
  }

  async #collectPayment(pending: Order): Promise<Order> {
    const { orders, payments } = this.#deps;

    const result = await payments.charge({
      orderId: pending.id,
      customerId: pending.customerId,
      amountCents: pending.totalCents,
    });

    // Unknown outcome: we must not claim it failed (money may have been taken),
    // and we can't claim it succeeded. The order stays PENDING, as already saved.
    if (result.status === "unknown") return pending;

    const order =
      result.status === "succeeded" ? markPaid(pending, result.paymentId) : markPaymentFailed(pending, result.reason);
    await orders.save(order);
    await this.#notify(order);
    return order;
  }

  // Notifications are best-effort, a deliberate trade-off: if Slack is down,
  // the customer's paid order still succeeds. (For guaranteed delivery, look up
  // the "transactional outbox" pattern.)
  async #notify(order: Order): Promise<void> {
    try {
      await this.#deps.notifier.orderPlaced(order);
    } catch {
      // Swallowed on purpose. Logging would be the notifier adapter's job; the
      // application layer doesn't reach for infrastructure like `console`.
    }
  }
}

/** Is this the same request that originally created `order`? (Prices are ignored: they come from us.) */
function isSameRequest(order: Order, command: PlaceOrderCommand): boolean {
  return (
    order.customerId === command.customerId &&
    order.items.length === command.items.length &&
    order.items.every((item, i) => item.sku === command.items[i]!.sku && item.quantity === command.items[i]!.quantity)
  );
}
