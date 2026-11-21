// The components of THIS project, as shown by the Architecture Explorer.
//
// What is hand-written here: explanations, and which column each component sits in.
// What is NOT hand-written: the source-code arrows (read live from your imports via
// /dev/imports), the code excerpts (read live from your files via /dev/source, found
// by the `find` text below), and the recorded request flow (from /dev/traces).

export const LAYERS = {
  driving: {
    label: "Driving adapter",
    text: "Left side of the hexagon. Driving adapters START the work: they turn something from the outside world (a click, an HTTP request, a terminal command) into a call on an input port, then turn the result back into something the outside world understands.",
  },
  "in-port": {
    label: "Input port",
    text: "An interface in application/ports/in. It describes what the application OFFERS, in the application's own language. Driving adapters depend on it, and an application service implements it.",
  },
  service: {
    label: "Application service",
    text: "A class in application/services. It implements an input port and orchestrates: it decides the ORDER of steps, calls domain functions for the rules, and calls output ports for anything outside the core.",
  },
  domain: {
    label: "Domain",
    text: "The innermost layer (src/domain). Business concepts and rules as plain TypeScript. It imports nothing outside src/domain: no Node.js, no npm, no application code.",
  },
  "out-port": {
    label: "Output port",
    text: "An interface in application/ports/out. It describes what the application NEEDS from the outside world, shaped by the core's needs, not by any vendor. Services depend on it; driven adapters implement it.",
  },
  driven: {
    label: "Driven adapter",
    text: "Right side of the hexagon. Driven adapters are called BY the core (through output ports) and do the technical work: store data, take payments, send messages, read the clock.",
  },
  composition: {
    label: "Composition root",
    text: "Outside the hexagon. The only code allowed to know every concrete class. It creates the adapters, injects them into the services, and hands the input ports to the driving adapters.",
  },
};

const ADAPTER_RULE =
  "Adapters may import the core (domain + application) and Node/npm packages, but never adapters from the other side and never the composition root.";

