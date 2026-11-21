// ─────────────────────────────────────────────────────────────────────────────
// DEVELOPMENT-ONLY TRACING, used by the Architecture Explorer page.
//
// How it stays out of the business logic:
//   - The composition root wraps each port implementation in a Proxy
//     (`wrap()`). The proxy records "port X, implementation Y, method Z was
//     called with these arguments and returned this", then forwards the call
//     unchanged. It is a decorator applied from the OUTSIDE.
//   - AsyncLocalStorage ties every recorded call to the HTTP request that
//     caused it, so no trace id has to be passed through the core.
//   - Domain and application code are untouched and unaware of it. Calls made
//     outside a traced request are forwarded without recording anything.
//
// What it records: the arguments and results of PORT calls only (orders,
// charge requests, prices). Adapter configuration such as API keys or webhook
// URLs never passes through a port, so it never appears in a trace.
// Traces are kept in memory (last 50) and are only served when dev tools are on.
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface TraceStep {
  seq: number;
  /** `seq` of the call that made this one, or null at the top level. */
  parent: number | null;
  kind: "call" | "note";
  /** The concrete class that ran (e.g. "FakePaymentGateway"), or the adapter that wrote a note. */
  component: string;
  /** The interface it was called through (e.g. "PaymentGateway"). */
  port: string | null;
  method: string;
  args: unknown[];
  result?: unknown;
  error?: { name: string; message: string };
  detail?: string;
  /** Milliseconds since the trace started. */
  startMs: number;
  durationMs?: number;
}

export interface Trace {
  id: string;
  label: string;
  startedAt: string;
  steps: TraceStep[];
}

interface Context {
  trace: Trace;
  parent: number | null;
  t0: number;
}

const MAX_TRACES = 50;
const MAX_VALUE_CHARS = 4_000;

export class DevTracer {
  readonly #context = new AsyncLocalStorage<Context>();
  readonly #traces = new Map<string, Trace>();

  /** Run `fn` with a fresh trace; every wrapped call made inside it is recorded. */
  run<T>(label: string, fn: (traceId: string) => Promise<T>): Promise<T> {
    const trace: Trace = { id: randomUUID(), label, startedAt: new Date().toISOString(), steps: [] };
    this.#traces.set(trace.id, trace);
    if (this.#traces.size > MAX_TRACES) this.#traces.delete(this.#traces.keys().next().value!);
    return this.#context.run({ trace, parent: null, t0: performance.now() }, () => fn(trace.id));
  }

  get(traceId: string): Trace | undefined {
    return this.#traces.get(traceId);
  }

  /** Let an adapter add a free-text step ("received POST /orders"). No-op outside a trace. */
  note(component: string, detail: string): void {
    const ctx = this.#context.getStore();
    if (!ctx) return;
    ctx.trace.steps.push({
      seq: ctx.trace.steps.length + 1,
      parent: ctx.parent,
      kind: "note",
      component,
      port: null,
      method: "",
      args: [],
      detail,
      startMs: elapsed(ctx),
    });
  }

  /** Decorate a port implementation so its method calls are recorded. Behaviour is unchanged. */
  wrap<T extends object>(target: T, port: string): T {
    const component = target.constructor.name;
    return new Proxy(target, {
      get: (obj, prop) => {
        const value: unknown = Reflect.get(obj, prop, obj);
        if (typeof value !== "function" || prop === "constructor" || typeof prop === "symbol") return value;
        // `apply(obj, ...)`, not the proxy, so classes with #private fields keep working.
        return (...args: unknown[]) => this.#record(component, port, prop, args, () => value.apply(obj, args));
      },
    });
  }

  #record(component: string, port: string, method: string, args: unknown[], invoke: () => unknown): unknown {
    const ctx = this.#context.getStore();
    if (!ctx) return invoke();

    const step: TraceStep = {
      seq: ctx.trace.steps.length + 1,
      parent: ctx.parent,
      kind: "call",
      component,
      port,
      method,
      args: args.map(snapshot),
      startMs: elapsed(ctx),
    };
    ctx.trace.steps.push(step);

    const finish = (failed: boolean, value: unknown) => {
      step.durationMs = round(elapsed(ctx) - step.startMs);
      if (failed) {
        const err = value instanceof Error ? value : new Error(String(value));
        step.error = { name: err.name, message: err.message };
      } else {
        step.result = snapshot(value);
      }
    };

    try {
      // Calls made by this method are recorded as its children.
      const out = this.#context.run({ ...ctx, parent: step.seq }, invoke);
      if (out instanceof Promise) {
        return out.then(
          (value) => (finish(false, value), value),
          (err) => {
            finish(true, err);
            throw err;
          },
        );
      }
      finish(false, out);
      return out;
    } catch (err) {
      finish(true, err);
      throw err;
    }
  }
}

function elapsed(ctx: Context): number {
  return round(performance.now() - ctx.t0);
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

/** A JSON-safe copy, so later mutations can't change what was recorded. */
function snapshot(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return String(value);
    return json.length > MAX_VALUE_CHARS ? `${json.slice(0, MAX_VALUE_CHARS)}… (truncated)` : JSON.parse(json);
  } catch {
    return String(value);
  }
}
