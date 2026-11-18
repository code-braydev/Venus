/**
 * Successful response: `ok` narrows `data` to `T`.
 * 204/205 answers carry `data: null`, so type those calls as `<null>`.
 */
export type VenusSuccess<T> = {
  /** The parsed payload (typed as `T`). */
  data: T;
  /** Always `true` (status 200-299). */
  ok: true;
  /** The HTTP status code returned by the server. */
  status: number;
  /** Always `null` on success. */
  error: null;
  /** Always `null` on success. */
  errorCode: null;
  /** Request metrics; `null` unless `metrics: true` is enabled. */
  metrics: VenusMetrics | null;
};

/**
 * Failed response. `data` is whatever the server returned (error body) or
 * `null`; it is not `T`.
 */
export type VenusFailure = {
  /** Server error body when one could be parsed, otherwise `null`. */
  data: unknown;
  /** Always `false`. */
  ok: false;
  /** The HTTP status when available (0 for network/validation failures). */
  status?: number;
  /** A descriptive error message, either from Venus or the server. */
  error: string;
  /** Stable Venus error code for retry, telemetry and UI decisions. */
  errorCode: VenusErrorCode;
  /** Request metrics; `null` unless `metrics: true` is enabled. */
  metrics: VenusMetrics | null;
};

/**
 * Standard response of every Venus operation. Check `ok` to narrow it:
 *
 * ```ts
 * const res = await get<User>("/me");
 * if (res.ok) res.data.name; // User
 * else res.errorCode;        // VenusErrorCode
 * ```
 * @template T - The expected data shape (e.g., User).
 */
export type VenusResponse<T> = VenusSuccess<T> | VenusFailure;

/**
 * Metrics collected for one logical request (all retry attempts included).
 * Enabling metrics switches the transport to XMLHttpRequest.
 */
export interface VenusMetrics {
  /** Transport that served the request. */
  engine: "fetch" | "xhr";
  /** Epoch milliseconds when the request started. */
  startedAt: number;
  /** Total elapsed milliseconds, including retries and backoff. */
  durationMs: number;
  /** Number of attempts performed (1 = no retries). */
  attempts: number;
}

/**
 * Stable internal error codes returned by Venus.
 */
export type VenusErrorCode =
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "ABORTED"
  | "NETWORK_ERROR"
  | "JSON_PARSE_ERROR"
  | "INVALID_BODY"
  | "INVALID_URL"
  | "MODE_CONFLICT"
  | "UNSUPPORTED"
  | "RETRY_EXHAUSTED"
  | "UNKNOWN_ERROR";

/**
 * Output parser strategy for response bodies.
 */
export type VenusResponseType =
  | "json"
  | "text"
  | "blob"
  | "formData"
  | "arrayBuffer"
  | "stream"
  | "auto";

type PrimitiveParam = string | number | boolean;
type QueryValue =
  | PrimitiveParam
  | PrimitiveParam[]
  | Date
  | null
  | undefined
  | { [key: string]: QueryValue };

/**
 * Query params accepted by Venus.
 */
export type VenusQueryParams = Record<string, QueryValue>;

/**
 * Strategy used when serializing array query params.
 */
export type ParamsArrayFormat = "repeat" | "comma" | "brackets" | "indices";

/**
 * Retry options for transient failures.
 */
export interface VenusRetryOptions {
  /** Number of retries after the first attempt. */
  attempts?: number;
  /** Initial backoff in milliseconds. */
  backoffMs?: number;
  /** Max backoff in milliseconds. */
  maxBackoffMs?: number;
  /**
   * HTTP methods allowed to retry. Defaults to the idempotent ones
   * (GET, HEAD, OPTIONS, PUT, DELETE); add "POST"/"PATCH" only if safe.
   * Ignored when `shouldRetry` is provided.
   */
  retryMethods?: string[];
  /** Status codes considered retryable. */
  retryOn?: number[];
  /** Optional custom retry decision. */
  shouldRetry?: (context: {
    attempt: number;
    status?: number;
    errorCode?: VenusErrorCode;
  }) => boolean;
}

/**
 * Declarative configuration accepted by `venus.config()` and `createClient()`.
 * Only the provided keys are applied; the rest keep their previous value.
 */
export interface VenusConfigInput {
  /** Optional base URL to avoid repeating full paths in every call. */
  baseURL?: string;
  /** Headers merged into every request of this scope (per-request headers win). */
  headers?: Record<string, string>;
  /** Default request timeout in milliseconds. */
  timeout?: number;
  /** Default retry policy; can be overridden per request. */
  retry?: boolean | number | VenusRetryOptions;
  /** Collect `metrics` on every response (switches the transport to XHR). */
  metrics?: boolean;
  /**
   * Scope-wide interceptors. They run before the per-request hooks on every
   * attempt, so a client can e.g. inject the current auth token.
   */
  hooks?: VenusHooks;
  /** Scope-wide telemetry listener; runs before the per-request one. */
  onTelemetry?: (event: VenusTelemetryEvent) => void;
  /**
   * Hidden legacy switches. Not part of the documented API.
   * `sync: true` runs a blocking synchronous XMLHttpRequest (text/json only,
   * no progress, no mid-flight abort).
   */
  legacy?: { sync?: boolean };
}

/**
 * Telemetry event emitted once each request resolves.
 */
export interface VenusTelemetryEvent {
  url: string;
  method: string;
  ok: boolean;
  status?: number;
  durationMs: number;
  attempt: number;
  errorCode: VenusErrorCode | null;
}

