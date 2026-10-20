/**
 * lib/paymentApi.ts
 * The single gateway for every request this app makes to its own backend
 * (Issue #1438).
 *
 * Before this module grew, 34 backend call sites across 14 files each
 * hand-rolled the same four steps — resolve `NEXT_PUBLIC_API_URL`, serialise a
 * body, check `res.ok`, dig the message out of the `{ success, error, data }`
 * envelope — and disagreed on all of them: seven spellings of the same
 * base-URL expression, two of them hardcoded `http://localhost:4000`
 * fallbacks, and error handling that ranged from structured envelope parsing
 * to no check at all.
 *
 * Horizon, price-feed, anchor and SNS requests deliberately stay where they
 * are (`lib/stellar.ts`, `lib/price.ts`, `lib/anchor.ts`,
 * `utils/snsResolver.ts`): they speak other services' contracts, so routing
 * them through here would import this backend's envelope assumption into code
 * that has nothing to do with it.
 *
 * Errors are `ApiError`, which carries `status`, `code` and the parsed payload
 * so a caller can branch on `missing_signature` / `expired_signature` or a 404
 * instead of pattern-matching an error string.
 */

import { getJwtToken } from "./auth";
import { buildSignedHeaders } from "./requestSignature";

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

/** `ApiError.status` for a request that never reached the server. */
export const NETWORK_STATUS = 0;

/** `ApiError.code` for a request that never reached the server. */
export const NETWORK_ERROR_CODE = "network_error";

/** The response shape every backend controller returns. */
interface ApiEnvelope {
  success?: boolean;
  data?: unknown;
  error?: string;
  message?: string;
  code?: string;
}

export interface ApiRequestOptions {
  /** Defaults to GET. */
  method?: ApiMethod;
  /** Appended to `path`, skipping null/undefined values. */
  query?: ApiQuery;
  /** Object payload — serialised once, and that exact string is what gets signed. */
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Attach `X-Timestamp` / `X-Signature`. Only `/api/payments/submit` requires
   * it. The signature covers `path` alone, so a signed request must not also
   * pass `query` — the server would hash a different string than the client.
   */
  signed?: boolean;
  /** Override the signing timestamp; mainly for tests. */
  timestamp?: number;
  /** Send/receive cookies, e.g. the httpOnly `jwt` set by SEP-0010 verify. */
  credentials?: RequestCredentials;
  /** Attach `Authorization: Bearer <session JWT>` when a token exists. */
  auth?: boolean;
  /** Expect the `{ success, data }` envelope and return `data`. Defaults to true. */
  envelope?: boolean;
  /** Message used when the server sends no `error`/`message` field. */
  fallbackMessage?: string;
  signal?: AbortSignal;
}

/**
 * A backend failure, in a form components can switch on.
 *
 * `message` keeps the plain-`Error` semantics callers already display, so
 * migrating a call site never changes what the user reads.
 */
export class ApiError extends Error {
  /** HTTP status, or `NETWORK_STATUS` when the request never got a response. */
  readonly status: number;
  /** Machine-readable code from the backend (`invalid_signature`, `not_found`, …). */
  readonly code: string | null;
  readonly method: string;
  readonly path: string;
  /** Parsed response body, when the server sent JSON. */
  readonly payload: unknown;

  constructor(
    message: string,
    details: {
      status: number;
      code?: string | null;
      method: string;
      path: string;
      payload?: unknown;
    }
  ) {
    super(message);
    this.name = "ApiError";
    this.status = details.status;
    this.code = details.code ?? null;
    this.method = details.method;
    this.path = details.path;
    this.payload = details.payload ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Backend origin, with any trailing slash removed. Empty when
 * `NEXT_PUBLIC_API_URL` is unset, which yields same-origin relative paths —
 * the behaviour every previously-migrated call site already relied on.
 */
export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
}

/** Absolute URL for a backend path, with `query` appended. */
export function apiUrl(path: string, query?: ApiQuery): string {
  const url = `${getApiBaseUrl()}${path}`;
  if (!query) return url;

  const search = Object.entries(query)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
  return search ? `${url}?${search}` : url;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["error", "message"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return fallback;
}

function errorCode(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>).code;
    if (typeof value === "string") return value;
  }
  return null;
}

