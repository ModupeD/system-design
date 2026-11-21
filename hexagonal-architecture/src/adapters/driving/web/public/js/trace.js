// Turns one request's result (from api.request) into the steps the Explorer
// shows and animates. Every step is labelled with where it came from:
//
//   browser    measured in this page (request sent / response received)
//   recorded   recorded by the server's DevTracer: a real port call that ran
//   inferred   not recorded directly, but proven by recorded data. Domain
//              functions are plain calls inside the core, so they aren't
//              proxied; we can still see their effect (an order handed to
//              OrderRepository.save() with status PENDING was made by
//              createOrder()).
//   conceptual the textbook flow, shown only when you ask for it or when no
//              trace exists. Nothing here was recorded.

import { COMPONENTS, nodeIdFor } from "./components.js";
import { short } from "./dom.js";

export function toDisplaySteps(result) {
  const steps = [];
  const add = (step) => steps.push({ depth: 0, edges: [], ...step });
  const key = result.headers?.["Idempotency-Key"];

  add({
    source: "browser",
    nodes: ["webUi"],
    title: `Web UI sends ${result.method} ${result.path}`,
    detail: [key ? `Idempotency-Key: ${key}` : null, result.requestBody ? short(result.requestBody, 400) : null].filter(Boolean).join("\n"),
  });

  if (result.networkError) {
    add({ source: "browser", nodes: ["webUi"], title: "No response from the server", detail: result.body.error, error: { name: "NetworkError", message: result.body.error } });
    return steps;
  }

  if (!result.trace) {
    add({
      source: "missing",
      nodes: ["httpServer"],
      title: "No server trace for this request",
      detail: "Dev tools are off (DEV_TOOLS=off or NODE_ENV=production), so the server didn't record which components ran. Use “Show conceptual flow” for the textbook path.",
    });
  } else {
    addRecordedSteps(result.trace, add);
  }

  add({
    source: "browser",
    nodes: ["webUi"],
    title: `Web UI receives HTTP ${result.status}`,
    detail: result.body?.status ? `Order status: ${result.body.status}` : result.body?.error ? `Error (${result.body.kind}): ${result.body.error}` : "",
  });
  return steps;
}

function addRecordedSteps(trace, add) {
  const bySeq = new Map(trace.steps.map((s) => [s.seq, s]));
  const implOf = (s) => (s.kind === "note" ? "httpServer" : nodeIdFor(s.component));
  const depthOf = (s) => {
    let depth = 0;
    for (let p = s.parent; p != null; p = bySeq.get(p)?.parent ?? null) depth++;
    return depth;
  };

  const savedOrderIds = new Set();
  let sawUnknownProduct = false;
  let sawSave = false;
  let pendingError = null; // an inferred rejection, shown just before the HTTP response

  for (const s of trace.steps) {
    if (s.kind === "note") {
      if (s.detail.startsWith("responded") && pendingError) {
        add(pendingError);
        pendingError = null;
      }
      add({
        source: "recorded",
        nodes: ["httpServer"],
        edges: s.detail.startsWith("received") ? [["webUi", "httpServer"]] : [],
        title: `HTTP adapter ${s.detail}`,
        detail: s.detail.startsWith("received") ? "Parses JSON, checks the shape, builds a command for the input port." : "Maps the core's result (or error) to a status code and a JSON body.",
      });
      continue;
    }

    const caller = s.parent != null ? implOf(bySeq.get(s.parent)) : "httpServer";
    const portNode = nodeIdFor(s.port);
    const implNode = nodeIdFor(s.component);
    const depth = depthOf(s);

    // Domain transitions are visible in the order handed to the repository.
    if (s.port === "OrderRepository" && s.method === "save") {
      sawSave = true;
      const order = s.args[0];
      const transition =
        order?.status === "PENDING" && !savedOrderIds.has(order.id)
          ? ["createOrder()", "checked the rules and computed the total → a PENDING order"]
          : order?.status === "PAID"
            ? ["markPaid()", "moved the order PENDING → PAID"]
            : order?.status === "PAYMENT_FAILED"
              ? ["markPaymentFailed()", "moved the order PENDING → PAYMENT_FAILED"]
              : null;
      if (transition) {
        add({
          source: "inferred",
          nodes: ["Order"],
          edges: [[caller, "Order"]],
          depth,
          title: `Domain: ${transition[0]} ${transition[1]}`,
          detail: `Seen in the next recorded call: OrderRepository.save() received an order with status ${order.status}${order.totalCents != null ? ` and totalCents ${order.totalCents}` : ""}.`,
        });
      }
      if (order?.id) savedOrderIds.add(order.id);
    }

    add({
      source: "recorded",
      nodes: [portNode, implNode].filter(Boolean),
      edges: [
        [caller, portNode],
        [portNode, implNode],
      ],
      depth,
      title: `${s.port}.${s.method}()  →  ${s.component}`,
      detail: callDetail(s),
      error: s.error,
      durationMs: s.durationMs,
      kindNote: COMPONENTS[portNode]?.kind === "interface" ? `called through the ${s.port} interface; ${s.component} ran` : undefined,
    });

    if (s.port === "ProductCatalog" && s.method === "priceOf" && s.result === null) {
      sawUnknownProduct = true;
      add({
        source: "inferred",
        nodes: ["PlaceOrderService", "DomainError"],
        depth,
        title: `PlaceOrderService: no price for "${s.args[0]}" → throws DomainError`,
        detail: "The catalog returned undefined, so the service rejects the order before anything is saved or charged.",
      });
    }
    if (s.port === "OrderRepository" && s.method === "findByIdempotencyKey" && s.result) {
      const existing = s.result;
      add({
        source: "inferred",
        nodes: ["PlaceOrderService"],
        depth,
        title:
          existing.status === "PENDING"
            ? "PlaceOrderService: key seen before, order still PENDING → retry its payment"
            : `PlaceOrderService: key seen before → return the existing ${existing.status} order`,
        detail:
          existing.status === "PENDING"
            ? `Same order id (${existing.id}) is charged again, so the provider can deduplicate it. No new order is created.`
            : "No new order, no new charge. Compare the PaymentGateway calls with the first request.",
      });
    }
    if (s.port === "PaymentGateway" && s.result?.status === "unknown") {
      add({
        source: "inferred",
        nodes: ["PlaceOrderService"],
        depth,
        title: "PlaceOrderService: outcome unknown → leave the order PENDING",
        detail: "No domain transition and no second save. The client may retry with the same Idempotency-Key.",
      });
    }
    if (s.port === "PlaceOrder" && s.error) {
      if (s.error.name === "DomainError" && !sawUnknownProduct && !sawSave) {
        pendingError = {
          source: "inferred",
          nodes: ["Order", "DomainError"],
          edges: [
            ["PlaceOrderService", "Order"],
            ["Order", "DomainError"],
          ],
          depth: 1,
          title: "Domain: createOrder() rejected the order (DomainError)",
          detail: `${s.error.message}\nexecute() threw a DomainError before any save or charge was recorded.`,
          error: s.error,
        };
      } else if (s.error.name === "IdempotencyConflictError") {
        pendingError = {
          source: "inferred",
          nodes: ["PlaceOrderService", "ApplicationErrors"],
          depth: 1,
          title: "PlaceOrderService: same key, different request → IdempotencyConflictError",
          detail: s.error.message,
          error: s.error,
        };
      }
    }
  }
  if (pendingError) add(pendingError);
}

