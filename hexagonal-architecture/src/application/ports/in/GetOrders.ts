// INPUT PORT (driving port): reading orders.

import type { Order } from "../../../domain/Order.ts";

export interface GetOrders {
  /** @throws OrderNotFoundError */
  byId(orderId: string): Promise<Order>;
  list(): Promise<Order[]>;
}
