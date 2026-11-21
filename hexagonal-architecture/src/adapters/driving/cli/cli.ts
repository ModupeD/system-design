// ─────────────────────────────────────────────────────────────────────────────
// DRIVING ADAPTER: command line.
// A completely different way into the SAME application. Compare it with
// httpServer.ts: both translate their own world (argv / HTTP) into calls on the
// same input ports, and both map the same core errors to their own channel
// (exit codes here, status codes there).
// ─────────────────────────────────────────────────────────────────────────────

import { IdempotencyConflictError, OrderNotFoundError } from "../../../application/errors.ts";
import type { GetOrders } from "../../../application/ports/in/GetOrders.ts";
import type { ListProducts } from "../../../application/ports/in/ListProducts.ts";
import type { PlaceOrder, RequestedItem } from "../../../application/ports/in/PlaceOrder.ts";
import { DomainError } from "../../../domain/errors.ts";
import type { Order } from "../../../domain/Order.ts";
import { formatMoney } from "../../shared/formatMoney.ts";

const USAGE = `Usage:
  npm run cli -- place <customerId> <sku:quantity> [...more items] [--key <idempotencyKey>]
  npm run cli -- get <orderId>
  npm run cli -- list
  npm run cli -- products

Example:
  npm run cli -- place alice BOOK:2 PEN:3 --key checkout-42`;

export interface CliDeps {
  placeOrder: PlaceOrder;
  getOrders: GetOrders;
  listProducts: ListProducts;
}

class UsageError extends Error {}

/** Returns the process exit code: 0 success, 1 rejected or failed, 2 payment still pending. */
export async function runCli(args: string[], deps: CliDeps, out: (line: string) => void = console.log): Promise<number> {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case "place": {
        const { positional, key } = extractKey(rest);
        const [customerId, ...itemArgs] = positional;
        if (!customerId || itemArgs.length === 0) throw new UsageError();
        const order = await deps.placeOrder.execute({ customerId, items: itemArgs.map(parseItem), idempotencyKey: key });
        out(describe(order));
        if (order.status === "PENDING") {
          out(
            key
              ? "Payment outcome unknown. Re-run the same command with the same --key to retry safely."
              : "Payment outcome unknown. (Pass --key next time so a retry can't create a second order.)",
          );
        }
        return order.status === "PAID" ? 0 : order.status === "PENDING" ? 2 : 1;
      }
      case "get": {
        if (!rest[0]) throw new UsageError();
        out(describe(await deps.getOrders.byId(rest[0])));
        return 0;
      }
      case "list": {
        const orders = await deps.getOrders.list();
        out(orders.length ? orders.map(describe).join("\n") : "(no orders yet)");
        return 0;
      }
      case "products": {
        for (const p of await deps.listProducts.list()) out(`${p.sku.padEnd(12)} ${formatMoney(p.priceCents).padStart(10)}  ${p.name}`);
        return 0;
      }
      default:
        throw new UsageError();
    }
  } catch (err) {
    if (err instanceof UsageError) {
      out(err.message ? `Error: ${err.message}\n\n${USAGE}` : USAGE);
      return 1;
    }
    if (err instanceof DomainError || err instanceof OrderNotFoundError || err instanceof IdempotencyConflictError) {
      out(`Error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

function extractKey(args: string[]): { positional: string[]; key?: string } {
  const i = args.indexOf("--key");
  if (i === -1) return { positional: args };
  const key = args[i + 1];
  if (!key) throw new UsageError("--key needs a value");
  return { positional: [...args.slice(0, i), ...args.slice(i + 2)], key };
}

function parseItem(arg: string): RequestedItem {
  const [sku, qty, extra] = arg.split(":");
  if (!sku || qty === undefined || extra !== undefined) {
    throw new UsageError(`Item "${arg}" must look like SKU:quantity (prices come from the catalog)`);
  }
  return { sku, quantity: Number(qty) };
}

function describe(o: Order): string {
  const extra = o.status === "PAID" ? `payment ${o.paymentId}` : (o.failureReason ?? "");
  return `${o.id}  ${o.customerId.padEnd(10)} ${formatMoney(o.totalCents).padStart(10)}  ${o.status.padEnd(14)} ${extra}`;
}
