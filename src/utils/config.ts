import type { VenusConfigInput, VenusRetryOptions } from "../core/types.js";

/**
 * Mutable global configuration store (Singleton scope).
 * Internal: only the request engine and the `venus` facade read/write it.
 */
const state: {
  baseURL: string;
  headers: Record<string, string>;
  timeout?: number;
  retry?: boolean | number | VenusRetryOptions;
} = {
  baseURL: "",
  headers: {},
};

/**
 * @internal
 * Returns the live global configuration used by the request engine.
 * Never mutated in place (replace semantics), so callers always see a
 * consistent snapshot for the lifetime of a request.
 */
export function readConfig(): typeof state {
  return state;
}

function normalizeBaseURL(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Declarative global configuration (Singleton mode).
 *
 * ```ts
 * import { venus } from "@braydev/venus";
 *
 * venus.config({ baseURL: "https://api.example.com", timeout: 8000 });
 *
 * const current = venus.config(); // read back the active config
 * venus.reset();                  // clear everything (e.g. on logout)
 * ```
 *
 * Merges only the provided keys; omitted keys keep their value.
 */
function config(options: VenusConfigInput): void;
function config(): VenusConfigInput;
function config(options?: VenusConfigInput): VenusConfigInput | void {
  if (options === undefined) {
    return {
      baseURL: state.baseURL,
      headers: { ...state.headers },
      timeout: state.timeout,
      retry: state.retry,
    };
  }

  if (options.baseURL !== undefined) {
    state.baseURL = normalizeBaseURL(options.baseURL);
  }
  if (options.headers !== undefined) {
    state.headers = { ...options.headers };
  }
  if (options.timeout !== undefined) {
    state.timeout = options.timeout;
  }
  if (options.retry !== undefined) {
    state.retry = options.retry;
  }
}

/** Clears every global setting (baseURL, headers, timeout and retry). */
function reset(): void {
  state.baseURL = "";
  state.headers = {};
  state.timeout = undefined;
  state.retry = undefined;
}

export const venus = { config, reset };
