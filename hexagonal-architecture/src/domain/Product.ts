// DOMAIN: a product that can be ordered.
// Plain data with no rules of its own. Prices are owned by the catalog (an
// output port), and an Order keeps a snapshot of the price it was placed at.

export interface Product {
  readonly sku: string;
  readonly name: string;
  readonly priceCents: number;
}
