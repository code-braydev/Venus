# Changelog

All notable changes to this project will be documented in this file.

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
