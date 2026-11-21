// DRIVEN ADAPTER: keeps orders in memory. Great for development and demos;
// everything is lost on restart.

import type { OrderRepository } from "../../../application/ports/out/OrderRepository.ts";
import type { Order } from "../../../domain/Order.ts";

export class InMemoryOrderRepository implements OrderRepository {
  readonly #orders = new Map<string, Order>();
  readonly #orderIdByKey = new Map<string, string>();

  async save(order: Order, idempotencyKey?: string): Promise<void> {
    this.#orders.set(order.id, order);
    if (idempotencyKey !== undefined) this.#orderIdByKey.set(idempotencyKey, order.id);
  }

  async findById(orderId: string): Promise<Order | undefined> {
    return this.#orders.get(orderId);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Order | undefined> {
    const orderId = this.#orderIdByKey.get(idempotencyKey);
    return orderId === undefined ? undefined : this.#orders.get(orderId);
  }

  async findAll(): Promise<Order[]> {
    return [...this.#orders.values()];
  }
}
