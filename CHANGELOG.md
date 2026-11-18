# Changelog

All notable changes to this project will be documented in this file.

## [3.0.0] - 2026-11-18

### Added:

- **Declarative Singleton config**: `venus.config({ baseURL, headers, timeout, retry })` merges only the provided keys, `venus.config()` (no args) reads back the active configuration and `venus.reset()` clears everything. Global `timeout` and `retry` now apply to every standalone request and can be overridden per request.
- **Multi-client mode**: `createClient({ baseURL, headers, timeout, retry })` returns an independent, **immutable** client with `get`, `send`, `update`, `updateOnly`, `remove` and a read-only `config()` getter. Instances never read the global singleton config (precedence: per-request > instance > nothing).
- **`disableHeaders`**: per-request option (`disableHeaders: ["authorization"]`) removes inherited header names (case-insensitive) without touching the singleton/instance defaults.
- **Hybrid engine (`fetch` + `XMLHttpRequest`)**: `fetch` remains the default transport; providing a `progress` callback switches the request to XHR transparently — no flags required. Both engines normalize into the same `{ data, ok, status, error, errorCode }` contract, sharing timeouts, `AbortSignal`, hooks, telemetry and retries.
- **Unified progress callback**: `progress: ({ direction, loaded, percent }) => {}` reports the transfer automatically: requests that send a body report `direction: "upload"`, the rest report `direction: "download"`. `loaded` is a ready-to-print string (e.g. `"125.0KB / 523.0KB"`).
- Official bilingüe lema: *HTTP, without friction. / HTTP, sin fricción.*

- **Auto-serialized request bodies**: objects/arrays (JSON), strings (`text/plain`), `FormData`, `URLSearchParams`, `File`/`Blob`, `ArrayBuffer`/typed arrays and `ReadableStream` are detected and sent with the right `Content-Type`. An explicit `Content-Type` header always wins. Streams are sent with `duplex: "half"` and never retried. Unserializable bodies (e.g. circular) return `INVALID_BODY` instead of throwing.
- **`responseType: "stream"`**: returns `response.body` as a `ReadableStream`.
- **`metrics`**: `metrics: true` (per request, `venus.config` or `createClient`) fills `response.metrics` (`engine`, `startedAt`, `durationMs`, `attempts`) and switches the transport to XHR. The field is always present and `null` when disabled.
- **`abort()`**: `venus.abort()` and `client.abort()` cancel every in-flight request of that scope (`ABORTED`, status 499). Per-request `signal` keeps working.
- **Hidden legacy sync mode**: `venus.config({ legacy: { sync: true } })` runs a blocking synchronous XHR (text/json only; binary types return `UNSUPPORTED`). Intentionally undocumented in the README.
- **`UNSUPPORTED` error code**: returned for synchronous mode with binary response types, and for `progress`/synchronous mode in environments without `XMLHttpRequest` (e.g. Node). `metrics` still works there: it falls back to `fetch`.
- **Scope-wide interceptors**: `hooks` and `onTelemetry` are accepted by `venus.config` and `createClient`. They run before the per-request ones on every attempt (overrides are merged in order), so a client can inject a fresh auth token on each retry.
- **Narrowed response types**: `VenusResponse<T>` is now `VenusSuccess<T> | VenusFailure`. With `ok: true`, `data` is `T`; with `ok: false`, `data` is `unknown`. `VenusSuccess` and `VenusFailure` are exported.
- **`retryMethods`** option for `retry`, plus `Retry-After` support (seconds or HTTP date, capped by `maxBackoffMs`) and jitter on the exponential backoff.

### Removed (Breaking):

- **`getRss` and all RSS/Atom support**: Venus is now a specialized HTTP/HTTPS client with **zero dependencies** — `fast-xml-parser` was removed entirely (dependencies and dev dependencies) and no feed/parser code ships with the package.
- **RSS types**: `VenusRssFeed`, `VenusRssItem`, `VenusRssMediaContent`, `VenusRssMode` and `VenusRssOptions` were removed from the public API.
- **`venusConfig` legacy manager**: the granular API (`setBaseURL`, `setGlobalHeaders`, `getBaseURL`, `getGlobalHeaders`, `getTimeout`, `getRetry`, `reset`) was removed in favor of the single `venus` facade (`venus.config()` / `venus.reset()`).
- **`useXHR`, `onUploadProgress` and `onDownloadProgress`**: replaced by the single `progress` callback; engine selection and transfer direction are fully automatic.
- **`PARSING_ERROR`**: renamed to `JSON_PARSE_ERROR` so the code clearly reports an invalid JSON body returned by the server (message: *"The server returned an invalid JSON body"*).
- **Per-request `baseUrl` option**: removed. The API URL belongs in `baseURL` (`venus.config` / `createClient`).
- **Instance mutation**: `createClient()` clients are configured once at creation; the previous mutable `config(options)` and `reset()` are gone (only the read-only `config()` getter remains).

