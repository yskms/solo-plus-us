/** Thrown when input fails validation before it would otherwise hit a DB CHECK constraint. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when a lookup by id finds nothing. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when code reaches a state the design docs call "internal
 * inconsistency" (e.g. §9.5.3 create/update job with no matching Activity).
 * This is not a retryable condition — see 基本設計 v0.11 §9.5.3 / §9.5.4.
 */
export class InternalInconsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalInconsistencyError';
  }
}
