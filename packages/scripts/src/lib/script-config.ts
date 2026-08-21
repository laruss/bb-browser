import {
  resolveRuntimeMode,
  type BbRuntimeMode,
} from "@patcher/config/runtime";

// Matches @patcher/config runtime mode resolution: anything other than "production"
// is treated as dev. Keeping scripts and runtime config in sync is
// load-bearing because they derive the same data dir, ports, and server URL.
export function resolveScriptMode(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): BbRuntimeMode {
  return resolveRuntimeMode(nodeEnv);
}

export function resolveNodeEnvironment(
  mode: BbRuntimeMode,
): "development" | "production" {
  return mode === "dev" ? "development" : "production";
}
