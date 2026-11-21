// ─────────────────────────────────────────────────────────────────────────────
// DRIVEN ADAPTER: keeps orders in a JSON file on disk.
// Same port as InMemoryOrderRepository, different technology. Swapping one for
// the other is a single line in src/composition/container.ts.
//
// ⚠ DEMO PERSISTENCE, NOT A DATABASE. What it does handle:
//   - writes from ONE process are queued, so concurrent saves don't overwrite
//     each other;
//   - each write goes to a temp file and is then renamed into place, so a
//     crash mid-write doesn't leave a half-written file.
// What it does NOT handle: several processes sharing the file (for example the
// HTTP server and the CLI at the same time: the last writer wins), unique
// constraints, or large data. For those, use a real database (see the
// PostgreSQL section in the README).
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { OrderRepository } from "../../../application/ports/out/OrderRepository.ts";
import type { Order } from "../../../domain/Order.ts";

interface FileContents {
  orders: Record<string, Order>;
  orderIdByIdempotencyKey: Record<string, string>;
}

export class JsonFileOrderRepository implements OrderRepository {
  readonly #filePath: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  save(order: Order, idempotencyKey?: string): Promise<void> {
    const write = this.#writeQueue.then(async () => {
      const data = await this.#read();
      data.orders[order.id] = order;
      if (idempotencyKey !== undefined) data.orderIdByIdempotencyKey[idempotencyKey] = order.id;
      await this.#writeAtomically(data);
    });
    // Keep the queue alive even if this write fails; the caller still sees the error.
    this.#writeQueue = write.catch(() => {});
    return write;
  }

  async findById(orderId: string): Promise<Order | undefined> {
    return (await this.#read()).orders[orderId];
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Order | undefined> {
    const data = await this.#read();
    const orderId = data.orderIdByIdempotencyKey[idempotencyKey];
    return orderId === undefined ? undefined : data.orders[orderId];
  }

  async findAll(): Promise<Order[]> {
    return Object.values((await this.#read()).orders);
  }

  async #read(): Promise<FileContents> {
    try {
      return JSON.parse(await readFile(this.#filePath, "utf8")) as FileContents;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { orders: {}, orderIdByIdempotencyKey: {} };
      throw err;
    }
  }

  async #writeAtomically(data: FileContents): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const tempPath = `${this.#filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2));
    await rename(tempPath, this.#filePath);
  }
}