/**
 * Perform one backend request and return its unwrapped payload.
 *
 * Every failure path throws `ApiError`: a non-2xx status, an envelope that
 * reports `success: false`, or a rejected `fetch`.
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    method = "GET",
    query,
    body,
    headers = {},
    signed = false,
    timestamp,
    credentials,
    auth = false,
    envelope = true,
    signal,
  } = options;

  const fallback =
    options.fallbackMessage ?? `Request failed (${method} ${path})`;
  const serialisedBody = body === undefined ? undefined : JSON.stringify(body);

  const requestHeaders: Record<string, string> = { ...headers };
  if (serialisedBody !== undefined && !requestHeaders["Content-Type"]) {
    requestHeaders["Content-Type"] = "application/json";
  }
  if (auth) {
    const token = getJwtToken();
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
  }
  if (signed) {
    const signedHeaders = await buildSignedHeaders({
      method,
      path,
      body: serialisedBody ?? "",
      timestamp,
    });
    Object.assign(requestHeaders, signedHeaders);
  }

  // Only the parts the caller actually asked for go into the request, so a
  // migrated call site sends exactly the same fetch it sent before — an empty
  // `headers: {}` or an explicit `method: "GET"` is noise that existing wire
  // tests (and proxies) can see.
  const init: Record<string, unknown> = {};
  if (method !== "GET") init.method = method;
  if (Object.keys(requestHeaders).length > 0) init.headers = requestHeaders;
  if (serialisedBody !== undefined) init.body = serialisedBody;
  if (credentials) init.credentials = credentials;
  if (signal) init.signal = signal;

  const url = apiUrl(path, query);

  let response: Response;
  try {
    response = Object.keys(init).length > 0
      ? await fetch(url, init as RequestInit)
      : await fetch(url);
  } catch (error) {
    throw new ApiError(
      error instanceof Error && error.message ? error.message : fallback,
      {
        status: NETWORK_STATUS,
        code: NETWORK_ERROR_CODE,
        method,
        path,
      }
    );
  }

  // Read defensively rather than `response.json().catch(...)`: a caller that
  // stubs a response with only `{ ok, status }` (common in tests) would throw a
  // TypeError out of the gateway and lose the status the caller branches on.
  let payload: ApiEnvelope | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope | null;
  } catch {
    payload = null;
  }

  if (!response.ok || (envelope && payload?.success !== true)) {
    throw new ApiError(errorMessage(payload, fallback), {
      status: response.status,
      code: errorCode(payload),
      method,
      path,
      payload,
    });
  }

  return (envelope ? payload?.data : payload) as T;
}

export function apiGet<T = unknown>(
  path: string,
  options: Omit<ApiRequestOptions, "method" | "body"> = {}
): Promise<T> {
  return apiRequest<T>(path, { ...options, method: "GET" });
}

export function apiPost<T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, "method" | "body"> = {}
): Promise<T> {
  return apiRequest<T>(path, { ...options, method: "POST", body });
}

export function apiPut<T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, "method" | "body"> = {}
): Promise<T> {
  return apiRequest<T>(path, { ...options, method: "PUT", body });
}

export function apiPatch<T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, "method" | "body"> = {}
): Promise<T> {
  return apiRequest<T>(path, { ...options, method: "PATCH", body });
}

export function apiDelete<T = unknown>(
  path: string,
  options: Omit<ApiRequestOptions, "method" | "body"> = {}
): Promise<T> {
  return apiRequest<T>(path, { ...options, method: "DELETE" });
}

export interface PaymentSubmission {
  senderPublicKey: string;
  recipientPublicKey: string;
  amount: string;
  asset?: string;
  txHash?: string;
}

/**
 * Record a payment the client has already signed and broadcast to Horizon.
 *
 * The body is serialised once and that exact string is both signed and sent —
 * the server verifies the signature over the raw bytes it receives, so signing
 * a re-serialised copy would risk a mismatch and an opaque 401.
 */
export async function submitSignedPayment(
  submission: PaymentSubmission,
  options: { path?: string; timestamp?: number } = {}
): Promise<unknown> {
  return apiRequest<unknown>(options.path ?? "/api/payments/submit", {
    method: "POST",
    body: submission,
    signed: true,
    timestamp: options.timestamp,
    fallbackMessage: "Payment submission failed",
  });
}
