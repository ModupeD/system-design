// ─────────────────────────────────────────────────────────────────────────────
// DRIVING ADAPTER: HTTP.
// Its whole job is translation:
//   HTTP request  ──▶  a call on an input port (PlaceOrder / GetOrders / ListProducts)
//   core result   ──▶  HTTP response (status code + JSON DTO)
//   core errors   ──▶  HTTP status codes
//
// It also serves the browser UI (another driving adapter, in ../web) and, in
// development only, the /dev routes and request tracing for the Architecture
// Explorer. No business rules in here. Built on plain `node:http` so no
// framework hides what's happening.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { IdempotencyConflictError, OrderNotFoundError } from "../../../application/errors.ts";
import type { GetOrders } from "../../../application/ports/in/GetOrders.ts";
import type { ListProducts } from "../../../application/ports/in/ListProducts.ts";
import type { PlaceOrder, PlaceOrderCommand } from "../../../application/ports/in/PlaceOrder.ts";
import { DomainError } from "../../../domain/errors.ts";
import type { Order } from "../../../domain/Order.ts";
import type { Product } from "../../../domain/Product.ts";
import { formatMoney } from "../../shared/formatMoney.ts";
import { handleDevRoute, type DevOptions } from "../web/devRoutes.ts";
import { serveStatic } from "../web/staticFiles.ts";

export interface HttpDeps {
  placeOrder: PlaceOrder;
  getOrders: GetOrders;
  listProducts: ListProducts;
  /** Serve the browser UI from adapters/driving/web/public. Default: true. */
  webUi?: boolean;
  /** DEVELOPMENT ONLY: request tracing and the /dev routes. Leave undefined in production. */
  dev?: DevOptions;
}

const MAX_BODY_BYTES = 1_000_000;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface HttpResult {
  status: number;
  body: unknown;
}

export function createHttpServer(deps: HttpDeps): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (deps.dev && url.pathname.startsWith("/dev/")) return await handleDevRoute(req, res, url, deps.dev);
      if (deps.webUi !== false && req.method === "GET" && (await serveStatic(url.pathname, res))) return;

      // A client can ask for a trace of its request (the Explorer sends X-Dev-Trace: 1).
      const tracer = deps.dev?.tracer;
      if (tracer && req.headers["x-dev-trace"] === "1") {
        await tracer.run(`${req.method} ${url.pathname}`, async (traceId) => {
          res.setHeader("X-Trace-Id", traceId);
          await handleApiRequest(req, res, url, deps);
        });
      } else {
        await handleApiRequest(req, res, url, deps);
      }
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: "Internal server error", kind: "internal" });
    }
  });
}

async function handleApiRequest(req: IncomingMessage, res: ServerResponse, url: URL, deps: HttpDeps): Promise<void> {
  const tracer = deps.dev?.tracer;
  tracer?.note("httpServer", `received ${req.method} ${url.pathname}`);

  let result: HttpResult;
  try {
    result = await route(req, url, deps);
  } catch (err) {
    result = errorResult(err);
  }

  tracer?.note("httpServer", `responded ${result.status}`);
  send(res, result.status, result.body);
}

async function route(req: IncomingMessage, url: URL, { placeOrder, getOrders, listProducts }: HttpDeps): Promise<HttpResult> {
  const orderIdMatch = url.pathname.match(/^\/orders\/([^/]+)$/);

  if (req.method === "POST" && url.pathname === "/orders") {
    const command = toPlaceOrderCommand(await readJson(req), req.headers["idempotency-key"]);
    const order = await placeOrder.execute(command);
    // 202 Accepted: the order exists but its payment outcome is still unknown.
    return { status: order.status === "PENDING" ? 202 : 201, body: toOrderDto(order) };
  }
  if (req.method === "GET" && url.pathname === "/orders") {
    return { status: 200, body: (await getOrders.list()).map(toOrderDto) };
  }
  if (req.method === "GET" && orderIdMatch) {
    return { status: 200, body: toOrderDto(await getOrders.byId(decodeURIComponent(orderIdMatch[1]!))) };
  }
  if (req.method === "GET" && url.pathname === "/products") {
    return { status: 200, body: (await listProducts.list()).map(toProductDto) };
  }
  return { status: 404, body: { error: "Route not found", kind: "not-found" } };
}

// Core errors → HTTP status codes. The core never knows HTTP exists.
// `kind` tells the client which layer rejected the request.
function errorResult(err: unknown): HttpResult {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message, kind: "bad-request" } };
  if (err instanceof DomainError) return { status: 400, body: { error: err.message, kind: "domain-rule" } };
  if (err instanceof OrderNotFoundError) return { status: 404, body: { error: err.message, kind: "not-found" } };
  if (err instanceof IdempotencyConflictError) return { status: 422, body: { error: err.message, kind: "idempotency-conflict" } };
  console.error(err);
  return { status: 500, body: { error: "Internal server error", kind: "internal" } };
}

// Transport-level validation ("is this the right shape?"). Business validation
// ("is the total positive?", "does this product exist?") belongs to the core.
function toPlaceOrderCommand(body: unknown, idempotencyHeader: string | string[] | undefined): PlaceOrderCommand {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "Body must be a JSON object");
  const { customerId, items } = body as Record<string, unknown>;
  if (typeof customerId !== "string") throw new HttpError(400, "customerId must be a string");
  if (!Array.isArray(items)) throw new HttpError(400, "items must be an array");
  if (Array.isArray(idempotencyHeader)) throw new HttpError(400, "Send at most one Idempotency-Key header");

  return {
    customerId,
    idempotencyKey: idempotencyHeader || undefined,
    items: items.map((raw, i) => {
      const item = raw as Record<string, unknown> | null;
      if (typeof item?.sku !== "string" || typeof item.quantity !== "number") {
        throw new HttpError(400, `items[${i}] needs sku (string) and quantity (number)`);
      }
      // Any client-sent price is ignored: prices come from the server's catalog.
      return { sku: item.sku, quantity: item.quantity };
    }),
  };
}

// The public API shapes (DTOs) are separate from the domain model, so the
// domain can change without breaking API clients, and vice versa.
function toOrderDto(order: Order) {
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    total: formatMoney(order.totalCents),
    totalCents: order.totalCents,
    items: order.items,
    paymentId: order.paymentId ?? null,
    failureReason: order.failureReason ?? null,
    createdAt: order.createdAt,
  };
}

function toProductDto(product: Product) {
  return { sku: product.sku, name: product.name, priceCents: product.priceCents, price: formatMoney(product.priceCents) };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}
