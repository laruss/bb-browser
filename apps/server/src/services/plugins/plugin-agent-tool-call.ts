/**
 * Running one agent tool, on whichever side its parameters can be checked.
 *
 * A tool's `parameters` may be a zod schema, and a zod schema is an object
 * full of functions: it does not cross a process boundary. What does cross is
 * what the registration already derived from it — the JSON Schema the model is
 * shown — so the plugin process keeps the validator and runs the check next to
 * the handler, exactly as the server does for a plugin loaded in-process.
 *
 * Both sides refuse bad arguments the same way, through `invalidAgentToolArguments`:
 * an `isError` result carrying the same sentence, which
 * `normalizeAgentToolResult` turns into the same wire response. Bad arguments
 * are the model's problem, not the plugin's, and the answer it gets should not
 * depend on where the tool happens to run.
 */

import type {
  PluginAgentToolContext,
  PluginAgentToolRecord,
  PluginAgentToolResult,
} from "./plugin-api.js";

/** The answer to arguments that do not fit the tool's parameters. */
export function invalidAgentToolArguments(
  name: string,
  problem: string,
): PluginAgentToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Invalid arguments for tool "${name}": ${problem}`,
      },
    ],
    isError: true,
  };
}

/**
 * Check the arguments, then run the tool. Used where the validator is: in the
 * plugin's process for a tool that lives there, and in the server for one that
 * does not.
 */
export async function runAgentToolCall(
  record: PluginAgentToolRecord,
  input: unknown,
  ctx: PluginAgentToolContext,
): Promise<PluginAgentToolResult> {
  const parsed = record.parse(input);
  if (!parsed.ok) return invalidAgentToolArguments(record.name, parsed.error);
  return record.execute(parsed.value, ctx);
}
