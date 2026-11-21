// ENTRY POINT: build the application, then start the HTTP driving adapter.
// The same server also serves the web UI and, in development, the
// Architecture Explorer's tracing and /dev routes.

import { createHttpServer } from "./adapters/driving/http/httpServer.ts";
import { DevTracer } from "./adapters/shared/devTracing.ts";
import { buildApp } from "./composition/container.ts";

const devToolsEnabled = process.env.DEV_TOOLS !== "off" && process.env.NODE_ENV !== "production";
const tracer = devToolsEnabled ? new DevTracer() : undefined;

const app = buildApp(process.env, { tracer });
const port = Number(process.env.PORT ?? 3000);

createHttpServer({
  placeOrder: app.placeOrder,
  getOrders: app.getOrders,
  listProducts: app.listProducts,
  dev: tracer ? { tracer, adapters: app.adapters } : undefined,
}).listen(port, () => {
  console.log(`Orders app on http://localhost:${port}  (web UI + JSON API)`);
  console.log(`Adapters: ${app.description}`);
  console.log(
    devToolsEnabled
      ? "Dev tools: ON (request tracing + /dev routes for the Architecture Explorer). Disable with DEV_TOOLS=off."
      : "Dev tools: off",
  );
});
