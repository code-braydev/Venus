import {
  ParamsArrayFormat,
  VenusConfigInput,
  VenusErrorCode,
  VenusFailure,
  VenusMetrics,
  VenusOptions,
  VenusHooks,
  VenusResponse,
  VenusResponseType,
  VenusTelemetryEvent,
  VenusRetryOptions,
} from "./types.js";
import { isInstanceMode, readConfig, singletonRegistry } from "../utils/config.js";
import { serializeBody, type SerializedBody } from "../utils/body.js";
import { xhrRequest } from "./xhr.js";

/** Internal response shape: `metrics` is attached once by `request()`. */
type DistributiveOmit<U, K extends PropertyKey> = U extends unknown
  ? Omit<U, K>
  : never;
type Bare<T> = DistributiveOmit<VenusResponse<T>, "metrics">;

type RequestMeta = {
  enabled: boolean;
  engine: VenusMetrics["engine"];
  attempts: number;
  startedAt: number;
};

const DEFAULT_RETRY_STATUS = [408, 429, 500, 502, 503, 504];
/** Idempotent methods: safe to repeat without duplicating side effects. */
const DEFAULT_RETRY_METHODS = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"];

type ParsedRetry = Required<
  Pick<VenusRetryOptions, "attempts" | "backoffMs" | "maxBackoffMs" | "retryMethods">
> &
  Pick<VenusRetryOptions, "retryOn" | "shouldRetry">;

type RequestBuildResult = {
  fetchOptions: RequestInit;
  clearTimeout?: () => void;
  timeoutTriggered: () => boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function appendArray(
  search: URLSearchParams,
  key: string,
  values: unknown[],
  format: ParamsArrayFormat,
) {
  if (format === "comma") {
    search.append(key, values.map(String).join(","));
    return;
  }

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) {
      continue;
    }

    if (format === "brackets") {
      search.append(`${key}[]`, String(value));
      continue;
    }

    if (format === "indices") {
      search.append(`${key}[${i}]`, String(value));
      continue;
    }

    search.append(key, String(value));
  }
}

function serializeParams(
  params: VenusOptions["params"] | undefined,
  format: ParamsArrayFormat,
): string {
  if (!params) {
    return "";
  }

  const search = new URLSearchParams();

  const visit = (key: string, value: unknown) => {
    if (value == null) {
      return;
    }

    if (value instanceof Date) {
      search.append(key, value.toISOString());
      return;
    }

    if (Array.isArray(value)) {
      appendArray(search, key, value, format);
      return;
    }

    if (isPlainObject(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        visit(`${key}.${nestedKey}`, nestedValue);
      }
      return;
    }

    search.append(key, String(value));
  };

  for (const [key, value] of Object.entries(params)) {
    visit(key, value);
  }

  return search.toString();
}

const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

function composeUrl(path: string, options: VenusOptions, baseURL: string): string {
  const rootUrl = ABSOLUTE_URL.test(path)
    ? path
    : `${baseURL}${path.startsWith("/") ? path : `/${path}`}`;

  const query = serializeParams(
    options.params,
    options.paramsArrayFormat ?? "repeat",
  );
  if (!query) {
    return rootUrl;
  }

  const separator = rootUrl.includes("?") ? "&" : "?";
  return `${rootUrl}${separator}${query}`;
}

/**
 * Builds the effective request headers by layering scope headers, per-request
 * headers and explicit `disableHeaders` removals.
 */
function buildHeaders(
  scopeHeaders: Record<string, string>,
  requestHeaders: HeadersInit | undefined,
  disableHeaders: string[] | undefined,
): Headers | undefined {
  const hasScope = Object.keys(scopeHeaders).length > 0;
  const hasDisable = disableHeaders !== undefined && disableHeaders.length > 0;

  if (!hasScope && !requestHeaders && !hasDisable) {
    return undefined;
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(scopeHeaders)) {
    headers.set(key, value);
  }
  if (requestHeaders) {
    new Headers(requestHeaders).forEach((value, key) => headers.set(key, value));
  }
  if (hasDisable) {
    for (const name of disableHeaders) {
      headers.delete(name);
    }
  }
  return headers;
}

/**
 * Merges a hook override on top of the current headers.
 * The override combines headers (overlay wins) and can disable names.
 */
function mergeHeaders(
  base: HeadersInit | undefined,
  overlay: HeadersInit | undefined,
  disableHeaders: string[] | undefined,
): Headers | undefined {
  const hasDisable = disableHeaders !== undefined && disableHeaders.length > 0;

  if (!base && !overlay && !hasDisable) {
    return undefined;
  }

  const headers = new Headers(base);
  if (overlay) {
    new Headers(overlay).forEach((value, key) => headers.set(key, value));
  }
  if (hasDisable) {
    for (const name of disableHeaders) {
      headers.delete(name);
    }
  }
  return headers;
}

