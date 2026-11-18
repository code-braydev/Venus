import { get } from "./get.js";
import { send } from "./send.js";
import { remove } from "./remove.js";
import { update, updateOnly } from "./update.js";
import { abortAll, claimInstanceMode } from "../utils/config.js";
import type { VenusConfigInput, VenusClient, VenusOptions } from "../core/types.js";

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
 * import { createClient } from "@braydev/venus";
 *
 * const api = createClient({
 *   baseURL: "https://api.example.com",
 *   headers: { Authorization: "Bearer token" },
 *   timeout: 8000,
 * });
 *
 * const { data } = await api.get<User>("/profile");
 * ```
 *
 * Clients are immutable: `config({ ... })` is not available, only the
 * read-only `config()` getter plus `abort()` to cancel in-flight requests. Creating a client locks Venus into
 * instance mode, so the singleton `venus` facade becomes unavailable.
 *
 * @param defaults - Initial defaults for the client (baseURL, headers, timeout, retry, metrics).
 */
export function createClient(defaults: VenusConfigInput = {}): VenusClient {
  claimInstanceMode();

  const config = normalizeConfig(defaults);
  const registry = new Set<AbortController>();

  const withDefaults = (options: VenusOptions): VenusOptions => ({
    ...options,
    defaults: config,
    registry,
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
    config: () => ({
      baseURL: config.baseURL,
      headers: config.headers ? { ...config.headers } : undefined,
      timeout: config.timeout,
      retry:
        typeof config.retry === "object" && config.retry !== null
          ? { ...config.retry }
          : config.retry,
      metrics: config.metrics,
      hooks: config.hooks ? { ...config.hooks } : undefined,
      onTelemetry: config.onTelemetry,
      legacy: config.legacy ? { ...config.legacy } : undefined,
    }),
    abort: () => abortAll(registry),
  };
}
