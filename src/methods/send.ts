import { request } from "../core/request.js";
import { VenusOptions, VenusResponse } from "../core/types.js";
import { emptyBodyResponse, isEmptyBody, withServerMessage } from "../utils/body.js";

/**
 * Performs a POST request. Empty payloads are rejected before any network call;
 * the body is auto-serialized with its Content-Type (see `VenusOptions.body`).
 * @param path - The endpoint (relative when a baseURL is configured).
 * @param body - The data payload to be sent.
 * @param options - Unified Venus options (headers, timeout, signal, params, parser, retry, hooks).
 */
export const send = async <T>(
  path: string,
  body: unknown,
  options: VenusOptions = {},
): Promise<VenusResponse<T>> => {
  if (isEmptyBody(body)) {
    return emptyBodyResponse("Venus: Cannot send an empty body.");
  }

  const response = await request<T>(path, { ...options, method: "POST", body });

  return response.ok
    ? response
    : withServerMessage(response, (message) => `Venus: ${message}`);
};
