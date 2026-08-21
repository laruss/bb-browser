import type { BbPluginApi } from "@patcher/plugin-sdk";

export default function contentScriptExample(bb: BbPluginApi) {
  bb.log.info("Content script example loaded");
}
