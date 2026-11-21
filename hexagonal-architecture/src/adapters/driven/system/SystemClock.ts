// DRIVEN ADAPTERS: the real clock and a real id generator.

import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator } from "../../../application/ports/out/System.ts";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class UuidGenerator implements IdGenerator {
  next(): string {
    // The full UUID. A shortened one collides surprisingly early, and because
    // save() is an upsert, a collision would silently overwrite another order.
    return randomUUID();
  }
}