/**
 * Partial request override returned by `beforeRequest`.
 * Returned fields are merged into the outgoing request; headers are combined
 * and `disableHeaders` removes inherited header names.
 */
export interface VenusRequestOverride extends RequestInit {
  /** Header names (case-insensitive) removed from the outgoing request. */
  disableHeaders?: string[];
}

/**
 * Request hooks to enable auth, logging, tracing or instrumentation.
 */
export interface VenusHooks {
  /**
   * Runs before each attempt with a read-only copy of the request.
   * Mutating it has no effect: return a partial override instead.
   */
  beforeRequest?: (context: {
    url: string;
    options: Readonly<RequestInit>;
    attempt: number;
  }) => void | VenusRequestOverride | Promise<void | VenusRequestOverride>;
  afterResponse?: (context: {
    url: string;
    options: RequestInit;
    response: Response;
    durationMs: number;
    attempt: number;
  }) => void | Promise<void>;
}

/**
 * Transfer progress snapshot reported by the hybrid engine.
 */
export interface VenusProgress {
  /**
   * Transfer direction: `"upload"` when a body is being sent,
   * `"download"` when a response body is being received.
   */
  direction: "upload" | "download";
  /**
   * Human-readable transfer amount, e.g. `"125KB / 523KB"`.
   * Shows only the transferred bytes when the total is not computable.
   */
  loaded: string;
  /** Completion percentage (0-100), or null when total is unknown. */
  percent: number | null;
}

/**
 * Callback invoked as progress events arrive.
 * Providing it switches the request to the XHR engine transparently;
 * the direction is detected automatically (body -> upload, no body -> download).
 */
export type VenusProgressCallback = (progress: VenusProgress) => void;

/**
 * Internal configuration for network requests.
 * Extends RequestInit for compatibility with fetch.
 */
export interface VenusOptions extends Omit<RequestInit, "body"> {
  /**
   * Request payload, auto-serialized with its Content-Type:
   * objects/arrays → JSON, string → text/plain, File/Blob/ArrayBuffer/typed
   * arrays/ReadableStream → binary, FormData and URLSearchParams → native.
   * An explicit `Content-Type` header always wins.
   */
  body?: unknown;
  /** Collect `metrics` for this request (switches the transport to XHR). */
  metrics?: boolean;
  /** @internal In-flight registry injected by the scope so `abort()` can cancel it. */
  registry?: Set<AbortController>;
  /** Desired parser for response body; auto uses headers/content sniffing. */
  responseType?: VenusResponseType;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Query params to append to the URL. */
  params?: VenusQueryParams;
  /** Array serialization format for query params. */
  paramsArrayFormat?: ParamsArrayFormat;
  /** Retry policy, disabled by default. */
  retry?: boolean | number | VenusRetryOptions;
  /** Lightweight request/response hooks. */
  hooks?: VenusHooks;
  /**
   * Header names (case-insensitive) removed from the outgoing request.
   * Useful to opt out of a header inherited from the singleton/instance scope.
   */
  disableHeaders?: string[];
  /** Optional telemetry callback. */
  onTelemetry?: (event: VenusTelemetryEvent) => void;
  /**
   * Unified progress callback for the request.
   *
   * Providing it transparently switches the transport to XMLHttpRequest
   * (no flags required). The direction is detected automatically:
   * requests with a body report `direction: "upload"`, the rest report
   * `direction: "download"`.
   *
   * ```ts
   * await send("/upload", file, {
   *   progress: ({ direction, loaded, percent }) => {
   *     console.log(`${direction}: ${loaded} ${percent}%`);
   *   },
   * });
   * ```
   */
  progress?: VenusProgressCallback;
  /**
   * @internal
   * Instance-level defaults injected by `createClient()`.
   * When present, the global singleton config is ignored.
   */
  defaults?: VenusConfigInput;
}

/**
 * Independent Venus client created by `createClient()`.
 * Each instance keeps its own defaults and never reads the global singleton config.
 */
export interface VenusClient {
  /** Performs a GET request with the instance defaults applied. */
  get<T>(path: string, options?: VenusOptions): Promise<VenusResponse<T>>;
  /** Performs a POST request with the instance defaults applied. */
  send<T>(
    path: string,
    body: unknown,
    options?: VenusOptions,
  ): Promise<VenusResponse<T>>;
  /** Performs a PUT request with the instance defaults applied. */
  update<T>(
    path: string,
    body: unknown,
    options?: VenusOptions,
  ): Promise<VenusResponse<T>>;
  /** Performs a PATCH request with the instance defaults applied. */
  updateOnly<T>(
    path: string,
    body: unknown,
    options?: VenusOptions,
  ): Promise<VenusResponse<T>>;
  /** Performs a DELETE request with the instance defaults applied. */
  remove<T>(path: string, options?: VenusOptions): Promise<VenusResponse<T>>;
  /** Returns a copy of the immutable client defaults. */
  config(): VenusConfigInput;
  /** Aborts every in-flight request of this client (they resolve as `ABORTED`). */
  abort(): void;
}

/**
 * Utility type to infer payload data from a VenusResponse.
 */
export type InferData<T extends VenusResponse<unknown>> = T["data"];

/**
 * Normalized error shape for non-success responses.
 */
export type VenusNormalizedError = Pick<
  VenusResponse<never>,
  "ok" | "status" | "error" | "errorCode"
>;
