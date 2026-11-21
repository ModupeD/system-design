// Pure domain tests: no I/O and no fakes needed. These run in milliseconds.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "../../src/domain/errors.ts";
import { createOrder, markPaid, markPaymentFailed, MAX_ORDER_CENTS } from "../../src/domain/Order.ts";

const base = { id: "o1", customerId: "alice", createdAt: new Date("2026-01-01") };

describe("Order domain rules", () => {
  it("calculates the total from items", () => {
    const order = createOrder({ ...base, items: [{ sku: "BOOK", quantity: 2, unitPriceCents: 1500 }, { sku: "PEN", quantity: 3, unitPriceCents: 200 }] });
    assert.equal(order.totalCents, 3600);
    assert.equal(order.status, "PENDING");
  });

  it("rejects an empty order", () => {
    assert.throws(() => createOrder({ ...base, items: [] }), DomainError);
  });

  it("rejects zero or fractional quantities", () => {
    assert.throws(() => createOrder({ ...base, items: [{ sku: "X", quantity: 0, unitPriceCents: 100 }] }), DomainError);
    assert.throws(() => createOrder({ ...base, items: [{ sku: "X", quantity: 1.5, unitPriceCents: 100 }] }), DomainError);
  });

  it("rejects orders over $10,000", () => {
    assert.throws(
      () => createOrder({ ...base, items: [{ sku: "CAR", quantity: 1, unitPriceCents: 1_000_001 }] }),
      /exceeds the \$10,000 limit/,
    );
  });

  it("only lets a PENDING order become PAID", () => {
    const order = createOrder({ ...base, items: [{ sku: "X", quantity: 1, unitPriceCents: 100 }] });
    const paid = markPaid(order, "pay_1");
    assert.equal(paid.status, "PAID");
    assert.throws(() => markPaid(paid, "pay_2"), DomainError);
  });
});

// ── Characterization tests ───────────────────────────────────────────────────
// These record what the domain does TODAY, before we change the code around it.
// If one of these fails, we've found a bug or a misunderstanding.

const ONE_ITEM = [{ sku: "X", quantity: 1, unitPriceCents: 100 }];

describe("Order creation rules (characterization)", () => {
  it("rejects a blank customer id", () => {
    assert.throws(() => createOrder({ ...base, customerId: "   ", items: ONE_ITEM }), /Customer id is required/);
  });

  it("rejects a blank SKU", () => {
    assert.throws(() => createOrder({ ...base, items: [{ sku: " ", quantity: 1, unitPriceCents: 100 }] }), /needs a SKU/);
  });

  it("rejects negative or fractional prices", () => {
    assert.throws(() => createOrder({ ...base, items: [{ sku: "X", quantity: 1, unitPriceCents: -1 }] }), DomainError);
    assert.throws(() => createOrder({ ...base, items: [{ sku: "X", quantity: 1, unitPriceCents: 9.99 }] }), DomainError);
  });

  it("allows a free item, but not a $0 order", () => {
    const free = { sku: "STICKER", quantity: 1, unitPriceCents: 0 };
    assert.equal(createOrder({ ...base, items: [free, ...ONE_ITEM] }).totalCents, 100);
    assert.throws(() => createOrder({ ...base, items: [free] }), /greater than \$0/);
  });

  it("accepts exactly $10,000 (the limit is inclusive)", () => {
    const order = createOrder({ ...base, items: [{ sku: "X", quantity: 1, unitPriceCents: MAX_ORDER_CENTS }] });
    assert.equal(order.totalCents, MAX_ORDER_CENTS);
  });

  it("copies the items, so later changes to the input don't leak in", () => {
    const items = [...ONE_ITEM];
    const order = createOrder({ ...base, items });
    items.push({ sku: "Y", quantity: 1, unitPriceCents: 100 });
    assert.equal(order.items.length, 1);
  });
});

describe("Order status transitions (characterization)", () => {
  const pending = () => createOrder({ ...base, items: ONE_ITEM });

  it("markPaymentFailed records the reason", () => {
    const failed = markPaymentFailed(pending(), "Card declined");
    assert.equal(failed.status, "PAYMENT_FAILED");
    assert.equal(failed.failureReason, "Card declined");
  });

  it("a failed order cannot later be marked paid", () => {
    assert.throws(() => markPaid(markPaymentFailed(pending(), "declined"), "pay_1"), DomainError);
  });

  it("a paid order cannot be marked failed", () => {
    assert.throws(() => markPaymentFailed(markPaid(pending(), "pay_1"), "oops"), DomainError);
  });

  it("transitions return a new order and leave the original untouched", () => {
    const original = pending();
    const paid = markPaid(original, "pay_1");
    assert.notEqual(paid, original);
    assert.equal(original.status, "PENDING");
  });
});
