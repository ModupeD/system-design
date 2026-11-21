// INPUT PORT (driving port): browsing the catalog. Read-only.
// It exists so a client (the web UI, the CLI) can SHOW products and prices
// without knowing where they come from, and without copying the price list.

import type { Product } from "../../../domain/Product.ts";

export interface ListProducts {
  list(): Promise<Product[]>;
}
