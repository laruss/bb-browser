import type { PatcherPluginApi } from "@patcher/plugin-sdk";

export type AutomationSignalKind =
  | "automations-changed"
  | "automation-runs-changed";

export function publishAutomationChange(
  bb: Pick<PatcherPluginApi, "realtime">,
  projectId: string,
  kinds: AutomationSignalKind | AutomationSignalKind[],
): void {
  for (const kind of Array.isArray(kinds) ? kinds : [kinds]) {
    bb.realtime.publish("automations", { projectId, kind });
  }
}
