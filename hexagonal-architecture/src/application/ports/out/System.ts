// OUTPUT PORTS (driven ports): even time and randomness count as "the outside
// world". Behind ports, the application is deterministic: a fixed clock and
// predictable ids make its behaviour easy to reproduce.

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
