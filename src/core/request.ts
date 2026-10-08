import {
  ParamsArrayFormat,
  VenusConfigInput,
  VenusErrorCode,
  VenusOptions,
  VenusResponse,
  VenusResponseType,
  VenusRetryOptions,
} from "./types.js";
import { readConfig } from "../utils/config.js";
import { xhrRequest } from "./xhr.js";

const DEFAULT_RETRY_STATUS = [408, 429, 500, 502, 503, 504];

type ParsedRetry = Required<
  Pick<VenusRetryOptions, "attempts" | "backoffMs" | "maxBackoffMs">
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

function composeUrl(path: string, options: VenusOptions, baseURL: string): string {
  const rootUrl = path.startsWith("http")
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
      retryOn: DEFAULT_RETRY_STATUS,
      shouldRetry: undefined,
    };
  }

  if (typeof retry === "number") {
    return {
      attempts: Math.max(0, retry),
      backoffMs: 200,
      maxBackoffMs: 2_000,
      retryOn: DEFAULT_RETRY_STATUS,
      shouldRetry: undefined,
    };
  }

  return {
    attempts: Math.max(0, retry.attempts ?? 2),
    backoffMs: Math.max(0, retry.backoffMs ?? 200),
    maxBackoffMs: Math.max(0, retry.maxBackoffMs ?? 2_000),
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
): RequestBuildResult {
  const {
    responseType: _responseType,
    timeout: _timeout,
    params: _params,
    paramsArrayFormat: _paramsArrayFormat,
    retry: _retry,
    hooks: _hooks,
    onTelemetry: _onTelemetry,
    baseUrl: _baseUrl,
    defaults: _defaults,
    progress: _progress,
    signal,
    headers: rawHeaders,
    ...rest
  } = options;

  // Layer headers: scope (global or instance) first, per-request on top.
  // Allocations only happen when headers actually exist on that layer.
  let headers: Headers | undefined =
    Object.keys(scopeHeaders).length > 0 ? new Headers(scopeHeaders) : undefined;

  if (rawHeaders) {
    const requestHeaders = new Headers(rawHeaders as HeadersInit);
    if (headers) {
      const base = headers;
      requestHeaders.forEach((value, key) => base.set(key, value));
    } else {
      headers = requestHeaders;
    }
  }

  const hasBody = rest.body !== undefined && rest.body !== null;

  // Only default to JSON when the body is not a native fetch type.
  // Setting application/json on FormData/Blob/URLSearchParams breaks
  // multipart boundaries and binary uploads.
  if (
    hasBody &&
    !(rest.body instanceof FormData) &&
    !(rest.body instanceof Blob) &&
    !(rest.body instanceof URLSearchParams)
  ) {
    if (!headers) {
      headers = new Headers();
    }
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  // `rest` is a fresh object created by the destructuring above.
  const fetchOptions: RequestInit = rest;
  if (headers) {
    fetchOptions.headers = headers;
  }

  const wantsTimeout = typeof timeout === "number" && timeout > 0;

  // Fast path: no timeout and no external signal means no abort plumbing
  // at all (saves AbortControllers/listeners on the common request).
  if (!signal && !wantsTimeout) {
    return {
      fetchOptions,
      timeoutTriggered: () => false,
    };
  }

  const signalController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;
  let externalAbortListener: (() => void) | undefined;

  if (signal?.aborted) {
    signalController.abort();
  }

  if (wantsTimeout) {
    timer = setTimeout(() => {
      didTimeout = true;
      signalController.abort();
    }, timeout);
  }

  if (signal) {
    externalAbortListener = () => {
      if (signal.aborted) {
        signalController.abort();
      }
    };
    signal.addEventListener("abort", externalAbortListener, { once: true });
  }

  fetchOptions.signal = signalController.signal;

  return {
    fetchOptions,
    clearTimeout: () => {
      if (timer) {
        clearTimeout(timer);
      }
      if (signal && externalAbortListener) {
        signal.removeEventListener("abort", externalAbortListener);
      }
    },
    timeoutTriggered: () => didTimeout,
  };
}

function statusError<T>(status: number, statusText: string): VenusResponse<T> {
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
): Promise<VenusResponse<T>> {
  if (response.status === 204 || response.status === 205) {
    return {
      data: null,
      ok: response.ok,
      status: response.status,
      errorCode: response.ok ? null : "HTTP_ERROR",
      error: response.ok
        ? null
        : `Error ${response.status}: ${response.statusText}`,
    };
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

function shouldRetry(
  retry: ParsedRetry | null,
  attempt: number,
  status: number | undefined,
  errorCode: VenusErrorCode | null,
): boolean {
  if (!retry || attempt > retry.attempts) {
    return false;
  }

  if (retry.shouldRetry) {
    return retry.shouldRetry({
      attempt,
      status,
      errorCode: errorCode ?? undefined,
    });
  }

  if (errorCode === "NETWORK_ERROR" || errorCode === "TIMEOUT") {
    return true;
  }

  if (status && retry.retryOn?.includes(status)) {
    return true;
  }

  return false;
}

/**
 * Resolves the effective configuration for one request.
 * Instance defaults (from `createInstance`) fully replace the global
 * singleton scope, keeping instances independent and predictable.
 */
function resolveScope(options: VenusOptions): {
  baseURL: string;
  headers: Record<string, string>;
  timeout: number | undefined;
  retry: VenusConfigInput["retry"];
} {
  const instance = options.defaults;

  if (instance) {
    return {
      baseURL: options.baseUrl ?? instance.baseURL ?? "",
      headers: instance.headers ?? {},
      timeout: options.timeout ?? instance.timeout,
      retry: options.retry ?? instance.retry,
    };
  }

  const global = readConfig();

  return {
    baseURL: options.baseUrl ?? global.baseURL,
    headers: global.headers,
    timeout: options.timeout ?? global.timeout,
    retry: options.retry ?? global.retry,
  };
}

/**
 * Core request engine for Venus.
 * Handles URL assembly, header injection, config scoping and multi-format
 * response parsing through the hybrid fetch/XHR transport.
 */
export async function request<T>(
  path: string,
  options: VenusOptions = {},
): Promise<VenusResponse<T>> {
  const responseType = options.responseType ?? "auto";
  const scope = resolveScope(options);
  const retry = normalizeRetryConfig(scope.retry);
  const method = options.method ?? "GET";
  const url = composeUrl(path, options, scope.baseURL);
  const externalSignal = options.signal ?? null;

  // The progress callback implies the XHR engine (fetch has no upload
  // progress without streams). Direction is detected automatically:
  // a request that sends a body reports upload, the rest report download.
  const useXHR = Boolean(options.progress);
  const direction: "upload" | "download" =
    useXHR && options.body != null && method !== "GET" && method !== "HEAD"
      ? "upload"
      : "download";

  for (let attempt = 0; ; attempt += 1) {
    const build = buildFetchOptions(options, scope.headers, scope.timeout);
    let fetchOptions = build.fetchOptions;

    if (options.hooks?.beforeRequest) {
      const maybeOverride = await options.hooks.beforeRequest({
        url,
        options: fetchOptions,
        attempt,
      });
      if (maybeOverride) {
        fetchOptions = maybeOverride;
      }
    }

    const startedAt = Date.now();

    try {
      const response = useXHR
        ? await xhrRequest(url, fetchOptions, {
            responseType,
            progress: options.progress,
            direction,
          })
        : await fetch(url, fetchOptions);

      if (options.hooks?.afterResponse) {
        await options.hooks.afterResponse({
          url,
          options: fetchOptions,
          response,
          durationMs: Date.now() - startedAt,
          attempt,
        });
      }

      const parsed = await parseResponse<T>(response, responseType);

      options.onTelemetry?.({
        url,
        method,
        ok: parsed.ok,
        status: parsed.status,
        durationMs: Date.now() - startedAt,
        attempt,
        errorCode: parsed.errorCode,
      });

      build.clearTimeout?.();

      if (!shouldRetry(retry, attempt + 1, parsed.status, parsed.errorCode)) {
        if (parsed.ok) {
          return parsed;
        }

        if (retry && attempt >= retry.attempts) {
          return {
            data: null,
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
        const abortResponse: VenusResponse<T> = {
          data: null,
          ok: false,
          status: abortInfo.status,
          errorCode: abortInfo.code,
          error: abortInfo.message,
        };

        options.onTelemetry?.({
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
            attempt + 1,
            abortResponse.status,
            abortResponse.errorCode,
          )
        ) {
          return abortResponse;
        }
      } else {
        const networkResponse: VenusResponse<T> = {
          data: null,
          ok: false,
          status: 0,
          errorCode: "NETWORK_ERROR",
          error:
            err instanceof Error
              ? `Venus: Network error. ${err.message}`
              : "Venus: Network error.",
        };

        options.onTelemetry?.({
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

    const backoff = retry
      ? Math.min(retry.backoffMs * 2 ** attempt, retry.maxBackoffMs)
      : 0;
    if (backoff > 0) {
      await delay(backoff);
    }
  }
}
