// APPLICATION SERVICE (use case): reading orders. Implements the GetOrders input port.

import type { Order } from "../../domain/Order.ts";
import { OrderNotFoundError } from "../errors.ts";
import type { GetOrders } from "../ports/in/GetOrders.ts";
import type { OrderRepository } from "../ports/out/OrderRepository.ts";

export class GetOrdersService implements GetOrders {
  readonly #orders: OrderRepository;

  constructor(orders: OrderRepository) {
    this.#orders = orders;
  }

  async byId(orderId: string): Promise<Order> {
    const order = await this.#orders.findById(orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    return order;
  }

  list(): Promise<Order[]> {
    return this.#orders.findAll();
  }
}
