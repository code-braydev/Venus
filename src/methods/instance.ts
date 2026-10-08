import { get } from "./get.js";
import { send } from "./send.js";
import { remove } from "./remove.js";
import { update, updateOnly } from "./update.js";
import type { VenusConfigInput, VenusInstance, VenusOptions } from "../core/types.js";

/** Keeps instance base URLs clean (no trailing slash) for predictable joins. */
function normalizeConfig(config: VenusConfigInput): VenusConfigInput {
  if (typeof config.baseURL === "string" && config.baseURL.endsWith("/")) {
    return { ...config, baseURL: config.baseURL.slice(0, -1) };
  }
  return { ...config };
}

/**
 * Creates an independent Venus client with its own defaults.
 *
 * ```ts
 * import { createInstance } from "@braydev/venus";
 *
 * const api = createInstance({
 *   baseURL: "https://api.example.com",
 *   headers: { Authorization: "Bearer token" },
 *   timeout: 8000,
 * });
 *
 * const { data } = await api.get<User>("/profile");
 * ```
 *
 * Instances never read the global singleton config (`venus.config`),
 * and per-request options always override the instance defaults.
 *
 * @param defaults - Initial defaults for the instance (baseURL, headers, timeout, retry).
 */
export function createInstance(defaults: VenusConfigInput = {}): VenusInstance {
  let config: VenusConfigInput = normalizeConfig(defaults);

  const withDefaults = (options: VenusOptions): VenusOptions => ({
    ...options,
    defaults: config,
  });

  return {
    get: <T,>(path: string, options: VenusOptions = {}) =>
      get<T>(path, withDefaults(options)),
    send: <T,>(path: string, body: unknown, options: VenusOptions = {}) =>
      send<T>(path, body, withDefaults(options)),
    update: <T,>(path: string, body: unknown, options: VenusOptions = {}) =>
      update<T>(path, body, withDefaults(options)),
    updateOnly: <T,>(path: string, body: unknown, options: VenusOptions = {}) =>
      updateOnly<T>(path, body, withDefaults(options)),
    remove: <T,>(path: string, options: VenusOptions = {}) =>
      remove<T>(path, withDefaults(options)),
    config: (options: VenusConfigInput = {}) => {
      config = normalizeConfig({ ...config, ...options });
    },
  };
}