function normalizeRetryConfig(
  retry: VenusConfigInput["retry"],
): ParsedRetry | null {
  if (!retry) {
    return null;
  }

  if (retry === true) {
    return {
      attempts: 2,
      backoffMs: 200,
      maxBackoffMs: 2_000,
      retryMethods: DEFAULT_RETRY_METHODS,
      retryOn: DEFAULT_RETRY_STATUS,
      shouldRetry: undefined,
    };
  }

  if (typeof retry === "number") {
    return {
      attempts: Math.max(0, retry),
      backoffMs: 200,
      maxBackoffMs: 2_000,
      retryMethods: DEFAULT_RETRY_METHODS,
      retryOn: DEFAULT_RETRY_STATUS,
      shouldRetry: undefined,
    };
  }

  return {
    attempts: Math.max(0, retry.attempts ?? 2),
    backoffMs: Math.max(0, retry.backoffMs ?? 200),
    maxBackoffMs: Math.max(0, retry.maxBackoffMs ?? 2_000),
    retryMethods: retry.retryMethods
      ? retry.retryMethods.map((method) => method.toUpperCase())
      : DEFAULT_RETRY_METHODS,
    retryOn: retry.retryOn ?? DEFAULT_RETRY_STATUS,
    shouldRetry: retry.shouldRetry,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getAbortErrorCode(
  externalSignal: AbortSignal | null,
  timeoutTriggered: boolean,
): { code: VenusErrorCode; status: number; message: string } {
  if (externalSignal?.aborted) {
    return {
      code: "ABORTED",
      status: 499,
      message: "Venus: Request was aborted.",
    };
  }

  if (timeoutTriggered) {
    return {
      code: "TIMEOUT",
      status: 408,
      message: "Venus: Request timed out.",
    };
  }

  return {
    code: "ABORTED",
    status: 499,
    message: "Venus: Request was aborted.",
  };
}

function buildFetchOptions(
  options: VenusOptions,
  scopeHeaders: Record<string, string>,
  timeout: number | undefined,
  registry: Set<AbortController>,
  serialized: SerializedBody,
): RequestBuildResult {
  const {
    responseType: _responseType,
    timeout: _timeout,
    params: _params,
    paramsArrayFormat: _paramsArrayFormat,
    retry: _retry,
    hooks: _hooks,
    onTelemetry: _onTelemetry,
    disableHeaders,
    defaults: _defaults,
    progress: _progress,
    metrics: _metrics,
    registry: _registry,
    signal,
    headers: rawHeaders,
    ...rest
  } = options;

  // Layer headers: scope (global or client) first, then per-request headers,
  // then explicit removals.
  let headers: Headers | undefined = buildHeaders(
    scopeHeaders,
    rawHeaders,
    disableHeaders,
  );

  // The auto-detected Content-Type only fills the gap: explicit headers win,
  // and a deliberately disabled Content-Type is respected.
  const contentTypeDisabled =
    disableHeaders?.some((name) => name.toLowerCase() === "content-type") ??
    false;
  if (serialized.contentType && !contentTypeDisabled && !headers?.has("Content-Type")) {
    headers ??= new Headers();
    headers.set("Content-Type", serialized.contentType);
  }

  // `rest` is a fresh object created by the destructuring above.
  const fetchOptions = rest as unknown as RequestInit & { duplex?: "half" };
  fetchOptions.body = serialized.body;
  if (headers) {
    fetchOptions.headers = headers;
  }
  if (serialized.stream) {
    fetchOptions.duplex = "half";
  }

  // Every attempt owns a controller: timeouts, the external `signal` and the
  // scope-wide `abort()` all funnel into it.
  const controller = new AbortController();
  registry.add(controller);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;

  if (signal?.aborted) {
    controller.abort();
  }

  if (typeof timeout === "number" && timeout > 0) {
    timer = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeout);
  }

  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  fetchOptions.signal = controller.signal;

  return {
    fetchOptions,
    clearTimeout: () => {
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onExternalAbort);
      registry.delete(controller);
    },
    timeoutTriggered: () => didTimeout,
  };
}

function statusError<T>(status: number, statusText: string): Bare<T> {
  return {
    data: null,
    ok: false,
    status,
    errorCode: "HTTP_ERROR",
    error: `Error ${status}: ${statusText}`,
  };
}

