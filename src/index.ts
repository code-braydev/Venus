/**
 * Venus: HTTP, without friction.
 * A modern, zero-dependency HTTP client.
 * Designed by code-braydev.
 */

// Public types
export * from "./core/types.js";

// Singleton mode: venus.config(), venus.get(), venus.send(), ...
export { venus } from "./venus.js";

// Client mode (multi-clients): createClient().get(), ...
export { createClient } from "./methods/instance.js";
