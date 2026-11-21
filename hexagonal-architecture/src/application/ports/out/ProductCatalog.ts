// OUTPUT PORT (driven port): the source of truth for products and prices.
// Prices come from the server, never from the client. Today the adapter is an
// in-memory list; tomorrow it could be a products table or a pricing API.

import type { Product } from "../../../domain/Product.ts";

export interface ProductCatalog {
  /** The current price in cents, or `undefined` if there is no such product. */
  priceOf(sku: string): Promise<number | undefined>;
  /** Every product that can currently be ordered. */
  list(): Promise<Product[]>;
}
