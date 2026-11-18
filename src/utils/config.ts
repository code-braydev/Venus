import type {
  VenusConfigInput,
  VenusHooks,
  VenusRetryOptions,
  VenusTelemetryEvent,
} from "../core/types.js";

type VenusMode = "singleton" | "instance" | null;

const SINGLETON_DISABLED =
  "Venus: the singleton API is disabled while instance mode is active. Use createClient() only.";
const INSTANCE_DISABLED =
  "Venus: clients cannot be created after venus.config(). Use only one mode.";

/**
 * Mutable global configuration store (Singleton scope).
 * Internal: only the request engine and the `venus` facade read/write it.
 */
const state: {
  baseURL: string;
  headers: Record<string, string>;
  timeout?: number;
  retry?: boolean | number | VenusRetryOptions;
  metrics?: boolean;
  hooks?: VenusHooks;
  onTelemetry?: (event: VenusTelemetryEvent) => void;
  legacy?: { sync?: boolean };
} = {
  baseURL: "",
  headers: {},
};

/** In-flight requests of the singleton scope, cancellable through `venus.abort()`. */
export const singletonRegistry = new Set<AbortController>();

/** @internal Aborts every controller of a scope registry. */
export function abortAll(registry: Set<AbortController>): void {
  for (const controller of [...registry]) {
    controller.abort();
  }
  registry.clear();
}

/** Tracks the active configuration mode so both modes never mix. */
let mode: VenusMode = null;

/**
 * @internal
 * Locks (or validates) singleton mode.
 * Throws when instances have already claimed the process.
 */
export function claimSingletonMode(): void {
  if (mode === "instance") {
    throw new Error(SINGLETON_DISABLED);
  }
  mode = "singleton";
}

/**
 * @internal
 * Locks (or validates) instance mode.
 * Throws when the singleton facade has already been configured.
 */
export function claimInstanceMode(): void {
  if (mode === "singleton") {
    throw new Error(INSTANCE_DISABLED);
  }
  mode = "instance";
}

/**
 * @internal
 * Returns true when `createClient()` has claimed the process.
 */
export function isInstanceMode(): boolean {
  return mode === "instance";
}

/**
 * @internal
 * Throws when the singleton API is used while instance mode is active.
 */
export function assertSingletonAllowed(): void {
  if (mode === "instance") {
    throw new Error(SINGLETON_DISABLED);
  }
}

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
    assertSingletonAllowed();
    return {
      baseURL: state.baseURL,
      headers: { ...state.headers },
      timeout: state.timeout,
      retry: state.retry,
      metrics: state.metrics,
      hooks: state.hooks ? { ...state.hooks } : undefined,
      onTelemetry: state.onTelemetry,
      legacy: state.legacy ? { ...state.legacy } : undefined,
    };
  }

  claimSingletonMode();

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
  if (options.metrics !== undefined) {
    state.metrics = options.metrics;
  }
  if (options.hooks !== undefined) {
    state.hooks = { ...options.hooks };
  }
  if (options.onTelemetry !== undefined) {
    state.onTelemetry = options.onTelemetry;
  }
  if (options.legacy !== undefined) {
    state.legacy = { ...options.legacy };
  }
}

/** Clears every global setting (baseURL, headers, timeout, retry, metrics, hooks). */
function reset(): void {
  claimSingletonMode();
  state.baseURL = "";
  state.headers = {};
  state.timeout = undefined;
  state.retry = undefined;
  state.metrics = undefined;
  state.hooks = undefined;
  state.onTelemetry = undefined;
  state.legacy = undefined;
}

/** Aborts every in-flight singleton request (they resolve as `ABORTED`). */
function abort(): void {
  assertSingletonAllowed();
  abortAll(singletonRegistry);
}

export const venus = { config, reset, abort };
