// Use-case tests: the real application service, real in-memory adapters, and
// hand-written fakes for payments and notifications. No network, no database.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryProductCatalog } from "../../src/adapters/driven/catalog/InMemoryProductCatalog.ts";
import { InMemoryOrderRepository } from "../../src/adapters/driven/persistence/InMemoryOrderRepository.ts";
import { IdempotencyConflictError } from "../../src/application/errors.ts";
import { PlaceOrderService, type PlaceOrderDeps } from "../../src/application/services/PlaceOrderService.ts";
import { DomainError } from "../../src/domain/errors.ts";
import { BrokenNotifier, FixedClock, RecordingNotifier, ScriptedPayments, SequentialIds } from "../fakes.ts";

function setup(overrides: Partial<PlaceOrderDeps> = {}) {
  const deps: PlaceOrderDeps = {
    orders: new InMemoryOrderRepository(),
    payments: new ScriptedPayments(),
    catalog: new InMemoryProductCatalog([
      { sku: "BOOK", name: "Book", priceCents: 1500 },
      { sku: "PEN", name: "Pen", priceCents: 200 },
    ]),
    notifier: new RecordingNotifier(),
    ids: new SequentialIds(),
    clock: new FixedClock(),
    ...overrides,
  };
  return { deps, service: new PlaceOrderService(deps) };
}

const cmd = { customerId: "alice", items: [{ sku: "BOOK", quantity: 2 }] };

describe("PlaceOrderService", () => {
  it("prices from the catalog, charges, saves and notifies", async () => {
    const payments = new ScriptedPayments({ status: "succeeded", paymentId: "pay_abc" });
    const notifier = new RecordingNotifier();
    const { deps, service } = setup({ payments, notifier });

    const order = await service.execute(cmd);

    assert.equal(order.status, "PAID");
    assert.equal(order.totalCents, 3000);
    assert.deepEqual(payments.calls, [{ orderId: "order-1", customerId: "alice", amountCents: 3000 }]);
    assert.deepEqual(await deps.orders.findById("order-1"), order);
    assert.equal(notifier.sent.length, 1);
  });

  it("saves the order as PENDING before charging", async () => {
    const orders = new InMemoryOrderRepository();
    let statusAtChargeTime: string | undefined;
    const payments = new ScriptedPayments().onCharge(async (req) => {
      statusAtChargeTime = (await orders.findById(req.orderId))?.status;
    });

    await setup({ orders, payments }).service.execute(cmd);
    assert.equal(statusAtChargeTime, "PENDING");
  });

  it("records a definitive decline as PAYMENT_FAILED", async () => {
    const { deps, service } = setup({ payments: new ScriptedPayments({ status: "declined", reason: "Card declined" }) });
    const order = await service.execute(cmd);
    assert.equal(order.status, "PAYMENT_FAILED");
    assert.equal((await deps.orders.findById(order.id))?.failureReason, "Card declined");
  });

  it("leaves the order PENDING when the outcome is unknown, and does not notify", async () => {
    const notifier = new RecordingNotifier();
    const { deps, service } = setup({ notifier, payments: new ScriptedPayments({ status: "unknown", reason: "timeout" }) });
    const order = await service.execute(cmd);
    assert.equal(order.status, "PENDING");
    assert.equal((await deps.orders.findById(order.id))?.status, "PENDING");
    assert.equal(notifier.sent.length, 0);
  });

  it("rejects unknown products and invalid orders without saving or charging", async () => {
    const payments = new ScriptedPayments();
    const { deps, service } = setup({ payments });
    await assert.rejects(service.execute({ customerId: "alice", items: [{ sku: "NOPE", quantity: 1 }] }), /Unknown product/);
    await assert.rejects(service.execute({ customerId: "alice", items: [] }), DomainError);
    assert.equal(payments.calls.length, 0);
    assert.equal((await deps.orders.findAll()).length, 0);
  });

  it("returns the existing order for a repeated idempotency key without charging again", async () => {
    const payments = new ScriptedPayments();
    const { service } = setup({ payments });
    const first = await service.execute({ ...cmd, idempotencyKey: "k1" });
    const again = await service.execute({ ...cmd, idempotencyKey: "k1" });
    assert.deepEqual(again, first);
    assert.equal(payments.calls.length, 1);
  });

  it("retries the charge for the SAME order when the previous outcome was unknown", async () => {
    const payments = new ScriptedPayments({ status: "unknown", reason: "timeout" }, { status: "succeeded", paymentId: "pay_1" });
    const { deps, service } = setup({ payments });
    const first = await service.execute({ ...cmd, idempotencyKey: "k1" });
    const retry = await service.execute({ ...cmd, idempotencyKey: "k1" });
    assert.equal(first.status, "PENDING");
    assert.equal(retry.status, "PAID");
    assert.equal(retry.id, first.id);
    assert.deepEqual(payments.calls.map((c) => c.orderId), [first.id, first.id]);
    assert.equal((await deps.orders.findAll()).length, 1);
  });

  it("rejects a reused idempotency key with a different request", async () => {
    const { service } = setup();
    await service.execute({ ...cmd, idempotencyKey: "k1" });
    await assert.rejects(
      service.execute({ customerId: "alice", items: [{ sku: "PEN", quantity: 1 }], idempotencyKey: "k1" }),
      IdempotencyConflictError,
    );
  });

  it("still succeeds when the notifier is down", async () => {
    const order = await setup({ notifier: new BrokenNotifier() }).service.execute(cmd);
    assert.equal(order.status, "PAID");
  });
});
