// APPLICATION ERRORS: things that go wrong while running a use case but are not
// business rules. "Order not found" is about a lookup, not about what makes a
// valid order, so it lives here instead of in the domain.

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = "OrderNotFoundError";
  }
}

/** The same idempotency key was sent again, but with a different order request. */
export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key "${key}" was already used for a different order request`);
    this.name = "IdempotencyConflictError";
  }
}
