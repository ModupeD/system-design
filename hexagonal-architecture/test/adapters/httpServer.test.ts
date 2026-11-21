// Driving-adapter tests: real HTTP requests against the real server, wired by
// the real composition root. They check the HTTP ↔ core translation (status
// codes, JSON), the web UI being served, and the dev-only tracing.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createHttpServer } from "../../src/adapters/driving/http/httpServer.ts";
import { DevTracer } from "../../src/adapters/shared/devTracing.ts";
import { buildApp } from "../../src/composition/container.ts";

describe("HTTP adapter", () => {
  const tracer = new DevTracer();
  const app = buildApp({ NOTIFIER: "console" }, { tracer });
  const server = createHttpServer({ ...app, dev: { tracer, adapters: app.adapters } });
  let baseUrl = "";

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/orders`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("POST /orders → 201 with a PAID order priced by the server", async () => {
    const res = await post({ customerId: "alice", items: [{ sku: "BOOK", quantity: 2, unitPriceCents: 1 }] });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.status, "PAID");
    assert.equal(json.total, "$30.00"); // the client's 1-cent price was ignored

    const byId = await fetch(`${baseUrl}/orders/${json.id}`);
    assert.equal((await byId.json()).id, json.id);
  });

  it("GET /products lists the catalog", async () => {
    const products = await (await fetch(`${baseUrl}/products`)).json();
    assert.deepEqual(products[0], { sku: "BOOK", name: "Paperback book", priceCents: 1500, price: "$15.00" });
  });

  it("an unknown payment outcome → 202 PENDING; retrying with the same key completes it", async () => {
    const body = { customerId: "timeout", items: [{ sku: "PEN", quantity: 1 }] };
    const first = await post(body, { "Idempotency-Key": "t-1" });
    assert.equal(first.status, 202);
    const retry = await post(body, { "Idempotency-Key": "t-1" });
    const [a, b] = [await first.json(), await retry.json()];
    assert.equal(b.id, a.id);
    assert.equal(b.status, "PAID");
  });

  it("maps errors to status codes: DomainError 400, bad body 400, conflict 422, not found 404", async () => {
    await post({ customerId: "bob", items: [{ sku: "MUG", quantity: 1 }] }, { "Idempotency-Key": "abc" });
    assert.equal((await post({ customerId: "alice", items: [] })).status, 400);
    assert.equal((await post({ customerId: 42 })).status, 400);
    assert.equal((await post({ customerId: "bob", items: [{ sku: "PEN", quantity: 9 }] }, { "Idempotency-Key": "abc" })).status, 422);
    assert.equal((await fetch(`${baseUrl}/orders/nope`)).status, 404);
  });

  it("serves the web UI", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  });

  it("records a dev trace of the real port calls when asked to", async () => {
    const res = await post({ customerId: "carol", items: [{ sku: "BOOK", quantity: 1 }] }, { "X-Dev-Trace": "1" });
    const trace = await (await fetch(`${baseUrl}/dev/traces/${res.headers.get("x-trace-id")}`)).json();
    const calls = trace.steps.filter((s: { kind: string }) => s.kind === "call").map((s: { port: string; method: string }) => `${s.port}.${s.method}`);
    assert.deepEqual(calls, [
      "PlaceOrder.execute",
      "ProductCatalog.priceOf",
      "IdGenerator.next",
      "Clock.now",
      "OrderRepository.save",
      "PaymentGateway.charge",
      "OrderRepository.save",
      "Notifier.orderPlaced",
    ]);
  });
});
