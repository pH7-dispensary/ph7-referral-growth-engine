export class DomainError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(`Referral transition ${from} → ${to} is not permitted.`, "INVALID_TRANSITION");
  }
}

export class UniqueConstraintError extends DomainError {
  constructor(readonly key: string) {
    super(`A record already exists for unique key ${key}.`, "UNIQUE_CONSTRAINT");
  }
}
