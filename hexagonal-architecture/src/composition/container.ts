// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION ROOT: the ONE place that knows about every concrete class.
// It picks an adapter for each output port, passes them into the application
// services through their constructors, and hands back the input ports.
// Change an environment variable and the app uses a different database,
// payment provider, or chat tool, without touching domain or application code.
// ─────────────────────────────────────────────────────────────────────────────

import type { GetOrders } from "../application/ports/in/GetOrders.ts";
import type { ListProducts } from "../application/ports/in/ListProducts.ts";
import type { PlaceOrder } from "../application/ports/in/PlaceOrder.ts";
import type { Notifier } from "../application/ports/out/Notifier.ts";
import type { OrderRepository } from "../application/ports/out/OrderRepository.ts";
import type { PaymentGateway } from "../application/ports/out/PaymentGateway.ts";
import { GetOrdersService } from "../application/services/GetOrdersService.ts";
import { ListProductsService } from "../application/services/ListProductsService.ts";
import { PlaceOrderService } from "../application/services/PlaceOrderService.ts";
import { InMemoryProductCatalog } from "../adapters/driven/catalog/InMemoryProductCatalog.ts";
import { ConsoleNotifier } from "../adapters/driven/notification/ConsoleNotifier.ts";
import { SlackNotifier } from "../adapters/driven/notification/SlackNotifier.ts";
import { TeamsNotifier } from "../adapters/driven/notification/TeamsNotifier.ts";
import { FakePaymentGateway } from "../adapters/driven/payment/FakePaymentGateway.ts";
import { StripePaymentGateway } from "../adapters/driven/payment/StripePaymentGateway.ts";
import { InMemoryOrderRepository } from "../adapters/driven/persistence/InMemoryOrderRepository.ts";
import { JsonFileOrderRepository } from "../adapters/driven/persistence/JsonFileOrderRepository.ts";
import { SystemClock, UuidGenerator } from "../adapters/driven/system/SystemClock.ts";
import type { DevTracer } from "../adapters/shared/devTracing.ts";

/** What the driving adapters receive: input ports only, never concrete services. */
export interface App {
  placeOrder: PlaceOrder;
  getOrders: GetOrders;
  listProducts: ListProducts;
  /** Output port name → the concrete adapter plugged into it (shown in the web UI). */
  adapters: Readonly<Record<string, string>>;
  description: string;
}

export interface BuildOptions {
  /** DEVELOPMENT ONLY: wrap every port so its calls are recorded per request. */
  tracer?: DevTracer;
}

type Env = Record<string, string | undefined>;

export function buildApp(env: Env, options: BuildOptions = {}): App {
  // 1. Choose the driven adapters (implementations of the output ports).
  const orders = pickRepository(env);
  const payments = pickPayments(env);
  const notifier = pickNotifier(env);
  const catalog = new InMemoryProductCatalog();
  const ids = new UuidGenerator();
  const clock = new SystemClock();

  const adapters = {
    OrderRepository: orders.constructor.name,
    PaymentGateway: payments.constructor.name,
    ProductCatalog: catalog.constructor.name,
    Notifier: notifier.constructor.name,
    Clock: clock.constructor.name,
    IdGenerator: ids.constructor.name,
  };

  // In development, decorate each port with a tracing proxy. The services
  // can't tell the difference: they still only see the port interfaces.
  const { tracer } = options;
  const port = <T extends object>(implementation: T, portName: string): T =>
    tracer ? tracer.wrap(implementation, portName) : implementation;
  const tracedOrders = port(orders, "OrderRepository");
  const tracedCatalog = port(catalog, "ProductCatalog");

  // 2. Inject them into the application services through their constructors.
  const placeOrder = new PlaceOrderService({
    orders: tracedOrders,
    payments: port(payments, "PaymentGateway"),
    catalog: tracedCatalog,
    notifier: port(notifier, "Notifier"),
    ids: port(ids, "IdGenerator"),
    clock: port(clock, "Clock"),
  });
  const getOrders = new GetOrdersService(tracedOrders);
  const listProducts = new ListProductsService(tracedCatalog);

  // 3. Hand back the input ports for the driving adapters (HTTP, web UI, CLI).
  return {
    placeOrder: port(placeOrder, "PlaceOrder"),
    getOrders: port(getOrders, "GetOrders"),
    listProducts: port(listProducts, "ListProducts"),
    adapters,
    description: Object.entries(adapters)
      .map(([portName, adapter]) => `${portName}=${adapter}`)
      .join("  "),
  };
}

function pickRepository(env: Env): OrderRepository {
  switch (env.STORAGE ?? "memory") {
    case "memory":
      return new InMemoryOrderRepository();
    case "file":
      return new JsonFileOrderRepository(env.DATA_FILE ?? "data/orders.json");
    default:
      throw new Error(`Unknown STORAGE "${env.STORAGE}" (use memory | file)`);
  }
}

function pickPayments(env: Env): PaymentGateway {
  switch (env.PAYMENTS ?? "fake") {
    case "fake":
      return new FakePaymentGateway();
    case "stripe-test":
      return new StripePaymentGateway({ apiKey: required(env, "STRIPE_SECRET_KEY") });
    default:
      throw new Error(`Unknown PAYMENTS "${env.PAYMENTS}" (use fake | stripe-test)`);
  }
}

function pickNotifier(env: Env): Notifier {
  switch (env.NOTIFIER ?? "console") {
    case "console":
      return new ConsoleNotifier();
    case "slack":
      return new SlackNotifier({ webhookUrl: required(env, "SLACK_WEBHOOK_URL") });
    case "teams":
      return new TeamsNotifier({ webhookUrl: required(env, "TEAMS_WEBHOOK_URL") });
    default:
      throw new Error(`Unknown NOTIFIER "${env.NOTIFIER}" (use console | slack | teams)`);
  }
}

function required(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing environment variable ${key}`);
  return value;
}
