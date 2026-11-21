# Hexagonal Architecture: an order-processing example you can see

A small order and payment app built with **Hexagonal Architecture** (also called *Ports & Adapters*), with a web UI
and an interactive **Architecture Explorer** that shows which components really ran for each request.
No runtime dependencies: Node 24+ runs the TypeScript directly, with no build step.

```bash
npm install         # dev tools only: typescript, @types/node
npm start           # then open http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm start` | Web UI + JSON API + Architecture Explorer on http://localhost:3000 |
| `npm run cli -- products` | Same core from the terminal (also `place`, `get`, `list`) |
| `npm run cli -- place alice BOOK:2 PEN:3 --key checkout-1` | Place an order from the CLI |
| `npm run typecheck` | `tsc` |
| `npm test` | Checks the app works, including the dependency rule |

> ⚠ **This is a learning project, not a production payment system.** The default payment adapter is fake,
> the Stripe adapter is test-mode only, and the JSON-file storage is a demo. See
> [What is deliberately left out](#9-what-is-deliberately-left-out).

---

## 1. Using the web UI

Open **http://localhost:3000**. There are two tabs.

**Shop**
- **Catalog** comes from `GET /products`, which runs `ListProducts`, which runs `InMemoryProductCatalog`. The page doesn't keep a price list.
- **Your order** sends `POST /orders` with an `Idempotency-Key` that the browser generates once per checkout attempt.
  - The cart total is only an *estimate*. The server re-prices every item and applies the rules.
  - Customer `timeout` simulates a lost payment connection. Press **Place order** again, or **Retry**, and the same key is reused, so the server finishes the *same* order instead of creating a second one.
  - A quantity of 0, an empty cart, or a blank customer id shows a domain rule rejecting the order.
- **Order history** comes from `GET /orders`; **Details** comes from `GET /orders/:id`. A PENDING order placed from this browser has a **Retry payment** button.
- Every result has **"Watch this request in the Architecture Explorer"**.

**Architecture Explorer**
- **The map:** every box is a real file.
  - The layers run left to right: driving adapters, input ports, application services, domain, output ports, driven adapters, with the composition root underneath.
  - A dashed border marked «interface» is a port; a solid border is concrete code.
  - A green dot means the adapter is plugged in right now, according to `buildApp()`.
- **Click a box** to see:
  1. what it does;
  2. its layer;
  3. why it belongs there;
  4. its file;
  5. its methods;
  6. what it depends on;
  7. what depends on it;
  8. what would break if it violated the dependency rule.

  You also get **excerpts of the real code**, read live from `src/`.
- **Runtime flow vs Source-code dependencies:**
  - Runtime flow shows who calls whom.
  - Source-code dependencies shows the real `import` graph, read from your files.
  - Compare the right-hand side in each mode: that reversal is dependency inversion.
- **Demo scenarios** send real requests: successful payment, declined payment (TV is over $500), unknown outcome plus retry (`timeout`), invalid order (quantity 0), unknown product, and a repeated request (idempotency).
- **Timeline:** after each request, the components light up in the order they **actually ran**.
  - `recorded`: a real port call captured on the server.
  - `inferred`: a domain step proven by recorded data. For example, the order passed to `OrderRepository.save()` has status PENDING, so `createOrder()` ran.
  - `browser`: measured in the page.
  - `conceptual`: the textbook flow. It's only shown when you ask for it, and it's clearly marked.

### How the tracing works (and why it doesn't pollute the core)

[`DevTracer`](src/adapters/shared/devTracing.ts) is a development-only decorator:

1. `buildApp()` wraps each port implementation in a `Proxy` that records `{port, implementation, method, args, result}`
   and then forwards the call unchanged.
2. The HTTP adapter starts a trace only when a request carries `X-Dev-Trace: 1`. `AsyncLocalStorage` links every
   recorded call to that request, so no trace id travels through the core.
3. The browser fetches the trace from `GET /dev/traces/:id`.

The domain and application code don't know any of this exists. Only port arguments are recorded, and secrets such as
API keys and webhook URLs are constructor configuration, which never passes through a port.
Turn it off with `DEV_TOOLS=off npm start`; it's always off with `NODE_ENV=production`.

---

## 2. The big idea

> **Business rules must not depend on frameworks, databases, UIs or external APIs.
> Those things depend on the business rules.**

```
   DRIVING ADAPTERS                    APPLICATION CORE                         DRIVEN ADAPTERS
   (they call the core)                                                         (the core calls them)

 ┌──────────────┐  HTTP   ┌──────────────────────────────────────────┐        ┌───────────────────────────┐
 │ Web UI       │────────▶│  INPUT PORTS        PlaceOrder           │        │ InMemoryProductCatalog    │
 │ (browser)    │         │  (interfaces)       GetOrders            │   ┌───▶├───────────────────────────┤
 └──────────────┘         │                     ListProducts         │   │    │ InMemoryOrderRepository   │
 ┌──────────────┐         │        ▲ implemented by                  │   ├───▶│ JsonFileOrderRepository   │
 │ HTTP adapter │──calls─▶│  SERVICES           PlaceOrderService    │   │    ├───────────────────────────┤
 └──────────────┘         │  (use cases)        GetOrdersService     │   ├───▶│ FakePaymentGateway        │
 ┌──────────────┐         │                     ListProductsService  │   │    │ StripePaymentGateway      │
 │ CLI          │──calls─▶│        │ uses                            │   │    ├───────────────────────────┤
 └──────────────┘         │        ▼                                 │   ├───▶│ Console/Slack/Teams       │
                          │  DOMAIN             Order, Product,      │   │    │   Notifier                │
                          │  (rules)            DomainError          │   │    ├───────────────────────────┤
                          │                                          │   └───▶│ SystemClock, UuidGenerator│
                          │  OUTPUT PORTS       ProductCatalog       │───┘    └───────────────────────────┘
                          │  (interfaces)       OrderRepository                ▲ each one `implements`
                          │                     PaymentGateway       │◀────────┘   an output port
                          │                     Notifier, Clock, Ids │
                          └──────────────────────────────────────────┘
                                         ▲
                   COMPOSITION ROOT ─────┘  src/composition/container.ts: buildApp()
                   creates the adapters and injects them into the services

   SOURCE-CODE DEPENDENCIES (imports) ALWAYS POINT INTO THE CORE:
     driving adapter ──imports──▶ input port        driven adapter ──imports──▶ output port
```

## 3. Directory structure

```
src/
├── domain/                          THE BUSINESS RULES: imports nothing outside domain/
│   ├── Order.ts                     Order entity, statuses, createOrder / markPaid / markPaymentFailed
│   ├── Product.ts                   a product that can be ordered (plain data)
│   └── errors.ts                    DomainError ("a business rule was broken")
│
├── application/                     USE CASES + PORTS: imports only domain/ and application/
│   ├── ports/in/                    what the app OFFERS: PlaceOrder, GetOrders, ListProducts
│   ├── ports/out/                   what the app NEEDS: OrderRepository, PaymentGateway, ProductCatalog,
│   │                                Notifier, System (Clock, IdGenerator)
│   ├── services/                    PlaceOrderService, GetOrdersService, ListProductsService
│   └── errors.ts                    OrderNotFoundError, IdempotencyConflictError
│
├── adapters/
│   ├── driving/                     translate the outside world INTO input-port calls
│   │   ├── http/httpServer.ts       JSON API; also serves the web UI and (dev) /dev routes
│   │   ├── cli/cli.ts
│   │   └── web/
│   │       ├── staticFiles.ts       serves public/
│   │       ├── devRoutes.ts         DEV ONLY: /dev/config, /dev/traces/:id, /dev/imports, /dev/source
│   │       └── public/              the browser UI: index.html, styles.css, js/
│   │           └── js/              api.js (HTTP client), shop.js, explorer.js, trace.js,
│   │                                components.js (Explorer descriptions), dom.js, main.js
│   ├── driven/                      implement output ports with real technology
│   │   ├── persistence/   InMemoryOrderRepository.ts, JsonFileOrderRepository.ts
│   │   ├── payment/       FakePaymentGateway.ts, StripePaymentGateway.ts (test mode only)
│   │   ├── catalog/       InMemoryProductCatalog.ts
│   │   ├── notification/  ConsoleNotifier.ts, SlackNotifier.ts, TeamsNotifier.ts
│   │   └── system/        SystemClock.ts (SystemClock, UuidGenerator)
│   └── shared/                      used by several adapters, never by the core
│       ├── formatMoney.ts           cents → "$30.00"
│       └── devTracing.ts            DEV ONLY: DevTracer (Proxy + AsyncLocalStorage)
│
├── composition/container.ts         COMPOSITION ROOT: buildApp(), the only file that knows every concrete class
├── main-http.ts                     entry point: buildApp() + HTTP adapter (+ dev tools unless disabled)
└── main-cli.ts                      entry point: buildApp() + CLI adapter

test/   domain/  application/  adapters/  architecture.test.ts  fakes.ts
```

**Dependency rule** (enforced by [test/architecture.test.ts](test/architecture.test.ts)):

| Layer | May import |
|---|---|
| `domain` | `domain` only. No `node:` modules, no npm packages. |
| `application` | `domain`, `application`. No `node:` modules, no npm packages. |
| `adapters/driving` | `domain`, `application`, `adapters/driving`, `adapters/shared`, Node/npm |
| `adapters/driven` | `domain`, `application`, `adapters/driven`, `adapters/shared`, Node/npm |
| `adapters/shared` | `adapters/shared`, Node/npm |
| `composition`, `main-*` | everything (this is where the wiring happens) |

The browser code in `web/public/` imports nothing from `src/`; it only uses HTTP.

---

## 4. Follow one request through the hexagon

You click **Place order** with 2 × BOOK.

| # | Where | What happens |
|---|---|---|
| 1 | **Web UI** [api.js](src/adapters/driving/web/public/js/api.js) | `POST /orders` with `{customerId, items:[{sku, quantity}]}` and an `Idempotency-Key` header. No price is sent. |
| 2 | **Driving adapter** [httpServer.ts](src/adapters/driving/http/httpServer.ts) | Reads the body (max 1 MB), checks its *shape*, and builds a `PlaceOrderCommand`. |
| 3 | **Input port** [PlaceOrder.ts](src/application/ports/in/PlaceOrder.ts) | Calls `placeOrder.execute(command)`. The adapter only knows the interface. |
| 4 | **Application service** [PlaceOrderService.ts](src/application/services/PlaceOrderService.ts) | Calls `OrderRepository.findByIdempotencyKey()`. If the key is known, returns that order (or retries its payment if it's PENDING). |
| 5 | **Output port** `ProductCatalog.priceOf()` → `InMemoryProductCatalog` | Prices each item on the server. An unknown SKU throws a `DomainError`. |
| 6 | **Output ports** `IdGenerator.next()`, `Clock.now()` | A new id and timestamp. |
| 7 | **Domain** [Order.ts](src/domain/Order.ts) `createOrder()` | Applies the rules and returns a PENDING order. An invalid order stops here, with nothing saved or charged. |
| 8 | **Output port** `OrderRepository.save()` → `InMemoryOrderRepository` | Saves as PENDING **before** any money moves. |
| 9 | **Output port** `PaymentGateway.charge()` → `FakePaymentGateway` | Answers `succeeded`, `declined` or `unknown`. |
| 10 | **Domain** `markPaid()` / `markPaymentFailed()` | Changes the status. If the outcome is `unknown`, the order stays PENDING. |
| 11 | **Output ports** `OrderRepository.save()`, `Notifier.orderPlaced()` → `ConsoleNotifier` | Saves the final state, then notifies (best-effort). |
| 12 | **HTTP adapter** | Maps the `Order` to a JSON DTO: **201** if final, **202** if PENDING. `DomainError` → 400, `OrderNotFoundError` → 404, `IdempotencyConflictError` → 422. |
| 13 | **Web UI** | Shows the status and the recorded path, then plays it in the Explorer. |

At **runtime**, calls flow outward: PlaceOrderService → PaymentGateway → FakePaymentGateway.
In the **source code**, imports point inward: `FakePaymentGateway.ts` imports `PaymentGateway.ts`, and
`PlaceOrderService.ts` imports only `PaymentGateway.ts`. That reversal is **dependency inversion**. The Explorer shows
both views side by side.

---

## 5. Ports and adapters

### Input ports (driving side): what the application offers

| Port | Implemented by | Called by | HTTP route |
|---|---|---|---|
| `PlaceOrder.execute(command)` | `PlaceOrderService` | HTTP, CLI | `POST /orders` |
| `GetOrders.byId(id)` / `.list()` | `GetOrdersService` | HTTP, CLI | `GET /orders/:id`, `GET /orders` |
| `ListProducts.list()` | `ListProductsService` | HTTP, CLI | `GET /products` |

### Output ports (driven side): what the application needs

| Port | Why it exists | Adapters |
|---|---|---|
| `OrderRepository` | the core needs to store orders and find them by id or idempotency key | `InMemoryOrderRepository`, `JsonFileOrderRepository` (demo) |
| `PaymentGateway` | the core needs money taken; answers `succeeded` / `declined` / `unknown` | `FakePaymentGateway`, `StripePaymentGateway` (test mode) |
| `ProductCatalog` | prices must come from the server | `InMemoryProductCatalog` |
| `Notifier` | announce a completed order | `ConsoleNotifier`, `SlackNotifier`, `TeamsNotifier` |
| `Clock`, `IdGenerator` | keep time and randomness out of the core | `SystemClock`, `UuidGenerator` |

### Swapping adapters (no code changes)

```bash
STORAGE=file npm start                                    # memory → JSON file (data/orders.json)
PAYMENTS=stripe-test STRIPE_SECRET_KEY=sk_test_... npm start
NOTIFIER=slack SLACK_WEBHOOK_URL=https://hooks.slack.com/... npm start
NOTIFIER=teams TEAMS_WEBHOOK_URL=https://... npm start
DEV_TOOLS=off npm start                                   # no tracing, no /dev routes
```

Watch the green "plugged in" dot move in the Explorer, and run a scenario: the recorded path goes through the new adapter.

### Fake gateway behaviour (for the demos)

| Input | Result |
|---|---|
| Total over $500 (e.g. TV) | `declined` → PAYMENT_FAILED |
| Customer `timeout`, first attempt for an order | `unknown` → PENDING (HTTP 202) |
| Customer `timeout`, retry of the **same order** (same Idempotency-Key) | `succeeded`, like a real provider replaying an idempotent request |
| Anything else | `succeeded` → PAID |

### API examples (curl)

```bash
curl localhost:3000/products
curl -X POST localhost:3000/orders -H 'Idempotency-Key: k1' -d '{"customerId":"alice","items":[{"sku":"BOOK","quantity":2}]}'   # 201 PAID
curl -X POST localhost:3000/orders -d '{"customerId":"bob","items":[{"sku":"TV","quantity":1}]}'                               # 201 PAYMENT_FAILED
curl -X POST localhost:3000/orders -H 'Idempotency-Key: t1' -d '{"customerId":"timeout","items":[{"sku":"PEN","quantity":1}]}' # 202 PENDING (repeat → PAID)
curl -X POST localhost:3000/orders -d '{"customerId":"carol","items":[]}'                                                      # 400 domain rule
curl localhost:3000/orders
```

---

## 6. Dependency injection: how the pieces get connected

Every service receives its collaborators **through its constructor**, typed as **interfaces**:

```ts
// application/services/PlaceOrderService.ts: knows only interfaces
constructor(deps: { orders: OrderRepository; payments: PaymentGateway; catalog: ProductCatalog;
                    notifier: Notifier; ids: IdGenerator; clock: Clock })
```

Only [container.ts](src/composition/container.ts) uses `new` on adapters:

```ts
const orders = pickRepository(env);        // InMemoryOrderRepository or JsonFileOrderRepository
const payments = pickPayments(env);        // FakePaymentGateway or StripePaymentGateway
...
const placeOrder = new PlaceOrderService({ orders, payments, catalog, notifier, ids, clock });
return { placeOrder, getOrders, listProducts, adapters };   // input ports, not services
```

In development, `buildApp()` wraps each of these in the tracing proxy before injecting it. The services can't tell
the difference, because they only see the interfaces.

- **Dependency injection** is the *technique*: objects are handed their dependencies instead of creating them.
- **Dependency inversion** is the *principle*: the core owns the interfaces (`application/ports/out`), and
  infrastructure implements them.

No DI framework, no decorators: a few dozen lines of plain wiring.

---

## 7. Replacing the fake payment gateway

1. Write `src/adapters/driven/payment/MyProviderGateway.ts`:
   ```ts
   export class MyProviderGateway implements PaymentGateway {
     constructor(options: { apiKey: string }) { ... }
     async charge(request: ChargeRequest): Promise<ChargeResult> {
       // call the provider, using request.orderId as its idempotency key
       // definite refusal         → { status: "declined", reason }
       // timeout / 5xx / unclear  → { status: "unknown", reason }   (never "declined")
       // success                  → { status: "succeeded", paymentId }
     }
   }
   ```
2. Add `case "myprovider": return new MyProviderGateway({ apiKey: required(env, "MYPROVIDER_KEY") });` to `pickPayments()`.
3. Run `PAYMENTS=myprovider MYPROVIDER_KEY=... npm start`.

`PlaceOrderService`, `Order.ts`, the HTTP adapter and the UI don't change. [StripePaymentGateway.ts](src/adapters/driven/payment/StripePaymentGateway.ts)
is a worked example of steps 1 and 2.

## 8. Replacing the repository with PostgreSQL

Neither the domain nor the application changes. You add **one adapter** and **one `case`** in the composition root.

**1. Install the driver:** `npm i pg && npm i -D @types/pg`

**2. Create the table:**

```sql
CREATE TABLE orders (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,         -- the database now enforces "one order per key", even under concurrency
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**3. Write the adapter** `src/adapters/driven/persistence/PostgresOrderRepository.ts`:

```ts
import pg from "pg";
import type { OrderRepository } from "../../../application/ports/out/OrderRepository.ts";
import type { Order } from "../../../domain/Order.ts";

export class PostgresOrderRepository implements OrderRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async save(order: Order, idempotencyKey?: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO orders (id, idempotency_key, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [order.id, idempotencyKey ?? null, order],
    );
  }

  async findById(orderId: string): Promise<Order | undefined> {
    const { rows } = await this.#pool.query("SELECT data FROM orders WHERE id = $1", [orderId]);
    return rows[0]?.data;
  }

  async findByIdempotencyKey(key: string): Promise<Order | undefined> {
    const { rows } = await this.#pool.query("SELECT data FROM orders WHERE idempotency_key = $1", [key]);
    return rows[0]?.data;
  }

  async findAll(): Promise<Order[]> {
    const { rows } = await this.#pool.query("SELECT data FROM orders ORDER BY created_at");
    return rows.map((r) => r.data);
  }
}
```

**4. Register it** in `pickRepository()` in [container.ts](src/composition/container.ts):

```ts
case "postgres":
  return new PostgresOrderRepository(new pg.Pool({ connectionString: required(env, "DATABASE_URL") }));
```

**5. Run it:**

```bash
docker run -d -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres
STORAGE=postgres DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres npm start
```

`PlaceOrderService`, `GetOrdersService`, `Order.ts` and every driving adapter stay untouched, and the architecture test
still passes. To see it in the Explorer, add a `PostgresOrderRepository` entry to
[components.js](src/adapters/driving/web/public/js/components.js) (the green dot and the recorded path follow `buildApp()` automatically).

---

## 9. What is deliberately left out

| Real-world concern | Why it's not here | Where it would go |
|---|---|---|
| Real card collection (Stripe Elements/Checkout, 3-D Secure, webhooks) | Needs a frontend payment flow and a webhook endpoint | A `createPayment` / `getPaymentStatus` port + a webhook *driving* adapter |
| Reconciling PENDING orders automatically | Needs a scheduler | A `ReconcilePendingOrders` use case run by a cron *driving* adapter |
| Concurrent requests with the same idempotency key | In-memory/file storage has no unique constraints | The Postgres `UNIQUE (idempotency_key)` above |
| Multi-process storage | The JSON file is single-process only | A real database |
| Guaranteed notifications | Needs a queue | The transactional outbox pattern |
| Authentication; `customerId` comes from the body | Out of scope | A driving-adapter concern (verify a token, pass the user id into the command) |
| Production observability | DevTracer is a teaching tool, kept in memory | OpenTelemetry, applied the same way: a decorator at the composition root |
| Currencies other than USD | Out of scope | A `Money` value object in the domain |
