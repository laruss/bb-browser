import type { PatcherPluginApi } from "@patcher/plugin-sdk";

export default function contentScriptExample(bb: PatcherPluginApi) {
  bb.log.info("Content script example loaded");
}
