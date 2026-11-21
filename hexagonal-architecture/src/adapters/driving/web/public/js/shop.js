// The Shop tab: catalog, cart, order placement, history, details and retry.
// It's a driving adapter in the browser. It sends requests, shows responses,
// and owns the client-side half of idempotency: one key per checkout attempt,
// reused for retries of that same attempt.

import * as api from "./api.js";
import { COMPONENTS } from "./components.js";
import { $, el, fill, formatCents, httpBadge, statusBadge, storage } from "./dom.js";
import { toDisplaySteps } from "./trace.js";

const ATTEMPTS_KEY = "hexorders.attempts.v1";

const ERROR_EXPLANATIONS = {
  "domain-rule": "Rejected by a business rule in the core (DomainError → HTTP 400). Nothing was saved or charged.",
  "bad-request": "Rejected by the HTTP adapter's shape check (HTTP 400), before the request reached the core.",
  "idempotency-conflict": "This Idempotency-Key was already used for a different order (HTTP 422). Change the order to start a new attempt.",
  "not-found": "Not found (HTTP 404).",
  network: "The browser couldn't reach the server. The key is kept, so trying again is safe.",
  internal: "Unexpected server error (HTTP 500). Check the terminal running npm start.",
};

const RESULT_TEXT = {
  PAID: ["Payment confirmed", "The payment gateway took the money and the order was saved as PAID."],
  PAYMENT_FAILED: ["Payment declined", "The payment provider definitively refused. The order was saved as PAYMENT_FAILED and no money was taken."],
  PENDING: [
    "Payment outcome unknown",
    "The gateway couldn't confirm whether money moved, so the order was saved as PENDING (HTTP 202). Retrying is safe: it reuses the same Idempotency-Key, so the server charges the same order again instead of creating a new one.",
  ],
};

