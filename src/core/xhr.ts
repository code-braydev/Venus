import type {
  VenusProgress,
  VenusProgressCallback,
  VenusResponseType,
} from "./types.js";

export interface XhrTransportOptions {
  /** Desired body parser; determines the XHR responseType used on the wire. */
  responseType: VenusResponseType;
  /** Unified progress callback, when provided. */
  progress?: VenusProgressCallback;
  /** Transfer direction detected by the engine (body -> upload, else download). */
  direction: "upload" | "download";
}

/**
 * Maps a Venus response type to an XMLHttpRequest responseType.
 * Text-based parsers stay in text mode so Venus keeps full control of
 * JSON/FormData parsing and error reporting.
 */
function xhrResponseTypeFor(responseType: VenusResponseType): "" | "blob" | "arraybuffer" {
  if (responseType === "blob") {
    return "blob";
  }
  if (responseType === "arrayBuffer") {
    return "arraybuffer";
  }
  if (responseType === "formData") {
    // Multipart bodies are binary-safe as blobs; Venus parses the FormData.
    return "blob";
  }
  return "";
}

/** Formats a byte count into a short human-readable unit (B/KB/MB/GB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  }
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

function toProgress(
  event: ProgressEvent,
  direction: "upload" | "download",
): VenusProgress {
  const computable =
    event.lengthComputable &&
    Number.isFinite(event.total) &&
    event.total > 0;

  const total = computable ? event.total : null;
  const loaded =
    total !== null
      ? `${formatBytes(event.loaded)} / ${formatBytes(total)}`
      : formatBytes(event.loaded);

  return {
    direction,
    loaded,
    percent:
      total !== null ? Math.min(100, Math.round((event.loaded / total) * 100)) : null,
  };
}

function parseResponseHeaders(xhr: XMLHttpRequest): Headers {
  const headers = new Headers();
  const raw = xhr.getAllResponseHeaders();

  if (!raw) {
    return headers;
  }

  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      headers.append(
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      );
    }
  }

  return headers;
}

/**
 * Performs a request through XMLHttpRequest and normalizes the outcome
 * into a standard `Response`, so both engines share one parsing pipeline.
 *
 * Enables detailed metrics: upload/download progress and transparent
 * abort/timeout handling driven by the same AbortSignal used with fetch.
 */
export function xhrRequest(
  url: string,
  init: RequestInit,
  options: XhrTransportOptions,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    if (typeof XMLHttpRequest === "undefined") {
      reject(
        new Error("XMLHttpRequest is not available in this environment."),
      );
      return;
    }

    const xhr = new XMLHttpRequest();
    const method = (init.method ?? "GET").toUpperCase();
    const signal = init.signal ?? null;

    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    xhr.open(method, url, true);

    const headers = new Headers(init.headers ?? undefined);
    headers.forEach((value, key) => {
      try {
        xhr.setRequestHeader(key, value);
      } catch {
        // Forbidden header names are ignored, matching fetch behavior.
      }
    });

    if (init.credentials === "include") {
      xhr.withCredentials = true;
    }

    const responseType = xhrResponseTypeFor(options.responseType);
    if (responseType) {
      xhr.responseType = responseType;
    }

    const onAbortSignal = () => xhr.abort();

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbortSignal);
    };

    if (signal) {
      signal.addEventListener("abort", onAbortSignal, { once: true });
    }

    xhr.onload = () => {
      cleanup();

      try {
        const status = xhr.status;
        const statusText = xhr.statusText || "";
        const responseHeaders = parseResponseHeaders(xhr);
        const bodyless = status === 204 || status === 205 || status === 304;

        let body: BodyInit | null = null;
        if (!bodyless) {
          body =
            responseType === ""
              ? xhr.responseText
              : (xhr.response as BodyInit);
        }

        resolve(
          new Response(body, { status, statusText, headers: responseHeaders }),
        );
      } catch (err) {
        reject(err);
      }
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error("Network request failed."));
    };

    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new DOMException("Timeout", "TimeoutError"));
    };

    const body = (init.body ?? null) as
      | Document
      | XMLHttpRequestBodyInit
      | null;
    const isUpload = options.direction === "upload" && body !== null;

    if (options.progress && isUpload && xhr.upload) {
      xhr.upload.onprogress = (event) =>
        options.progress?.(toProgress(event, "upload"));
    }

    if (options.progress && !isUpload) {
      xhr.onprogress = (event) =>
        options.progress?.(toProgress(event, "download"));
    }

    try {
      xhr.send(method === "GET" || method === "HEAD" ? null : body);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
