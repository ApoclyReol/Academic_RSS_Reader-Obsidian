export type TranslationErrorKind =
  | "client"
  | "network"
  | "rate-limit"
  | "response"
  | "server"
  | "timeout";

export interface TranslationRequestErrorOptions {
  kind: TranslationErrorKind;
  retryable: boolean;
  retryAfterMs?: number | null;
  status?: number | null;
}

export class TranslationRequestError extends Error {
  readonly kind: TranslationErrorKind;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly status: number | null;

  constructor(
    message: string,
    options: TranslationRequestErrorOptions,
  ) {
    super(message);
    this.name = "TranslationRequestError";
    this.kind = options.kind;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.status = options.status ?? null;
  }
}
