// APPLICATION SERVICE (use case): listing products. Implements the ListProducts
// input port by asking the ProductCatalog output port. Thin on purpose: there
// is no business rule here, only a boundary that keeps clients away from the
// catalog adapter.

import type { Product } from "../../domain/Product.ts";
import type { ListProducts } from "../ports/in/ListProducts.ts";
import type { ProductCatalog } from "../ports/out/ProductCatalog.ts";

export class ListProductsService implements ListProducts {
  readonly #catalog: ProductCatalog;

  constructor(catalog: ProductCatalog) {
    this.#catalog = catalog;
  }

  list(): Promise<Product[]> {
    return this.#catalog.list();
  }
}