export function initShop({ onRun, onWatch }) {
  const state = {
    products: [],
    cart: new Map(),
    key: api.newIdempotencyKey(),
    keyHeld: false,
    config: null,
    attempts: storage.get(ATTEMPTS_KEY, {}),
  };

  // ── Catalog ────────────────────────────────────────────────────────────
  async function loadProducts() {
    const list = $("#product-list");
    const result = await api.listProducts({ trace: false });
    if (!result.ok) {
      fill(list, el("p", { class: "error" }, result.body?.error ?? "Could not load products."));
      return;
    }
    state.products = result.body;
    fill(list, 
      ...state.products.map((p) =>
        el(
          "article",
          { class: "product" },
          el("div", { class: "product-sku" }, p.sku),
          el("h3", { class: "product-name" }, p.name),
          el("div", { class: "product-price" }, p.price),
          el("button", { type: "button", class: "btn", onclick: () => addToCart(p.sku), "aria-label": `Add ${p.name} to the order` }, "Add to order"),
        ),
      ),
    );
    renderCart();
  }

  // ── Cart ───────────────────────────────────────────────────────────────
  function addToCart(sku) {
    state.cart.set(sku, (state.cart.get(sku) ?? 0) + 1);
    attemptChanged();
    renderCart();
  }

  function attemptChanged() {
    // A different order is a different checkout attempt, so it needs a new key.
    if (state.keyHeld) {
      state.key = api.newIdempotencyKey();
      state.keyHeld = false;
    }
    renderKey();
  }

  function renderCart() {
    const rows = [...state.cart].map(([sku, quantity]) => {
      const product = state.products.find((p) => p.sku === sku);
      return el(
        "li",
        { class: "cart-row" },
        el("div", { class: "cart-name" }, el("strong", {}, product?.name ?? sku), el("span", { class: "muted" }, ` ${sku} · ${product?.price ?? "?"} each`)),
        el("label", { class: "qty" }, el("span", { class: "sr-only" }, `Quantity of ${sku}`),
          el("input", {
            type: "number",
            step: "1",
            value: String(quantity),
            inputmode: "numeric",
            onchange: (e) => {
              state.cart.set(sku, Number(e.target.value));
              attemptChanged();
              renderCart();
            },
          }),
        ),
        el("span", { class: "cart-line" }, product && Number.isFinite(quantity) ? formatCents(product.priceCents * quantity) : ""),
        el("button", { type: "button", class: "btn btn-ghost", "aria-label": `Remove ${sku}`, onclick: () => (state.cart.delete(sku), attemptChanged(), renderCart()) }, "Remove"),
      );
    });
    fill($("#cart-items"), ...rows);
    $("#cart-empty").hidden = rows.length > 0;

    const estimate = [...state.cart].reduce((sum, [sku, q]) => sum + (state.products.find((p) => p.sku === sku)?.priceCents ?? 0) * (Number.isFinite(q) ? q : 0), 0);
    $("#cart-estimate").textContent = formatCents(estimate);
  }

  function renderKey() {
    $("#idem-key").textContent = state.key;
    $("#key-state").textContent = state.keyHeld
      ? "Kept: pressing Place order again retries this same attempt."
      : "New attempt: generated in the browser, sent as the Idempotency-Key header.";
  }

  // ── Placing an order ───────────────────────────────────────────────────
  async function placeOrder(body = currentBody(), key = state.key, { fromHistory = false } = {}) {
    const button = $("#place-order");
    button.disabled = true;
    $("#order-feedback").textContent = "Sending POST /orders…";
    let result;
    try {
      result = await api.placeOrder(body, key);
    } finally {
      button.disabled = false;
      $("#order-feedback").textContent = "";
    }

    if (result.body?.id) {
      state.attempts[result.body.id] = { key, body };
      storage.set(ATTEMPTS_KEY, state.attempts);
    }
    if (!fromHistory) {
      if (result.networkError || result.status === 202) {
        state.keyHeld = true;
      } else {
        state.key = api.newIdempotencyKey();
        state.keyHeld = false;
        if (result.status === 201 && result.body?.status === "PAID") state.cart.clear();
      }
      renderKey();
      renderCart();
    }

    const run = { title: `Shop order: ${body.customerId || "(no customer id)"}, ${describeItems(body.items)}`, results: [result], body, key };
    onRun(run);
    renderResult(result, run);
    refreshHistory();
  }

  function currentBody() {
    return {
      customerId: $("#customer-id").value,
      items: [...state.cart].map(([sku, quantity]) => ({ sku, quantity })),
    };
  }

  function renderResult(result, run) {
    const card = $("#result-card");
    card.hidden = false;
    const order = result.body?.id ? result.body : null;
    const steps = toDisplaySteps(result).filter((s) => s.source === "recorded" || s.source === "inferred");
    const path = [];
    for (const s of steps) for (const id of s.nodes) if (!path.includes(id)) path.push(id); // first appearance order

    const heading = order ? RESULT_TEXT[order.status] : ["Order rejected", ERROR_EXPLANATIONS[result.body?.kind] ?? "The server rejected the request."];

    card.className = `card result result-${order ? order.status.toLowerCase() : "error"}`;
    fill(card, 
      el("div", { class: "result-head" }, el("h2", {}, heading[0]), httpBadge(result.status), order && statusBadge(order.status)),
      el("p", {}, heading[1]),
      !order && result.body?.error && el("p", { class: "error-message" }, result.body.error),
      order &&
        el(
          "dl",
          { class: "facts" },
          el("dt", {}, "Order id"), el("dd", {}, el("code", {}, order.id)),
          el("dt", {}, "Total (priced by the server)"), el("dd", {}, order.total),
          order.paymentId && [el("dt", {}, "Payment id"), el("dd", {}, el("code", {}, order.paymentId))],
          order.failureReason && [el("dt", {}, "Reason"), el("dd", {}, order.failureReason)],
          el("dt", {}, "Idempotency-Key"), el("dd", {}, el("code", {}, run.key)),
        ),
      el(
        "div",
        { class: "result-path" },
        el("span", { class: "rel-label" }, result.trace ? "Components that handled it (recorded, in order of first use)" : "Path"),
        result.trace
          ? el("ol", { class: "path" }, path.map((id) => el("li", { class: `chip layer-${COMPONENTS[id].layer}` }, COMPONENTS[id].title)))
          : el("span", { class: "muted" }, "No trace (dev tools are off)."),
      ),
      el(
        "div",
        { class: "actions" },
        el("button", { type: "button", class: "btn btn-primary", onclick: () => onWatch(run) }, "▶ Watch this request in the Architecture Explorer"),
        (result.status === 202 || result.networkError) &&
          el("button", { type: "button", class: "btn", onclick: () => placeOrder(run.body, run.key, { fromHistory: true }) }, "Retry now (same Idempotency-Key)"),
      ),
    );
  }

  // ── History + details ──────────────────────────────────────────────────
  async function refreshHistory() {
    const result = await api.listOrders();
    const body = $("#history-body");
    if (!result.ok) {
      fill(body, el("tr", {}, el("td", { colspan: "6", class: "error" }, result.body?.error ?? "Could not load orders.")));
      return;
    }
    const orders = [...result.body].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    $("#history-empty").hidden = orders.length > 0;
    fill(body, 
      ...orders.map((o) => {
        const attempt = state.attempts[o.id];
        return el(
          "tr",
          {},
          el("td", {}, new Date(o.createdAt).toLocaleTimeString()),
          el("td", {}, el("code", { title: o.id }, o.id.slice(0, 8))),
          el("td", {}, o.customerId),
          el("td", { class: "num" }, o.total),
          el("td", {}, statusBadge(o.status)),
          el(
            "td",
            { class: "row-actions" },
            el("button", { type: "button", class: "btn btn-ghost", onclick: () => showDetails(o.id) }, "Details"),
            o.status === "PENDING" &&
              (attempt
                ? el("button", { type: "button", class: "btn", onclick: () => placeOrder(attempt.body, attempt.key, { fromHistory: true }) }, "Retry payment")
                : el("span", { class: "muted", title: "Placed without a key from this browser (e.g. the CLI)" }, "no key")),
          ),
        );
      }),
    );
    const storageName = state.config?.adapters?.OrderRepository;
    $("#history-storage").textContent = storageName
      ? `Read with GET /orders → GetOrders → ${storageName}${storageName === "InMemoryOrderRepository" ? " (cleared when the server restarts)" : ""}.`
      : "Read with GET /orders.";
  }

  async function showDetails(id) {
    const box = $("#order-details");
    box.hidden = false;
    fill(box, el("p", { class: "muted" }, "Loading GET /orders/" + id + "…"));
    const result = await api.getOrder(id);
    if (!result.ok) {
      fill(box, el("p", { class: "error" }, result.body?.error ?? "Could not load the order."));
      return;
    }
    const o = result.body;
    const attempt = state.attempts[o.id];
    fill(box, 
      el("div", { class: "result-head" }, el("h3", {}, "Order details"), statusBadge(o.status),
        el("button", { type: "button", class: "btn btn-ghost", onclick: () => (box.hidden = true) }, "Close")),
      el(
        "dl",
        { class: "facts" },
        el("dt", {}, "Order id"), el("dd", {}, el("code", {}, o.id)),
        el("dt", {}, "Customer"), el("dd", {}, o.customerId),
        el("dt", {}, "Created"), el("dd", {}, new Date(o.createdAt).toLocaleString()),
        el("dt", {}, "Total"), el("dd", {}, o.total),
        el("dt", {}, "Payment id"), el("dd", {}, o.paymentId ? el("code", {}, o.paymentId) : "—"),
        el("dt", {}, "Failure reason"), el("dd", {}, o.failureReason ?? "—"),
        el("dt", {}, "Idempotency-Key"), el("dd", {}, attempt ? el("code", {}, attempt.key) : "not placed from this browser"),
      ),
      el(
        "table",
        { class: "items" },
        el("thead", {}, el("tr", {}, el("th", {}, "SKU"), el("th", { class: "num" }, "Qty"), el("th", { class: "num" }, "Unit price (snapshot)"), el("th", { class: "num" }, "Line"))),
        el(
          "tbody",
          {},
          o.items.map((i) =>
            el("tr", {}, el("td", {}, i.sku), el("td", { class: "num" }, String(i.quantity)), el("td", { class: "num" }, formatCents(i.unitPriceCents)), el("td", { class: "num" }, formatCents(i.unitPriceCents * i.quantity))),
          ),
        ),
      ),
    );
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  $("#place-order").addEventListener("click", () => placeOrder());
  $("#customer-id").addEventListener("input", attemptChanged);
  $("#new-key").addEventListener("click", () => {
    state.key = api.newIdempotencyKey();
    state.keyHeld = false;
    renderKey();
  });
  $("#history-refresh").addEventListener("click", refreshHistory);

  renderKey();
  renderCart();
  loadProducts();
  refreshHistory();

  return {
    setConfig(config) {
      state.config = config;
      refreshHistory();
    },
  };
}

function describeItems(items) {
  return items.length ? items.map((i) => `${i.quantity} × ${i.sku}`).join(", ") : "no items";
}
