// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT PORT (driven port): something the application NEEDS.
// The application says "I need somewhere to keep orders". It doesn't care
// whether that's PostgreSQL, DynamoDB, a JSON file, or memory.
// ─────────────────────────────────────────────────────────────────────────────

import type { Order } from "../../../domain/Order.ts";

export interface OrderRepository {
  /**
   * Insert or update an order. When `idempotencyKey` is given, remember which
   * order it belongs to so `findByIdempotencyKey` can find it later.
   */
  save(order: Order, idempotencyKey?: string): Promise<void>;
  findById(orderId: string): Promise<Order | undefined>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Order | undefined>;
  findAll(): Promise<Order[]>;
}
