/**
 * Standard response structure for all Venus operations.
 * @template T - The expected data shape (e.g., User, News, etc.)
 */
export type VenusResponse<T> = {
  /** The parsed JSON data from the server or null if an error occurred. */
  data: T | null;
  /** A descriptive error message, either from Venus or the server. */
  error: string | null;
  /** Boolean flag indicating if the request was successful (status 200-299). */
  ok: boolean;
  /** The HTTP status code returned by the server, when available. */
  status?: number;
  /** Stable Venus error code for retry, telemetry and UI decisions. */
  errorCode: VenusErrorCode | null;
};

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
 * Declarative configuration accepted by `venus.config()` and `createInstance()`.
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
 * Request hooks to enable auth, logging, tracing or instrumentation.
 */
export interface VenusHooks {
  beforeRequest?: (context: {
    url: string;
    options: RequestInit;
    attempt: number;
  }) => void | RequestInit | Promise<void | RequestInit>;
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
export interface VenusOptions extends RequestInit {
  /** Optional base URL to avoid repeating full paths in every call. */
  baseUrl?: string;
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
   * Instance-level defaults injected by `createInstance()`.
   * When present, the global singleton config is ignored.
   */
  defaults?: VenusConfigInput;
}

/**
 * Independent Venus client created by `createInstance()`.
 * Each instance keeps its own defaults and never reads the global singleton config.
 */
export interface VenusInstance {
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
  /** Merges new values into the instance defaults. */
  config(options: VenusConfigInput): void;
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