export const COMPONENTS = {
  // ── Driving adapters ────────────────────────────────────────────────────
  webUi: {
    title: "Web UI",
    kind: "browser",
    layer: "driving",
    file: "src/adapters/driving/web/public/js/shop.js",
    alsoFiles: ["src/adapters/driving/web/public/js/api.js", "src/adapters/driving/web/public/index.html"],
    what: "The page you are using. It turns clicks into HTTP requests (GET /products, POST /orders, GET /orders, GET /orders/:id) and renders the JSON that comes back. It generates an Idempotency-Key per checkout attempt and reuses it when you retry.",
    why: "It's another way INTO the application, like the CLI. It runs in the browser and talks to the HTTP adapter over the network; it never imports core code. It shows prices it receives from /products and statuses it receives from /orders, but it decides none of them.",
    members: ["api.request(method, path, options) (js/api.js)", "api.placeOrder(body, idempotencyKey)", "shop.js: catalog, cart, order history, retry"],
    violation:
      "If the page enforced the $10,000 limit or calculated the final price itself, the rules would exist twice and drift apart, and the CLI wouldn't get them. Here the cart total is labelled an estimate, and the server re-prices every item.",
    excerpts: [{ file: "src/adapters/driving/web/public/js/api.js", find: "export async function request", lines: 22, caption: "Every request goes through this fetch wrapper" }],
  },
  httpServer: {
    title: "HTTP adapter",
    kind: "module",
    layer: "driving",
    file: "src/adapters/driving/http/httpServer.ts",
    alsoFiles: ["src/adapters/driving/web/staticFiles.ts", "src/adapters/driving/web/devRoutes.ts"],
    what: "Translates HTTP into input-port calls, and core results and errors back into status codes and JSON. It also serves the web UI's files and, in development, the /dev routes the Explorer uses.",
    why: "It's infrastructure that drives the application. It depends only on the input-port interfaces (PlaceOrder, GetOrders, ListProducts) handed to it in HttpDeps. It never sees PlaceOrderService or any repository.",
    members: [
      "createHttpServer(deps: HttpDeps): Server",
      "route(): POST /orders, GET /orders, GET /orders/:id, GET /products",
      "toPlaceOrderCommand(): checks the SHAPE only",
      "errorResult(): DomainError→400, OrderNotFoundError→404, IdempotencyConflictError→422",
    ],
    violation:
      "If it imported PlaceOrderService or InMemoryOrderRepository directly, you couldn't swap implementations or run it with different adapters. If it checked business rules, the CLI would bypass them. " + ADAPTER_RULE,
    excerpts: [
      { find: "export interface HttpDeps", lines: 10, caption: "It receives input ports, not services" },
      { find: 'if (req.method === "POST" && url.pathname === "/orders") {', lines: 6, caption: "HTTP → PlaceOrder → HTTP" },
      { find: "function errorResult", lines: 8, caption: "Core errors become status codes HERE, never in the core" },
    ],
  },
  cli: {
    title: "CLI adapter",
    kind: "module",
    layer: "driving",
    file: "src/adapters/driving/cli/cli.ts",
    what: "The same use cases from a terminal: place, get, list, products. It maps the same core errors to exit codes instead of HTTP status codes.",
    why: "A second driving adapter is the proof that the core doesn't depend on HTTP. Both adapters call the same PlaceOrder port, so the rules are identical whichever door you use.",
    members: ["runCli(args, deps, out): Promise<exit code>", "parseItem(\"SKU:quantity\")", "exit codes: 0 paid, 1 rejected/failed, 2 pending"],
    violation: "If the CLI needed its own copy of the ordering logic, you would have two applications instead of two adapters. " + ADAPTER_RULE,
    excerpts: [{ find: 'case "place": {', lines: 8 }],
  },

  // ── Input ports ─────────────────────────────────────────────────────────
  PlaceOrder: {
    title: "PlaceOrder",
    kind: "interface",
    layer: "in-port",
    file: "src/application/ports/in/PlaceOrder.ts",
    what: "The contract for placing an order: execute(command) resolves with an Order. The command carries customerId, items (sku + quantity, deliberately with NO price), and an optional idempotencyKey.",
    why: "It lives in the core and uses the core's words (Order, command), so any driving adapter can call it without knowing who implements it. PlaceOrderService implements it.",
    members: ["execute(command: PlaceOrderCommand): Promise<Order>", "PlaceOrderCommand { customerId, items, idempotencyKey? }", "RequestedItem { sku, quantity }"],
    violation:
      "If this interface mentioned HTTP (req, res, status codes), the CLI and any test would have to fake HTTP just to place an order. If it accepted prices, every client could set its own price.",
    excerpts: [
      { find: "export interface PlaceOrderCommand", lines: 11 },
      { find: "export interface PlaceOrder {", lines: 8 },
    ],
  },
  GetOrders: {
    title: "GetOrders",
    kind: "interface",
    layer: "in-port",
    file: "src/application/ports/in/GetOrders.ts",
    what: "The contract for reading orders: byId(id) and list(). Used by the order history and order details in the web UI, and by `cli get` and `cli list`.",
    why: "Reading is a use case too. Driving adapters call this interface; GetOrdersService implements it.",
    members: ["byId(orderId): Promise<Order> (throws OrderNotFoundError)", "list(): Promise<Order[]>"],
    violation: "If the HTTP adapter read the repository directly instead, it would depend on a driven-side interface and bypass the application layer (and any rule added there later, like access checks).",
    excerpts: [{ find: "export interface GetOrders", lines: 5 }],
  },
  ListProducts: {
    title: "ListProducts",
    kind: "interface",
    layer: "in-port",
    file: "src/application/ports/in/ListProducts.ts",
    what: "A read-only use case: list(). It's how the web UI shows the catalog and its prices without keeping its own copy.",
    why: "It was added for the UI. Without it, the frontend would have to hard-code products and prices, which would duplicate the catalog.",
    members: ["list(): Promise<Product[]>"],
    violation: "If the UI hard-coded prices instead, changing a price in InMemoryProductCatalog would leave the page showing the old one, while the server charged the new one.",
    excerpts: [{ find: "export interface ListProducts", lines: 3 }],
  },

  // ── Application services ────────────────────────────────────────────────
  PlaceOrderService: {
    title: "PlaceOrderService",
    kind: "class",
    layer: "service",
    file: "src/application/services/PlaceOrderService.ts",
    what: "Runs the place-order workflow: idempotency check → price each item via ProductCatalog → createOrder() → save PENDING → charge via PaymentGateway → markPaid()/markPaymentFailed() → save → notify. If the payment outcome is unknown, it leaves the order PENDING.",
    why: "Sequencing (for example 'save BEFORE charging') is application policy: not a business rule of the Order itself, and not infrastructure. It depends only on interfaces, which it receives through its constructor (PlaceOrderDeps).",
    members: ["constructor(deps: PlaceOrderDeps)", "execute(command)", "#priceItems(items)", "#collectPayment(order)", "#notify(order): best-effort"],
    violation:
      "If it did `new FakePaymentGateway()` or imported node:fs, switching to Stripe or Postgres would mean editing the use case, and test/architecture.test.ts would fail the build.",
    excerpts: [
      { find: "export interface PlaceOrderDeps", lines: 8, caption: "Everything it needs is an interface" },
      { find: "// 4. Save BEFORE charging", lines: 8 },
      { find: "async #collectPayment", lines: 20 },
    ],
  },
  GetOrdersService: {
    title: "GetOrdersService",
    kind: "class",
    layer: "service",
    file: "src/application/services/GetOrdersService.ts",
    what: "Implements GetOrders by asking the OrderRepository port. It turns 'not found' into an OrderNotFoundError.",
    why: "A use case that orchestrates a port call. Small on purpose: there are no rules to apply when reading.",
    members: ["constructor(orders: OrderRepository)", "byId(orderId)", "list()"],
    violation: "If it imported InMemoryOrderRepository, it would only ever read from memory, and the STORAGE=file switch would stop working for reads.",
    excerpts: [{ find: "export class GetOrdersService", lines: 17 }],
  },
  ListProductsService: {
    title: "ListProductsService",
    kind: "class",
    layer: "service",
    file: "src/application/services/ListProductsService.ts",
    what: "Implements ListProducts by asking the ProductCatalog port.",
    why: "It keeps clients (the HTTP adapter) away from the catalog adapter, so the catalog can become a database table later without touching the HTTP adapter.",
    members: ["constructor(catalog: ProductCatalog)", "list()"],
    violation: "If the HTTP adapter imported InMemoryProductCatalog to list products, replacing the catalog would mean editing a driving adapter.",
    excerpts: [{ find: "export class ListProductsService", lines: 12 }],
  },
  ApplicationErrors: {
    title: "Application errors",
    kind: "class",
    layer: "service",
    file: "src/application/errors.ts",
    what: "OrderNotFoundError and IdempotencyConflictError: things that go wrong while running a use case that are not business rules.",
    why: "'Order not found' is about a lookup, not about what makes an order valid, so it sits in the application layer instead of the domain.",
    members: ["OrderNotFoundError(orderId) → HTTP 404 / exit 1", "IdempotencyConflictError(key) → HTTP 422 / exit 1"],
    violation: "If these errors carried HTTP status codes, the core would know about HTTP and the CLI would have to translate HTTP codes back into exit codes.",
    excerpts: [{ find: "export class OrderNotFoundError", lines: 14 }],
  },

  // ── Domain ──────────────────────────────────────────────────────────────
  Order: {
    title: "Order",
    kind: "entity + rules",
    layer: "domain",
    file: "src/domain/Order.ts",
    what: "The Order entity, its statuses (PENDING, PAID, PAYMENT_FAILED), and its rules: at least one item, positive whole quantities, prices in whole cents, total above $0 and at most $10,000; only a PENDING order can become PAID or PAYMENT_FAILED.",
    why: "These rules would be true whether orders came from a website, a terminal, or a phone call. Plain functions with no I/O, so they can be checked in microseconds.",
    members: ["createOrder({ id, customerId, items, createdAt }): Order", "markPaid(order, paymentId)", "markPaymentFailed(order, reason)", "MAX_ORDER_CENTS = 1_000_000"],
    violation: "If Order.ts imported a database client or node:fs, every rule would need that infrastructure to run, and the rules couldn't be reused by another adapter. The architecture test rejects it.",
    excerpts: [
      { find: "export type OrderStatus", lines: 1 },
      { find: "export function createOrder", lines: 34 },
      { find: "export function markPaid", lines: 7 },
    ],
  },
  Product: {
    title: "Product",
    kind: "type",
    layer: "domain",
    file: "src/domain/Product.ts",
    what: "A product that can be ordered: sku, name, priceCents. Plain data.",
    why: "It's a business concept shared by the catalog port and the ListProducts use case. An Order stores its own price snapshot (OrderItem.unitPriceCents), so later price changes don't rewrite history.",
    members: ["interface Product { sku, name, priceCents }"],
    violation: "If Product were defined inside the catalog adapter, the core would have to import an adapter to talk about products, so the dependency would point outward.",
    excerpts: [{ find: "export interface Product", lines: 5 }],
  },
  DomainError: {
    title: "DomainError",
    kind: "class",
    layer: "domain",
    file: "src/domain/errors.ts",
    what: "Thrown when a business rule is broken (\"An order needs at least one item\"). PlaceOrderService also throws it for an unknown product.",
    why: "It speaks the language of the business. Each driving adapter decides what it means for its channel: HTTP 400 in httpServer.ts, exit code 1 in cli.ts.",
    members: ["class DomainError extends Error"],
    violation: "If the domain threw `{ status: 400 }`, it would know about HTTP and the CLI would be stuck interpreting web status codes.",
    excerpts: [{ find: "export class DomainError", lines: 6 }],
  },

  // ── Output ports ────────────────────────────────────────────────────────
  ProductCatalog: {
    title: "ProductCatalog",
    kind: "interface",
    layer: "out-port",
    file: "src/application/ports/out/ProductCatalog.ts",
    what: "What the core needs to know about products: priceOf(sku) for pricing an order, and list() for showing the catalog.",
    why: "Prices must come from the server, never from the client. The core says what it needs; InMemoryProductCatalog provides it today, and a database table could tomorrow.",
    members: ["priceOf(sku): Promise<number | undefined>", "list(): Promise<Product[]>"],
    violation: "If PlaceOrderService imported DEFAULT_PRODUCTS directly, prices would be baked into the use case, and moving them to a database would mean editing application logic.",
    excerpts: [{ find: "export interface ProductCatalog", lines: 6 }],
  },
  OrderRepository: {
    title: "OrderRepository",
    kind: "interface",
    layer: "out-port",
    file: "src/application/ports/out/OrderRepository.ts",
    what: "What the core needs from storage: save(order, idempotencyKey?), findById, findByIdempotencyKey, findAll.",
    why: "The core says 'I need somewhere to keep orders' and doesn't care whether that's memory, a JSON file, or PostgreSQL. Both PlaceOrderService and GetOrdersService depend on it.",
    members: ["save(order, idempotencyKey?)", "findById(orderId)", "findByIdempotencyKey(key)", "findAll()"],
    violation: "If the methods took SQL strings or returned database rows, the 'interface' would really be one specific database, and every other adapter would have to fake SQL.",
    excerpts: [{ find: "export interface OrderRepository", lines: 10 }],
  },
  PaymentGateway: {
    title: "PaymentGateway",
    kind: "interface",
    layer: "out-port",
    file: "src/application/ports/out/PaymentGateway.ts",
    what: "What the core needs to take money: charge(request) → succeeded | declined | unknown. 'unknown' exists because a timeout is NOT a decline: the card may have been charged.",
    why: "It's an OUTPUT port because the core calls out through it: PlaceOrderService needs payment to happen but must not know about Stripe. PlaceOrderService receives a PaymentGateway in its constructor (PlaceOrderDeps.payments). FakePaymentGateway and StripePaymentGateway each `implements PaymentGateway`, so either can be plugged in.",
    members: ["charge(request: ChargeRequest): Promise<ChargeResult>", "ChargeRequest { orderId, customerId, amountCents }", "ChargeResult: succeeded | declined | unknown"],
    violation:
      "If the port used Stripe's types (PaymentIntent, client_secret), the core would depend on Stripe after all, and the fake gateway would have to imitate Stripe's API. The port speaks the core's language, and each adapter translates.",
    excerpts: [
      { find: "export type ChargeResult", lines: 4, caption: "The port: three outcomes in the core's language" },
      { find: "export interface PaymentGateway", lines: 4 },
      { file: "src/adapters/driven/payment/FakePaymentGateway.ts", find: "export class FakePaymentGateway implements PaymentGateway", lines: 15, caption: "Implementation 1: the fake" },
      { file: "src/adapters/driven/payment/StripePaymentGateway.ts", find: "export class StripePaymentGateway implements PaymentGateway", lines: 1, caption: "Implementation 2: Stripe (test mode)" },
      { file: "src/application/services/PlaceOrderService.ts", find: "const result = await payments.charge({", lines: 5, caption: "The caller only knows the interface" },
    ],
  },
  Notifier: {
    title: "Notifier",
    kind: "interface",
    layer: "out-port",
    file: "src/application/ports/out/Notifier.ts",
    what: "Tells people that an order was completed: orderPlaced(order). Called once the payment outcome is final.",
    why: "It's named after a business event, not 'send a string'. Each adapter formats the message for its own platform (console, Slack markdown, Teams markdown). PlaceOrderService treats it as best-effort.",
    members: ["orderPlaced(order: Order): Promise<void>"],
    violation: "If the port were send(slackBlocks), every notifier would have to understand Slack's format, and the core would be coupled to Slack.",
    excerpts: [{ find: "export interface Notifier", lines: 4 }],
  },
  System: {
    title: "Clock & IdGenerator",
    kind: "interface",
    layer: "out-port",
    file: "src/application/ports/out/System.ts",
    what: "Time and identity: Clock.now() and IdGenerator.next(). They're used when a new order is created.",
    why: "Even time and randomness are 'the outside world'. Behind ports, the core is deterministic: with a fixed clock and sequential ids, the same input always gives the same output.",
    members: ["Clock.now(): Date", "IdGenerator.next(): string"],
    violation: "If PlaceOrderService called new Date() and crypto.randomUUID() itself, it would depend on Node.js directly, and its results would change on every run.",
    excerpts: [{ find: "export interface Clock", lines: 7 }],
  },

  // ── Driven adapters ─────────────────────────────────────────────────────
  InMemoryProductCatalog: {
    title: "InMemoryProductCatalog",
    kind: "class",
    layer: "driven",
    port: "ProductCatalog",
    file: "src/adapters/driven/catalog/InMemoryProductCatalog.ts",
    what: "A fixed product list held in memory: BOOK, PEN, MUG, HEADPHONES, TV. The web UI shows exactly this list (via GET /products).",
    why: "It implements the ProductCatalog output port with the simplest possible technology.",
    members: ["DEFAULT_PRODUCTS", "priceOf(sku)", "list()"],
    violation: ADAPTER_RULE,
    excerpts: [{ find: "export const DEFAULT_PRODUCTS", lines: 7 }],
  },
  InMemoryOrderRepository: {
    title: "InMemoryOrderRepository",
    kind: "class",
    layer: "driven",
    port: "OrderRepository",
    file: "src/adapters/driven/persistence/InMemoryOrderRepository.ts",
    what: "Keeps orders in a Map, plus a second Map from idempotency key to order id. Everything is lost on restart.",
    why: "It implements OrderRepository. It's the default (STORAGE=memory) because it needs no setup.",
    members: ["save(order, key?)", "findById(id)", "findByIdempotencyKey(key)", "findAll()"],
    violation: ADAPTER_RULE,
    excerpts: [{ find: "export class InMemoryOrderRepository", lines: 21 }],
  },
  JsonFileOrderRepository: {
    title: "JsonFileOrderRepository",
    kind: "class",
    layer: "driven",
    port: "OrderRepository",
    file: "src/adapters/driven/persistence/JsonFileOrderRepository.ts",
    what: "Keeps orders in data/orders.json. Writes from one process are queued, and each write goes to a temp file that is then renamed into place. It's demo persistence, not a database: several processes sharing the file can overwrite each other.",
    why: "It implements the same OrderRepository port with a different technology. Start the server with STORAGE=file and nothing in the core changes.",
    members: ["save(order, key?): queued, atomic write", "findById / findByIdempotencyKey / findAll", "#writeAtomically(data)"],
    violation: ADAPTER_RULE,
    excerpts: [
      { find: "save(order: Order, idempotencyKey?: string): Promise<void> {", lines: 12 },
      { find: "async #writeAtomically", lines: 6 },
    ],
  },
  FakePaymentGateway: {
    title: "FakePaymentGateway",
    kind: "class",
    layer: "driven",
    port: "PaymentGateway",
    file: "src/adapters/driven/payment/FakePaymentGateway.ts",
    what: "A pretend provider that moves no money. It declines amounts over $500. For customer \"timeout\" it returns 'unknown' on an order's first attempt, then, on a retry of the same order, reports what the original attempt did, the way a real provider replays an idempotent request.",
    why: "It implements PaymentGateway, so the whole app runs locally with no account, no network, and no money. It's the default (PAYMENTS=fake).",
    members: ["charge(request): Promise<ChargeResult>", "FAKE_DECLINE_ABOVE_CENTS = 50_000", "FAKE_TIMEOUT_CUSTOMER = \"timeout\""],
    violation: ADAPTER_RULE,
    excerpts: [{ find: "export class FakePaymentGateway implements PaymentGateway", lines: 15 }],
  },
  StripePaymentGateway: {
    title: "StripePaymentGateway",
    kind: "class",
    layer: "driven",
    port: "PaymentGateway",
    file: "src/adapters/driven/payment/StripePaymentGateway.ts",
    what: "Calls Stripe's PaymentIntents API in TEST MODE ONLY: it refuses live keys and always uses the test card pm_card_visa. It translates Stripe's answers into succeeded/declined/unknown; network errors, timeouts and 5xx responses become 'unknown', never 'declined'.",
    why: "It implements the same PaymentGateway port. It's the only file in the project that knows Stripe exists. Enable it with PAYMENTS=stripe-test STRIPE_SECRET_KEY=sk_test_...",
    members: ["constructor({ apiKey, fetchFn?, timeoutMs? })", "charge(request): maps HTTP 402 → declined; 409/429/5xx → unknown"],
    violation: ADAPTER_RULE + " Stripe's types must stay inside this file.",
    excerpts: [
      { find: "export class StripePaymentGateway implements PaymentGateway", lines: 1 },
      { find: "if (response.status === 402)", lines: 12, caption: "Translation: Stripe's answers → our three outcomes" },
    ],
  },
  ConsoleNotifier: {
    title: "ConsoleNotifier",
    kind: "class",
    layer: "driven",
    port: "Notifier",
    file: "src/adapters/driven/notification/ConsoleNotifier.ts",
    what: "Prints '[notify] ✅ Order … → PAID' in the terminal running `npm start`. It's the default (NOTIFIER=console).",
    why: "It implements Notifier. Its message formatting (emoji, money format) is a presentation concern, so it lives here.",
    members: ["orderPlaced(order)"],
    violation: ADAPTER_RULE,
    excerpts: [{ find: "export class ConsoleNotifier", lines: 6 }],
  },
  SlackNotifier: {
    title: "SlackNotifier",
    kind: "class",
    layer: "driven",
    port: "Notifier",
    file: "src/adapters/driven/notification/SlackNotifier.ts",
    what: "Posts to a Slack Incoming Webhook (NOTIFIER=slack SLACK_WEBHOOK_URL=…). It uses Slack's *bold* and :emoji: format.",
    why: "It's the same Notifier port with a different platform. The webhook URL is a constructor argument: configuration, never a port argument, so it never appears in a trace.",
    members: ["constructor({ webhookUrl, fetchFn? })", "orderPlaced(order)"],
    violation: ADAPTER_RULE,
    excerpts: [{ find: "async orderPlaced", lines: 12 }],
  },
  TeamsNotifier: {
    title: "TeamsNotifier",
    kind: "class",
    layer: "driven",
    port: "Notifier",
    file: "src/adapters/driven/notification/TeamsNotifier.ts",
    what: "Posts to a Microsoft Teams webhook (NOTIFIER=teams TEAMS_WEBHOOK_URL=…).",
    why: "It's the same Notifier port with a third platform. Swapping Slack for Teams is one environment variable.",
    members: ["constructor({ webhookUrl, fetchFn? })", "orderPlaced(order)"],
    violation: ADAPTER_RULE,
    excerpts: [{ find: "async orderPlaced", lines: 11 }],
  },
  SystemClock: {
    title: "SystemClock & UuidGenerator",
    kind: "class",
    layer: "driven",
    port: "System",
    file: "src/adapters/driven/system/SystemClock.ts",
    what: "The real clock (new Date()) and real ids (a full randomUUID()).",
    why: "They implement Clock and IdGenerator. Only adapters may touch node:crypto and the system time.",
    members: ["SystemClock.now()", "UuidGenerator.next()"],
    violation: ADAPTER_RULE,
    excerpts: [{ find: "export class SystemClock", lines: 14 }],
  },

  // ── Composition ─────────────────────────────────────────────────────────
  buildApp: {
    title: "buildApp()",
    kind: "function",
    layer: "composition",
    file: "src/composition/container.ts",
    what: "Reads STORAGE, PAYMENTS and NOTIFIER, creates one adapter per output port, injects them into PlaceOrderService, GetOrdersService and ListProductsService through their constructors, and returns only the input ports. In development it wraps each port with the tracer.",
    why: "Something has to know the concrete classes, and keeping that knowledge in ONE place is what lets everything else depend on interfaces. That's dependency injection without a framework.",
    members: ["buildApp(env, { tracer? }): App", "pickRepository(env) / pickPayments(env) / pickNotifier(env)", "App { placeOrder, getOrders, listProducts, adapters }"],
    violation: "If the composition root were inside the core (for example PlaceOrderService choosing its own repository), the core would import adapters and the hexagon would collapse.",
    excerpts: [{ find: "export function buildApp", lines: 45 }],
  },
  entryPoints: {
    title: "Entry points",
    kind: "module",
    layer: "composition",
    file: "src/main-http.ts",
    alsoFiles: ["src/main-cli.ts"],
    what: "main-http.ts builds the app and starts the HTTP adapter (which serves this UI). main-cli.ts builds the same app and runs the CLI adapter instead.",
    why: "They're the outermost layer: choose a driving adapter and start it. Dev tools are switched on here (DEV_TOOLS, NODE_ENV).",
    members: ["npm start → main-http.ts", "npm run cli → main-cli.ts"],
    violation: "If an adapter started itself and built its own services, you'd lose the single place where wiring happens.",
    excerpts: [{ find: "const devToolsEnabled", lines: 20 }],
  },
  DevTracer: {
    title: "DevTracer (dev only)",
    kind: "class",
    layer: "composition",
    layerNote:
      "Its file lives in src/adapters/shared because two outer pieces use it: the composition root (to wrap ports) and the HTTP adapter (to start a trace per request). It's development tooling around the hexagon, never inside it.",
    file: "src/adapters/shared/devTracing.ts",
    what: "Records the real port calls of a traced request for this Explorer. buildApp() wraps each port implementation in a Proxy; AsyncLocalStorage links each call to its HTTP request.",
    why: "Tracing is applied from the OUTSIDE, as a decorator at the composition root. The domain and the services don't know it exists, and it's switched off with DEV_TOOLS=off or NODE_ENV=production.",
    members: ["run(label, fn)", "wrap(implementation, portName)", "note(component, detail)", "get(traceId)"],
    violation: "If PlaceOrderService called tracer.record(...) itself, the use case would depend on debugging infrastructure and every test would need a tracer.",
    excerpts: [{ find: "wrap<T extends object>", lines: 12 }],
  },
};

