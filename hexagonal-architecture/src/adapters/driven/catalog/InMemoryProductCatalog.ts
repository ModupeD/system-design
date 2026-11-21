// DRIVEN ADAPTER: a fixed, in-memory product list.
// A real system would read a products table or call a pricing service; both
// would be another class implementing the same ProductCatalog port.

import type { ProductCatalog } from "../../../application/ports/out/ProductCatalog.ts";
import type { Product } from "../../../domain/Product.ts";

/** TV is above the fake gateway's $500 limit, so it shows the decline path. */
export const DEFAULT_PRODUCTS: readonly Product[] = [
  { sku: "BOOK", name: "Paperback book", priceCents: 1_500 },
  { sku: "PEN", name: "Ballpoint pen", priceCents: 200 },
  { sku: "MUG", name: "Coffee mug", priceCents: 900 },
  { sku: "HEADPHONES", name: "Wireless headphones", priceCents: 12_000 },
  { sku: "TV", name: "55-inch TV", priceCents: 80_000 },
];

export class InMemoryProductCatalog implements ProductCatalog {
  readonly #products: ReadonlyMap<string, Product>;

  constructor(products: readonly Product[] = DEFAULT_PRODUCTS) {
    this.#products = new Map(products.map((p) => [p.sku, p]));
  }

  async priceOf(sku: string): Promise<number | undefined> {
    return this.#products.get(sku)?.priceCents;
  }

  async list(): Promise<Product[]> {
    return [...this.#products.values()];
  }
}
