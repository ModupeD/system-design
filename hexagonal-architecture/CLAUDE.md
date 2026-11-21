# Project: Hexagonal Architecture Practice

## Purpose
A TypeScript order-processing application designed
to demonstrate Hexagonal Architecture (Ports and Adapters).

The primary goal is architectural clarity,
separation of concerns, and dependency inversion.

## Architecture Rules

1. Domain
   - Contains business rules and entities.
   - Must not import infrastructure or frameworks.
   - Must remain independently testable.

2. Application
   - Contains use cases and port interfaces.
   - Orchestrates business operations.
   - Depends on abstractions, not implementations.

3. Driving Adapters
   - HTTP controllers, CLI, and the browser UI.
   - Translate external inputs into use-case calls.
   - Must not contain business logic.

4. Driven Adapters
   - Repositories, payment gateways, notifications.
   - Implement output ports defined by the core.
   - Can be replaced without modifying use cases.

5. Composition Root
   - Creates concrete implementations.
   - Connects adapters to application services.
   - Keeps dependency wiring outside the core.

## Where things live

- `src/domain/`: entities and rules. Imports only `src/domain`.
- `src/application/`: `ports/in`, `ports/out`, `services/`, `errors.ts`. Imports only domain and application.
- `src/adapters/driving/`: `http/` (JSON API), `cli/`, `web/` (browser UI and dev-only routes).
- `src/adapters/driven/`: persistence, payment, catalog, notification, system.
- `src/adapters/shared/`: helpers used by several adapters (`formatMoney`, `devTracing`). Never imported by the core.
- `src/composition/container.ts`: `buildApp()`, the only place that does `new` on adapters.
- `test/architecture.test.ts` enforces these import rules. Keep it passing.

## UI boundary (web frontend)

- The web UI (`src/adapters/driving/web/public/`) is a driving adapter that runs in the browser.
  It talks to the server ONLY over HTTP (`GET /products`, `POST /orders`, `GET /orders`, `GET /orders/:id`)
  and never imports TypeScript from `src/`.
- No business rules in the UI: no price lists, no order limits, no payment rules. Prices and
  statuses come from the API. A cart total may be shown only as a labelled estimate.
- The UI owns the client half of idempotency: one `Idempotency-Key` per checkout attempt,
  reused when retrying that same attempt, and a new key when the order changes.
- New data the UI needs gets a use case and input port first (e.g. `ListProducts`), then an HTTP route.
  Never let an HTTP route read a repository or catalog adapter directly.
- `httpServer.ts` serves the static files and delegates to `web/staticFiles.ts` and `web/devRoutes.ts`.

## Development-only tooling (Architecture Explorer)

- `DevTracer` (`src/adapters/shared/devTracing.ts`) records port calls by wrapping port implementations
  in Proxies inside `buildApp()`. Domain and application code must never reference the tracer.
- `/dev/*` routes (config, traces, import graph, source files) exist only when dev tools are on:
  default for `npm start`, off with `DEV_TOOLS=off` or `NODE_ENV=production`. They are read-only and
  limited to files under `src/`.
- Traces record port arguments/results only. Never pass secrets (API keys, webhook URLs) through a port.
- The Explorer's component descriptions live in `web/public/js/components.js`. When you rename a file,
  class or excerpt anchor, update the matching entry there (`file`, `excerpts[].find`).
- Flows shown in the UI must be labelled honestly: `recorded` (from a trace), `inferred` (proven by
  recorded data), or `conceptual` (not recorded).

## Development Guidelines

- Preserve hexagonal architecture boundaries.
- Prefer constructor-based dependency injection.
- Avoid unnecessary interfaces and abstractions.
- Keep business logic out of controllers.
- Do not introduce unnecessary frameworks.
- Keep the project simple and understandable.
- Follow existing naming conventions.
- Explain significant architectural decisions.
- Prioritize architecture over test quantity.