/** Column layout of the diagram. */
export const COLUMNS = {
  driving: ["webUi", "httpServer", "cli"],
  core: [
    { layer: "in-port", title: "Input ports", subtitle: "interfaces the app offers", nodes: ["PlaceOrder", "GetOrders", "ListProducts"] },
    { layer: "service", title: "Application services", subtitle: "use cases", nodes: ["PlaceOrderService", "GetOrdersService", "ListProductsService", "ApplicationErrors"] },
    { layer: "domain", title: "Domain", subtitle: "business rules", nodes: ["Order", "Product", "DomainError"] },
    { layer: "out-port", title: "Output ports", subtitle: "interfaces the app needs", nodes: ["ProductCatalog", "OrderRepository", "PaymentGateway", "Notifier", "System"] },
  ],
  driven: [
    "InMemoryProductCatalog",
    "InMemoryOrderRepository",
    "JsonFileOrderRepository",
    "FakePaymentGateway",
    "StripePaymentGateway",
    "ConsoleNotifier",
    "SlackNotifier",
    "TeamsNotifier",
    "SystemClock",
  ],
  composition: ["entryPoints", "buildApp", "DevTracer"],
};

/** Who calls whom at runtime (a conceptual map; the RECORDED path is highlighted after a request). */
export const RUNTIME_EDGES = [
  ["webUi", "httpServer", "HTTP over the network"],
  ["httpServer", "PlaceOrder"],
  ["httpServer", "GetOrders"],
  ["httpServer", "ListProducts"],
  ["cli", "PlaceOrder"],
  ["cli", "GetOrders"],
  ["cli", "ListProducts"],
  ["PlaceOrder", "PlaceOrderService", "dispatched to the implementation"],
  ["GetOrders", "GetOrdersService", "dispatched to the implementation"],
  ["ListProducts", "ListProductsService", "dispatched to the implementation"],
  ["PlaceOrderService", "Order", "plain function calls inside the core"],
  ["Order", "DomainError", "throws"],
  ["PlaceOrderService", "ProductCatalog"],
  ["PlaceOrderService", "OrderRepository"],
  ["PlaceOrderService", "PaymentGateway"],
  ["PlaceOrderService", "Notifier"],
  ["PlaceOrderService", "System"],
  ["GetOrdersService", "OrderRepository"],
  ["ListProductsService", "ProductCatalog"],
  ["ProductCatalog", "InMemoryProductCatalog"],
  ["OrderRepository", "InMemoryOrderRepository"],
  ["OrderRepository", "JsonFileOrderRepository"],
  ["PaymentGateway", "FakePaymentGateway"],
  ["PaymentGateway", "StripePaymentGateway"],
  ["Notifier", "ConsoleNotifier"],
  ["Notifier", "SlackNotifier"],
  ["Notifier", "TeamsNotifier"],
  ["System", "SystemClock"],
];

