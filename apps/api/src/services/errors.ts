/**
 * An error whose message is safe to show a child. Provider details (keys,
 * upstream bodies) never belong in `message`.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