### Changed:

- **Closed scopes**: when a `baseURL` is configured (singleton or client) only relative paths are accepted and absolute URLs return `INVALID_URL`. With no configuration, absolute URLs pass straight through.
- **Response contract**: every response now carries `metrics` (`null` unless enabled) next to `data`, `ok`, `error`, `status` and `errorCode`.
- **String bodies** are sent as `text/plain` instead of `application/json` (send `JSON.stringify(...)` yourself only with an explicit JSON header, or pass the object).
- **Error messages**: `send`/`update` no longer duplicate the `Venus:` prefix; `RETRY_EXHAUSTED` keeps the last `data`; failing to read a non-JSON body reports `UNKNOWN_ERROR` instead of `JSON_PARSE_ERROR`.
- **Safe retries (behavior change)**: `POST` and `PATCH` are no longer retried by default, to avoid duplicating operations. Use `retryMethods` or `shouldRetry` to opt in.
- **Hooks never throw**: a throwing `beforeRequest`/`afterResponse` resolves as `UNKNOWN_ERROR` (no retry); errors from `onTelemetry`, `progress` and `shouldRetry` are ignored.
- **`remove`**: the redundant 204 branch was dropped; `204` resolves as `{ ok: true, data: null }` (type it as `remove<null>`).
- **Scope-wide cancellation**: every attempt now owns an `AbortController` (needed by `abort()`), so `signal` is always set on the fetch call.

- **Exclusive modes**: singleton and instance modes cannot be mixed. The first mode claimed (`venus.config` or `createClient`) locks the other: config calls throw and standalone `get/send/...` return `MODE_CONFLICT`.
- **Hook merge semantics**: whatever `beforeRequest` returns is merged into the request (headers combined, `disableHeaders` applied) instead of replacing it wholesale; the hook receives a read-only copy, so mutating `options` has no effect.
- **Scope-aware request engine**: header/timeout/retry/baseURL resolution was centralized in a config scope layer that serves both singleton and instance modes.
- **Leaner hot path**: abort plumbing (`AbortController`, listeners) and `Headers` merging are now only allocated when a request actually uses timeouts, signals, headers or bodies — fewer allocations per call without changing behavior.
- **Package**: version bumped to `3.0.0`, description updated to the official lema.

### Migration Notes:

- Retries on `POST`/`PATCH` are now opt-in: add `retryMethods: ["POST"]` (or a `shouldRetry`) if you relied on them.
- Failed responses type `data` as `unknown`; narrow it (e.g. `(res.data as ApiError)`) before reading the server's error body.

- Remove `getRss` imports: RSS/Atom support no longer exists in Venus; use a dedicated feed library.
- Replace the legacy config API: `venusConfig.setBaseURL(url)` → `venus.config({ baseURL: url })`, `setGlobalHeaders(h)` → `venus.config({ headers: h })`, `getGlobalHeaders()` → `venus.config().headers`, `reset()` → `venus.reset()`.
- Replace progress options: `onUploadProgress`/`onDownloadProgress`/`useXHR` → `progress: ({ direction, loaded, percent }) => {}` and handle both directions in the same callback.
- `PARSING_ERROR` → `JSON_PARSE_ERROR` if you match on error codes.
- Once you configure a `baseURL`, switch absolute URLs to relative paths: `get("https://api.com/users")` → `venus.config({ baseURL: "https://api.com" })` (or `createClient`) + `get("/users")`.
- Pick **one mode**: either `venus` + standalone methods, or `createClient()` clients. Mixing throws (`MODE_CONFLICT` for requests).
- Delete inherited headers per request with `disableHeaders: ["authorization"]` instead of removing them manually.
- `beforeRequest` should **return** `{ headers: { ... } }`; the result is merged. Mutating the received `options` no longer affects the request.

## [2.2.2] - 2026-10-05

