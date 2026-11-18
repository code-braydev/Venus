import { get } from "./methods/get.js";
import { send } from "./methods/send.js";
import { remove } from "./methods/remove.js";
import { update, updateOnly } from "./methods/update.js";
import { abort, config, reset } from "./utils/config.js";
import type { VenusSingleton } from "./core/types.js";

/**
 * Global client (singleton mode).
 *
 * ```ts
 * import { venus } from "@braydev/venus";
 *
 * venus.config({ baseURL: "https://api.example.com", timeout: 8000 });
 * const { data } = await venus.get<User>("/profile");
 * ```
 *
 * Exclusive with `createClient()`: once one mode is claimed, the other is
 * disabled for the life of the process.
 */
export const venus: VenusSingleton = {
  config,
  reset,
  abort,
  get,
  send,
  update,
  updateOnly,
  remove,
};
