// The browser's side of the HTTP boundary. Everything the UI knows about the
// application arrives through these calls, as JSON. No business rules here.

export async function request(method, path, { body, headers = {}, trace = true } = {}) {
  const sentHeaders = { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers };
  // Ask the server (dev tools only) to record which components handled this request.
  if (trace) sentHeaders["X-Dev-Trace"] = "1";

  let res;
  try {
    res = await fetch(path, { method, headers: sentHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { method, path, requestBody: body, headers, status: 0, ok: false, networkError: true, body: { error: "Could not reach the server. Is `npm start` running?", kind: "network" }, trace: null };
  }

  const json = await res.json().catch(() => null);
  const traceId = res.headers.get("X-Trace-Id");
  const recorded = traceId ? await fetchTrace(traceId) : null;
  return { method, path, requestBody: body, headers, status: res.status, ok: res.ok, body: json, trace: recorded };
}

async function fetchTrace(traceId) {
  try {
    const res = await fetch(`/dev/traces/${encodeURIComponent(traceId)}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export const listProducts = (options) => request("GET", "/products", options);
export const listOrders = () => request("GET", "/orders", { trace: false });
export const getOrder = (id) => request("GET", `/orders/${encodeURIComponent(id)}`, { trace: false });

export function placeOrder(body, idempotencyKey) {
  return request("POST", "/orders", { body, headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {} });
}

/** One key per checkout attempt; reuse it to retry the SAME attempt. */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

// ── Development-only endpoints (404 when DEV_TOOLS=off) ─────────────────────

export async function devConfig() {
  try {
    const res = await fetch("/dev/config");
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function devImports() {
  try {
    const res = await fetch("/dev/imports");
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const sourceCache = new Map();
export function devSource(file) {
  if (!sourceCache.has(file)) {
    sourceCache.set(
      file,
      fetch(`/dev/source?file=${encodeURIComponent(file)}`)
        .then((res) => (res.ok ? res.text() : null))
        .catch(() => null),
    );
  }
  return sourceCache.get(file);
}