async function parseResponse<T>(
  response: Response,
  responseType: VenusResponseType,
): Promise<Bare<T>> {
  if (response.status === 204 || response.status === 205) {
    if (response.ok) {
      return {
        data: null as T,
        ok: true,
        status: response.status,
        errorCode: null,
        error: null,
      };
    }
    return statusError<T>(response.status, response.statusText);
  }

  const contentType = response.headers.get("content-type") || "";
  const expectsJson =
    responseType === "json" ||
    (responseType === "auto" &&
      (contentType.includes("application/json") ||
        contentType.includes("+json")));

  try {
    let data: unknown;

    if (expectsJson) {
      const raw = await response.text();
      data = raw.trim() ? JSON.parse(raw) : null;
    } else if (responseType === "blob") {
      data = await response.blob();
    } else if (responseType === "formData") {
      data = await response.formData();
    } else if (responseType === "arrayBuffer") {
      data = await response.arrayBuffer();
    } else if (responseType === "stream") {
      data = response.body;
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const baseError = statusError<T>(response.status, response.statusText);
      return {
        ...baseError,
        data: data as T,
      };
    }

    return {
      data: data as T,
      ok: true,
      status: response.status,
      errorCode: null,
      error: null,
    };
  } catch (err) {
    if (!expectsJson) {
      return {
        data: null,
        ok: false,
        status: response.status,
        errorCode: "UNKNOWN_ERROR",
        error:
          err instanceof Error
            ? `Venus: Could not read the response body. ${err.message}`
            : "Venus: Could not read the response body.",
      };
    }
    return {
      data: null,
      ok: false,
      status: response.status,
      errorCode: "JSON_PARSE_ERROR",
      error:
        err instanceof Error
          ? `Venus: The server returned an invalid JSON body. ${err.message}`
          : "Venus: The server returned an invalid JSON body.",
    };
  }
}

/** Parses `Retry-After` (seconds or HTTP date) into milliseconds. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Observers must never break a request: their errors are swallowed. */
function emitTelemetry(
  listeners: Array<(event: VenusTelemetryEvent) => void>,
  event: VenusTelemetryEvent,
): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // ignored on purpose
    }
  }
}

/**
 * Runs every `beforeRequest` hook in order (scope first, then request).
 * Each returned override is merged on top of the previous result.
 */
async function runBeforeRequest(
  hooksList: VenusHooks[],
  base: RequestInit,
  url: string,
  attempt: number,
): Promise<RequestInit> {
  let current = base;

  for (const hooks of hooksList) {
    if (!hooks.beforeRequest) {
      continue;
    }

    const hookOptions: Readonly<RequestInit> = {
      ...current,
      headers: current.headers ? new Headers(current.headers) : undefined,
    };
    const override = await hooks.beforeRequest({
      url,
      options: hookOptions,
      attempt,
    });

    if (override) {
      const merged: RequestInit & { disableHeaders?: string[] } = {
        ...current,
        ...override,
        headers: mergeHeaders(
          current.headers,
          override.headers,
          override.disableHeaders,
        ),
      };
      delete merged.disableHeaders;
      current = merged;
    }
  }

  return current;
}

function shouldRetry(
  retry: ParsedRetry | null,
  method: string,
  attempt: number,
  status: number | undefined,
  errorCode: VenusErrorCode | null,
): boolean {
  if (!retry || attempt > retry.attempts) {
    return false;
  }

  if (retry.shouldRetry) {
    try {
      return retry.shouldRetry({
        attempt,
        status,
        errorCode: errorCode ?? undefined,
      });
    } catch {
      return false;
    }
  }

  // Non-idempotent methods (POST/PATCH) are never repeated by default.
  if (!retry.retryMethods?.includes(method.toUpperCase())) {
    return false;
  }

  if (errorCode === "NETWORK_ERROR" || errorCode === "TIMEOUT") {
    return true;
  }

  if (status && retry.retryOn?.includes(status)) {
    return true;
  }

  return false;
}

/** Keeps defined entries only, preserving order (scope first, request last). */
function collect<A>(...items: Array<A | undefined>): A[] {
  return items.filter((item): item is A => item !== undefined);
}

/**
 * Resolves the effective configuration for one request.
 * Instance defaults (from `createClient`) fully replace the global
 * singleton scope, keeping instances independent and predictable.
 */
