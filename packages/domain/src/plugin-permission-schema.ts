/**
 * The zod form of a plugin permission, kept away from the list itself.
 *
 * `plugin-permissions.ts` is in the startup path of **every plugin process** —
 * the permission gate reads its tables — and it needed zod for exactly this one
 * line. Constructing zod costs ~9MB resident, which a plugin with no settings,
 * no agent tool and no browser use was paying for a schema it never touched.
 * Split, that module is a zod-free set of constants and pure functions, and the
 * schema is imported by the two validators that were always going to load zod
 * anyway (the manifest parser and the server contract).
 *
 * See apps/server/scripts/measure-plugin-host.mjs for the measurement.
 */

import { z } from "zod";
import { PLUGIN_PERMISSIONS } from "./plugin-permissions.js";

export const pluginPermissionSchema = z.enum(PLUGIN_PERMISSIONS);
