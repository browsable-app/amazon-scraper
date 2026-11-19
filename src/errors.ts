/** Only intentionally authored public input messages should use this error. */
export class PublicInputError extends Error {
  readonly error_code = "invalid_input";
  readonly retryable = false;
  readonly action = "check_input" as const;
  readonly error: string;
  readonly errors: Array<{ path: string; message: string }>;
  constructor(field: string, message: string) {
    super(message);
    this.name = "PublicInputError";
    this.error = message;
    this.errors = [{ path: field, message }];
  }
}
