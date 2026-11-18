import type { VenusFailure } from "../core/types.js";

/** Body types that fetch/XHR accept natively and must never be JSON-encoded. */
function isNativeBody(body: unknown): body is BodyInit {
  return (
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
  );
}

/** True for payloads that carry nothing: null, "", {} and []. */
export function isEmptyBody(body: unknown): boolean {
  if (body === null || body === undefined || body === "") {
    return true;
  }
  if (isNativeBody(body)) {
    return false;
  }
  if (Array.isArray(body)) {
    return body.length === 0;
  }
  if (typeof body === "object") {
    return Object.keys(body as object).length === 0;
  }
  return false;
}

export function emptyBodyResponse(message: string): VenusFailure {
  return {
    data: null,
    ok: false,
    status: 400,
    errorCode: "INVALID_BODY",
    error: message,
    metrics: null,
  };
}

export type SerializedBody = {
  body: BodyInit | undefined;
  /** Content-Type to apply when the caller did not set one. */
  contentType?: string;
  /** Streams cannot be replayed: no retries and `duplex: "half"` is required. */
  stream: boolean;
};

/**
 * Auto-detects the payload type and serializes it.
 * FormData and URLSearchParams get no explicit Content-Type: the runtime adds
 * the right one (multipart boundary / urlencoded charset).
 * Throws a TypeError when the value cannot be serialized.
 */
export function serializeBody(body: unknown): SerializedBody {
  if (body === null || body === undefined) {
    return { body: undefined, stream: false };
  }
  if (typeof body === "string") {
    return { body, contentType: "text/plain;charset=UTF-8", stream: false };
  }
  if (body instanceof FormData || body instanceof URLSearchParams) {
    return { body, stream: false };
  }
  if (body instanceof Blob) {
    return {
      body,
      contentType: body.type || "application/octet-stream",
      stream: false,
    };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return {
      body: body as BodyInit,
      contentType: "application/octet-stream",
      stream: false,
    };
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return {
      body: body as BodyInit,
      contentType: "application/octet-stream",
      stream: true,
    };
  }

  const json = JSON.stringify(body);
  if (json === undefined) {
    throw new TypeError("The body cannot be serialized to JSON.");
  }
  return { body: json, contentType: "application/json", stream: false };
}

/**
 * Prefers the server-provided `message` over the generic client error,
 * without duplicating the `Venus:` prefix.
 */
export function withServerMessage(
  response: VenusFailure,
  format: (message: string) => string,
): VenusFailure {
  const serverMessage = (response.data as { message?: unknown } | null)?.message;
  if (typeof serverMessage === "string" && serverMessage) {
    return { ...response, error: format(serverMessage) };
  }
  return response;
}