/** At startup: the composition root creates and injects (shown only when a composition node is selected). */
export const STARTUP_EDGES = [
  ["entryPoints", "buildApp", "calls"],
  ["entryPoints", "httpServer", "starts"],
  ["entryPoints", "cli", "runs"],
  ["buildApp", "PlaceOrderService", "creates + injects"],
  ["buildApp", "GetOrdersService", "creates + injects"],
  ["buildApp", "ListProductsService", "creates + injects"],
  ["buildApp", "DevTracer", "wraps ports with"],
  ...COLUMNS.driven.map((id) => ["buildApp", id, "may create"]),
];

/** Names that appear in traces → diagram node ids. */
const ALIASES = { Clock: "System", IdGenerator: "System", UuidGenerator: "SystemClock" };

export function nodeIdFor(name) {
  if (!name) return null;
  const id = ALIASES[name] ?? name;
  return COMPONENTS[id] ? id : null;
}

/** Project file → node id, for turning the live import graph into diagram arrows. */
export function fileToNodeMap() {
  const map = new Map();
  for (const [id, c] of Object.entries(COMPONENTS)) {
    for (const file of [c.file, ...(c.alsoFiles ?? [])]) map.set(file, id);
  }
  return map;
}

/** Is this driven adapter plugged in, according to /dev/config? */
export function isActiveAdapter(id, config) {
  if (!config) return null;
  const active = new Set(Object.values(config.adapters ?? {}));
  if (id === "SystemClock") return active.has("SystemClock") || active.has("UuidGenerator");
  return active.has(id);
}
