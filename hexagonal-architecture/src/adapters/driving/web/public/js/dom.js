// Small DOM and formatting helpers. Text is always inserted with textContent,
// never innerHTML, so values typed by users (customer ids) can't inject markup.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
}

/** Like node.replaceChildren(), but skips null/false (native replaceChildren would print "false"). */
export function fill(node, ...children) {
  node.replaceChildren();
  appendChildren(node, children);
  return node;
}

function applyAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function short(value, max = 160) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Display only. Prices and totals are decided by the server; this just formats
// numbers the server sent (and the cart's labelled estimate).
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatCents = (cents) => usd.format(cents / 100);

const STATUS_TEXT = { PAID: "Paid", PAYMENT_FAILED: "Payment failed", PENDING: "Pending" };
export function statusBadge(status) {
  return el("span", { class: `badge badge-${String(status).toLowerCase()}` }, STATUS_TEXT[status] ?? status);
}

export function httpBadge(status) {
  const cls = status === 0 ? "err" : status >= 500 ? "err" : status >= 400 ? "warn" : status === 202 ? "pending" : "ok";
  return el("span", { class: `badge badge-http-${cls}` }, status === 0 ? "no response" : `HTTP ${status}`);
}

/** localStorage that never throws (private windows, blocked storage). */
export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable: retry buttons just won't survive a reload
    }
  },
};
