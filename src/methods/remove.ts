import { request } from "../core/request.js";
import { VenusOptions, VenusResponse } from "../core/types.js";
import { withServerMessage } from "../utils/body.js";

/**
 * Performs a DELETE request to remove a specific resource.
 * A `204 No Content` answer resolves as `{ ok: true, data: null }`
 * (type the call as `remove<null>(...)`); failures surface the server message.
 * @param path - The endpoint of the resource to be deleted.
 * @param options - Unified Venus options (headers, timeout, signal, params, parser, retry, hooks).
 */
export const remove = async <T>(
  path: string,
  options: VenusOptions = {},
): Promise<VenusResponse<T>> => {
  const response = await request<T>(path, {
    ...options,
    method: "DELETE",
  });

  return response.ok
    ? response
    : withServerMessage(
        response,
        (message) => `Venus: Delete operation failed. ${message}`,
      );
};