function resolveScope(options: VenusOptions): {
  baseURL: string;
  headers: Record<string, string>;
  timeout: number | undefined;
  retry: VenusConfigInput["retry"];
  metrics: boolean;
  legacy: VenusConfigInput["legacy"];
  hooks: VenusHooks[];
  telemetry: Array<(event: VenusTelemetryEvent) => void>;
} {
  const instance = options.defaults;

  if (instance) {
    return {
      baseURL: instance.baseURL ?? "",
      headers: instance.headers ?? {},
      timeout: options.timeout ?? instance.timeout,
      retry: options.retry ?? instance.retry,
      metrics: options.metrics ?? instance.metrics ?? false,
      legacy: instance.legacy,
      hooks: collect(instance.hooks, options.hooks),
      telemetry: collect(instance.onTelemetry, options.onTelemetry),
    };
  }

  const global = readConfig();

  return {
    baseURL: global.baseURL,
    headers: global.headers,
    timeout: options.timeout ?? global.timeout,
    retry: options.retry ?? global.retry,
    metrics: options.metrics ?? global.metrics ?? false,
    legacy: global.legacy,
    hooks: collect(global.hooks, options.hooks),
    telemetry: collect(global.onTelemetry, options.onTelemetry),
  };
}

/**
 * Core request engine for Venus.
 * Never throws: every outcome is a `VenusResponse` with `metrics` attached
 * when enabled for the scope or the request.
 */
export async function request<T>(
  path: string,
  options: VenusOptions = {},
): Promise<VenusResponse<T>> {
  const meta: RequestMeta = {
    enabled: false,
    engine: "fetch",
    attempts: 0,
    startedAt: Date.now(),
  };

  const response = await execute<T>(path, options, meta);

  return {
    ...response,
    metrics: meta.enabled
      ? {
          engine: meta.engine,
          startedAt: meta.startedAt,
          durationMs: Date.now() - meta.startedAt,
          attempts: meta.attempts,
        }
      : null,
  };
}

function failure(
  status: number,
  errorCode: VenusErrorCode,
  error: string,
): DistributiveOmit<VenusFailure, "metrics"> {
  return { data: null, ok: false, status, errorCode, error };
}

