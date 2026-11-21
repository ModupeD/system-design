// Test doubles: tiny hand-written implementations of output ports.
// Ports are just interfaces, so no mocking library is needed.

import type { Notifier } from "../src/application/ports/out/Notifier.ts";
import type { ChargeRequest, ChargeResult, PaymentGateway } from "../src/application/ports/out/PaymentGateway.ts";
import type { Clock, IdGenerator } from "../src/application/ports/out/System.ts";
import type { Order } from "../src/domain/Order.ts";

export class FixedClock implements Clock {
  now() {
    return new Date("2026-01-01T12:00:00.000Z");
  }
}

export class SequentialIds implements IdGenerator {
  #n = 0;
  next() {
    return `order-${++this.#n}`;
  }
}

/** Returns the scripted results in order (repeating the last), and records every call. */
export class ScriptedPayments implements PaymentGateway {
  readonly calls: ChargeRequest[] = [];
  readonly #results: ChargeResult[];
  #onCharge: (request: ChargeRequest) => Promise<void>;

  constructor(...results: ChargeResult[]) {
    this.#results = results.length ? results : [{ status: "succeeded", paymentId: "pay_123" }];
    this.#onCharge = async () => {};
  }

  /** Run something at the moment of charging, e.g. to inspect what was already saved. */
  onCharge(hook: (request: ChargeRequest) => Promise<void>): this {
    this.#onCharge = hook;
    return this;
  }

  async charge(request: ChargeRequest) {
    this.calls.push(request);
    await this.#onCharge(request);
    return this.#results[Math.min(this.calls.length, this.#results.length) - 1]!;
  }
}

export class RecordingNotifier implements Notifier {
  readonly sent: Order[] = [];
  async orderPlaced(order: Order) {
    this.sent.push(order);
  }
}

export class BrokenNotifier implements Notifier {
  async orderPlaced(): Promise<void> {
    throw new Error("Slack is down");
  }
}
