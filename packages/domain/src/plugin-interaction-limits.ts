/**
 * Limits on what a plugin may ask the user, without the schemas that enforce
 * them.
 *
 * `pending-interactions.ts` is 500 lines of zod covering every kind of pending
 * interaction the product has; `plugin-api.ts` wanted one number out of it and
 * paid ~14MB resident in every plugin process for the privilege. The number
 * lives here, the schema that applies it imports it from here, and the plugin
 * host loads nothing else.
 *
 * See apps/server/scripts/measure-plugin-host.mjs.
 */

export const PLUGIN_INTERACTION_MAX_TITLE_LENGTH = 160;