function callDetail(s) {
  const args = s.args.length ? `args: ${s.args.map((a) => short(a, 220)).join(", ")}` : "args: (none)";
  const outcome = s.error ? `✖ threw ${s.error.name}: ${s.error.message}` : `→ ${s.result === null ? "undefined" : short(s.result, 260)}`;
  return `${args}\n${outcome}`;
}

/** The textbook place-order path, built from whichever adapters are plugged in. */
export function conceptualPlaceOrderSteps(config) {
  const a = config?.adapters ?? {};
  const repo = a.OrderRepository ?? "InMemoryOrderRepository";
  const gateway = a.PaymentGateway ?? "FakePaymentGateway";
  const notifier = a.Notifier ?? "ConsoleNotifier";
  const step = (nodes, title, edges = []) => ({ source: "conceptual", depth: 0, nodes, title, edges, detail: "" });
  return [
    step(["webUi"], "Web UI sends POST /orders"),
    step(["httpServer"], "HTTP adapter parses JSON and builds a PlaceOrderCommand", [["webUi", "httpServer"]]),
    step(["PlaceOrder", "PlaceOrderService"], "PlaceOrder.execute() → PlaceOrderService", [["httpServer", "PlaceOrder"], ["PlaceOrder", "PlaceOrderService"]]),
    step(["OrderRepository", repo], "Was this Idempotency-Key seen before?", [["PlaceOrderService", "OrderRepository"], ["OrderRepository", repo]]),
    step(["ProductCatalog", "InMemoryProductCatalog"], "Look up each price on the server", [["PlaceOrderService", "ProductCatalog"], ["ProductCatalog", "InMemoryProductCatalog"]]),
    step(["System", "SystemClock"], "New id and timestamp", [["PlaceOrderService", "System"], ["System", "SystemClock"]]),
    step(["Order"], "Domain: createOrder() checks the rules → PENDING", [["PlaceOrderService", "Order"]]),
    step(["OrderRepository", repo], "Save the PENDING order BEFORE charging", [["PlaceOrderService", "OrderRepository"], ["OrderRepository", repo]]),
    step(["PaymentGateway", gateway], "Charge: succeeded / declined / unknown", [["PlaceOrderService", "PaymentGateway"], ["PaymentGateway", gateway]]),
    step(["Order"], "Domain: markPaid() or markPaymentFailed()", [["PlaceOrderService", "Order"]]),
    step(["OrderRepository", repo], "Save the final status", [["PlaceOrderService", "OrderRepository"], ["OrderRepository", repo]]),
    step(["Notifier", notifier], "Notify (best-effort)", [["PlaceOrderService", "Notifier"], ["Notifier", notifier]]),
    step(["httpServer"], "HTTP adapter maps the Order to JSON: 201, or 202 if PENDING"),
    step(["webUi"], "Web UI renders the result"),
  ];
}
