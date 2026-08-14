import { t } from "../../i18n/strings";

/** Error with a message safe to show the user directly. */
export class ApiError extends Error {
  readonly causeDetail?: unknown;
  constructor(friendly: string, cause?: unknown) {
    super(friendly);
    this.name = "ApiError";
    this.causeDetail = cause;
  }
}

/**
 * Unwrap a Supabase { data, error } response. Every API call goes through
 * this — no silent failures anywhere. Raw Postgres errors are logged for
 * debugging; the user sees either the trigger's business message (our guard
 * triggers raise human-readable exceptions) or a generic fallback.
 */
export function must<T>(
  data: T | null,
  error: { message: string } | null,
  friendly?: string,
): T {
  if (error) {
    console.error("[api]", error.message);
    // Guard-trigger messages (e.g. "Cycle is locked …") are user-appropriate.
    const raised = error.message.match(/^(?:.*: )?([A-Z][^:]*)$/)?.[1];
    throw new ApiError(friendly ?? raised ?? t.errorGeneric, error);
  }
  if (data === null) {
    throw new ApiError(friendly ?? t.errorGeneric);
  }
  return data;
}

/** Same, but null data is a legitimate "not found". */
export function maybe<T>(
  data: T | null,
  error: { message: string } | null,
  friendly?: string,
): T | null {
  if (error) {
    console.error("[api]", error.message);
    throw new ApiError(friendly ?? t.errorGeneric, error);
  }
  return data;
}
