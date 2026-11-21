// DOMAIN ERROR: a business rule was broken ("an order needs at least one item").
// It speaks the language of the business, not of HTTP or SQL. Each driving
// adapter decides what it means for its channel: the HTTP adapter turns it into
// a 400, the CLI prints it and exits with code 1.

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
