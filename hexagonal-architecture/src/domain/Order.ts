// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN: the Order entity and its business rules.
//
// Plain TypeScript only. This file may import other domain files and nothing
// else: no application code, no adapters, no `node:` modules, no npm packages.
// If you can explain a line here to a business owner, it belongs here.
// ─────────────────────────────────────────────────────────────────────────────

import { DomainError } from "./errors.ts";

/**
 * PENDING         the order is saved, but payment is not confirmed (yet).
 * PAID            the payment provider confirmed the charge.
 * PAYMENT_FAILED  the payment provider definitively refused the charge.
 */
export type OrderStatus = "PENDING" | "PAID" | "PAYMENT_FAILED";

export interface OrderItem {
  readonly sku: string;
  readonly quantity: number;
  /** The price at the moment the order was placed (a snapshot from the catalog). */
  readonly unitPriceCents: number;
}

export interface Order {
  readonly id: string;
  readonly customerId: string;
  readonly items: readonly OrderItem[];
  readonly totalCents: number;
  readonly status: OrderStatus;
  readonly paymentId?: string;
  readonly failureReason?: string;
  readonly createdAt: string; // ISO-8601
}

/** Business rule: we don't accept orders above $10,000. */
export const MAX_ORDER_CENTS = 1_000_000;

export function createOrder(params: {
  id: string;
  customerId: string;
  items: readonly OrderItem[];
  createdAt: Date;
}): Order {
  const { id, customerId, items, createdAt } = params;

  if (!customerId.trim()) throw new DomainError("Customer id is required");
  if (items.length === 0) throw new DomainError("An order needs at least one item");

  for (const item of items) {
    if (!item.sku.trim()) throw new DomainError("Every item needs a SKU");
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new DomainError(`Quantity for ${item.sku} must be a positive whole number`);
    }
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new DomainError(`Price for ${item.sku} must be a non-negative whole number of cents`);
    }
  }

  const totalCents = items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0);
  if (totalCents <= 0) throw new DomainError("Order total must be greater than $0");
  if (totalCents > MAX_ORDER_CENTS) throw new DomainError("Order total exceeds the $10,000 limit");

  return {
    id,
    customerId,
    items: [...items],
    totalCents,
    status: "PENDING",
    createdAt: createdAt.toISOString(),
  };
}

/** Business rule: only a PENDING order can become PAID. */
export function markPaid(order: Order, paymentId: string): Order {
  if (order.status !== "PENDING") {
    throw new DomainError(`Cannot mark a ${order.status} order as paid`);
  }
  return { ...order, status: "PAID", paymentId };
}

/** Business rule: only a PENDING order can have its payment fail. */
export function markPaymentFailed(order: Order, reason: string): Order {
  if (order.status !== "PENDING") {
    throw new DomainError(`Cannot fail payment on a ${order.status} order`);
  }
  return { ...order, status: "PAYMENT_FAILED", failureReason: reason };
}