### Changed:

- **Documentation & Consistency**: Updated README.MD to document the MIT License and maintain full consistency with the changelog.

## [2.2.1] - 2026-10-05

### Added:

- **MIT License**: Added official MIT License file and updated package configuration.

## [2.2.0] - 2026-08-08

### Added:

- **RSS/Atom item images**: `VenusRssItem` now exposes `enclosure`, `media`, and `image` fields, extracting images from RSS `<enclosure>`, Media RSS (`media:thumbnail`/`media:content`), Atom `<link rel="enclosure">`, and the first `<img>` inside the item HTML. Use `item.image` for a ready-to-use thumbnail or inspect `enclosure`/`media` for raw sources.
- **`RETRY_EXHAUSTED` error code**: when retries are exhausted, the final response reports `RETRY_EXHAUSTED` instead of a generic error, keeping the last HTTP status.

### Fixed:

- **Retry on last attempt**: a request that succeeded exactly on its final retry attempt was incorrectly reported as `RETRY_EXHAUSTED`; it now returns the successful response.
- **Content-Type for uploads**: `send`/`update` no longer force `application/json` on `FormData`, `Blob`, or `URLSearchParams` bodies, which broke multipart boundaries and binary uploads.

### Changed:

- Test suite consolidated into shared suites (`core`, `methods`, `resilience`, `rss`) with new coverage for item images and retry edge cases.
- README documents the new feed item fields under a "Feed Item Fields" section.

## [2.1.0] - 2026-05-04

### Added:

- **Global headers configuration**: `venusConfig.setGlobalHeaders(headers)` and `venusConfig.getGlobalHeaders()` allow setting headers applied to every request (per-request headers still override these). This simplifies auth and common metadata across your app.

### Changed:

- **Minor version bump** to reflect the new public API surface. Backwards compatible: existing behavior unchanged unless you opt into global headers.

### Notes:

- Per-request header keys take precedence over global headers when they collide.
- Consider updating your application entry point to set auth headers once (e.g., Authorization, X-Trace-Id).

## [2.0.1] - 2026-04-30

### Fixed:

Resolved a "Named Export" resolution error in production environments where getRss was inaccessible to modern ESM-first frameworks like Astro 5.

### Added:

Full ESM support by implementing `"type": "module"` and a comprehensive exports map in package.json.

### Changed:

Standardized output extensions to .js for ESM and .cjs for CommonJS to guarantee cross-environment stability.

### Improved:

Optimized build workflow using tsup, incorporating the --clean flag to ensure a pristine dist directory and prevent artifact persistence.

## [2.0.0] - 2026-04-18

### Added

- **Unified Request API:** Single interface for `get`, `send`, `update`, `updateOnly`, and `remove`.
- **Advanced Engine:** Full support for `timeout` and `AbortSignal`.
- **RSS/Atom Helper:** New `getRss` function with `strict` and `lenient` parsing modes.
- **Multi-format Parsing:** Support for `json`, `text`, `blob`, `formData`, and `arrayBuffer`.
- **Resilience:** Built-in retry policy with configurable backoff for transient failures.
- **Smart Serialization:** Query params support for arrays, objects, and multiple formats.
- **Lifecycle Hooks:** Added `beforeRequest` and `afterResponse` middlewares.
- **Metadata:** Typed responses including `errorCode` and optional `status`.

### Changed

- **Response Contract:** Normalized success and error handling across all methods.
- **Documentation:** Major README update with production examples for Frontend and Backend.

### Fixed

- **HTTP 204/205:** Improved handling of "No Content" responses.
- **Feed Normalization:** Better resilience for malformed XML and Atom item links.

### Breaking Changes

- **Signature Change:** HTTP methods now accept a unified **options object** instead of mixed positional arguments.
- **Response Structure:** Data is now wrapped in a contract that includes `errorCode`.

### Migration Notes

- Replace old positional arguments: `client.get(url, headers)` -> `client.get({ url, headers })`.

---

## [1.0.4] - 2026-02-14

- **Fixed:** Minor internal bug fixes and connection stability improvements.

## [1.0.2] - 2026-02-08

- **Changed:** Documentation and README structure improvements.

## [1.0.1] - 2026-02-06

- **Changed:** Initial README adjustments and project description.

## [1.0.0] - 2026-02-05

- **Initial Release:** Basic HTTPS wrapper for API requests.
