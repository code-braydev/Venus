/**
 * Venus: HTTP, without friction.
 * A modern, zero-dependency HTTP client.
 * Designed by code-braydev.
 */

// Export core logic and configuration
export * from "./core/types.js";
export { venus } from "./utils/config.js";

// Export instance mode (multi-clients)
export { createInstance } from "./methods/instance.js";

// Export primary network methods
export { get } from "./methods/get.js";
export { send } from "./methods/send.js";
export { remove } from "./methods/remove.js";
export { update, updateOnly } from "./methods/update.js";