async function execute<T>(
  path: string,
  inputOptions: VenusOptions,
  meta: RequestMeta,
): Promise<Bare<T>> {
  if (!inputOptions.defaults && isInstanceMode()) {
    return failure(
      0,
      "MODE_CONFLICT",
      "Venus: the singleton API is disabled in instance mode.",
    );
  }

  const scope = resolveScope(inputOptions);

  // Configured scope (baseURL set) is closed: relative paths only.
  // Unconfigured scope lets absolute URLs through untouched.
  if (ABSOLUTE_URL.test(path) && scope.baseURL) {
    return failure(
      0,
      "INVALID_URL",
      "Venus: a baseURL is configured, so only relative paths are allowed.",
    );
  }

  let serialized: SerializedBody;
  try {
    serialized = serializeBody(inputOptions.body);
  } catch (err) {
    return failure(
      400,
      "INVALID_BODY",
      `Venus: Could not serialize the body. ${err instanceof Error ? err.message : ""}`.trim(),
    );
  }
  const options: VenusOptions = { ...inputOptions };

  const registry = options.registry ?? singletonRegistry;
  const responseType = options.responseType ?? "auto";
  // Streams cannot be replayed, so a streamed body is never retried.
  const retry = serialized.stream ? null : normalizeRetryConfig(scope.retry);
  const method = options.method ?? "GET";
  const url = composeUrl(path, options, scope.baseURL);
  const externalSignal = options.signal ?? null;

  // XHR is used when progress, metrics or the hidden legacy sync mode ask
  // for it (fetch has no upload progress without streams).
  const syncMode = Boolean(scope.legacy?.sync);
  if (
    syncMode &&
    (responseType === "blob" ||
      responseType === "arrayBuffer" ||
      responseType === "formData" ||
      responseType === "stream")
  ) {
    return failure(
      0,
      "UNSUPPORTED",
      "Venus: synchronous mode only supports text and json responses.",
    );
  }
  // Node has no XMLHttpRequest: metrics fall back to fetch (Venus measures
  // them itself), but progress and sync mode genuinely need XHR.
  const hasXHR = typeof XMLHttpRequest !== "undefined";
  if (!hasXHR && (options.progress || syncMode)) {
    return failure(
      0,
      "UNSUPPORTED",
      "Venus: progress and synchronous mode require XMLHttpRequest, which is not available in this environment.",
    );
  }
  const useXHR =
    hasXHR && (Boolean(options.progress) || scope.metrics || syncMode);
  meta.enabled = scope.metrics;
  meta.engine = useXHR ? "xhr" : "fetch";
  const direction: "upload" | "download" =
    useXHR && options.body != null && method !== "GET" && method !== "HEAD"
      ? "upload"
      : "download";

  for (let attempt = 0; ; attempt += 1) {
    meta.attempts = attempt + 1;
    let retryAfterMs: number | undefined;
    const build = buildFetchOptions(
      options,
      scope.headers,
      scope.timeout,
      registry,
      serialized,
    );
    let fetchOptions = build.fetchOptions;

    try {
      if (scope.hooks.some((hooks) => hooks.beforeRequest)) {
        fetchOptions = await runBeforeRequest(
          scope.hooks,
          fetchOptions,
          url,
          attempt,
        );
      }
    } catch (err) {
      build.clearTimeout?.();
      return failure(
        0,
        "UNKNOWN_ERROR",
        `Venus: beforeRequest hook failed. ${errorMessage(err)}`,
      );
    }

    const startedAt = Date.now();

    try {
      const response = useXHR
        ? await xhrRequest(url, fetchOptions, {
            responseType,
            progress: options.progress,
            direction,
            sync: syncMode,
          })
        : await fetch(url, fetchOptions);

      try {
        for (const hooks of scope.hooks) {
          await hooks.afterResponse?.({
            url,
            options: fetchOptions,
            response,
            durationMs: Date.now() - startedAt,
            attempt,
          });
        }
      } catch (err) {
        build.clearTimeout?.();
        return failure(
          response.status,
          "UNKNOWN_ERROR",
          `Venus: afterResponse hook failed. ${errorMessage(err)}`,
        );
      }

      retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const parsed = await parseResponse<T>(response, responseType);

      emitTelemetry(scope.telemetry, {
        url,
        method,
        ok: parsed.ok,
        status: parsed.status,
        durationMs: Date.now() - startedAt,
        attempt,
        errorCode: parsed.errorCode,
      });

      build.clearTimeout?.();

      if (!shouldRetry(retry, method, attempt + 1, parsed.status, parsed.errorCode)) {
        if (parsed.ok) {
          return parsed;
        }

        if (retry && attempt >= retry.attempts) {
          return {
            data: parsed.data,
            ok: false,
            status: parsed.status ?? 503,
            errorCode: "RETRY_EXHAUSTED",
            error: "Venus: Retry attempts exhausted.",
          };
        }
        return parsed;
      }
    } catch (err) {
      build.clearTimeout?.();

      const isAbort =
        err instanceof DOMException
          ? err.name === "AbortError"
          : err instanceof Error && err.name === "AbortError";

      if (isAbort) {
        const abortInfo = getAbortErrorCode(
          externalSignal,
          build.timeoutTriggered(),
        );
        const abortResponse: Bare<T> = {
          data: null,
          ok: false,
          status: abortInfo.status,
          errorCode: abortInfo.code,
          error: abortInfo.message,
        };

        emitTelemetry(scope.telemetry, {
          url,
          method,
          ok: false,
          status: abortResponse.status,
          durationMs: Date.now() - startedAt,
          attempt,
          errorCode: abortResponse.errorCode,
        });

        if (abortInfo.code === "ABORTED") {
          return abortResponse;
        }

        if (
          !shouldRetry(
            retry,
            method,
            attempt + 1,
            abortResponse.status,
            abortResponse.errorCode,
          )
        ) {
          return abortResponse;
        }
      } else {
        const networkResponse: Bare<T> = {
          data: null,
          ok: false,
          status: 0,
          errorCode: "NETWORK_ERROR",
          error:
            err instanceof Error
              ? `Venus: Network error. ${err.message}`
              : "Venus: Network error.",
        };

        emitTelemetry(scope.telemetry, {
          url,
          method,
          ok: false,
          status: networkResponse.status,
          durationMs: Date.now() - startedAt,
          attempt,
          errorCode: networkResponse.errorCode,
        });

        if (
          !shouldRetry(
            retry,
            method,
            attempt + 1,
            networkResponse.status,
            networkResponse.errorCode,
          )
        ) {
          if (retry && attempt >= retry.attempts) {
            return {
              data: null,
              ok: false,
              status: 503,
              errorCode: "RETRY_EXHAUSTED",
              error: "Venus: Retry attempts exhausted.",
            };
          }
          return networkResponse;
        }
      }
    }

    // Exponential backoff with jitter; a server `Retry-After` wins, capped.
    let backoff = retry
      ? Math.min(retry.backoffMs * 2 ** attempt, retry.maxBackoffMs)
      : 0;
    if (retry && backoff > 0) {
      backoff = backoff / 2 + (Math.random() * backoff) / 2;
    }
    if (retry && retryAfterMs !== undefined) {
      backoff = Math.min(retryAfterMs, retry.maxBackoffMs);
    }
    if (backoff > 0) {
      await delay(backoff);
    }
  }
}
