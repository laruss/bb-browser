import { defineWorkspaceTestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-omnibox-agent",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
