// bb-plugin-omnibox-agent — the `browser.omnibox.providers` example (no frontend).
//
// Type into the browser surface's omnibox and this plugin adds two kinds of row
// to the same ranked list the browser fills with address, search, open-tab and
// history rows:
//
//   - "Ask an agent: <query>"     → a `run` action: spawns a BB thread with the
//                                   query as its prompt and opens that thread in
//                                   the tab the omnibox was used from.
//   - "Search GitHub for <query>" → a `navigate` action, resolved by the browser
//                                   without calling back into the plugin.
//
// Surfaces demonstrated: bb.browser.registerOmniboxProvider (both action kinds),
// a `project` setting with bb.status.needsConfiguration, bb.sdk.threads.spawn
// with plugin attribution, and bb.server.loopbackBaseUrl to point the browser at
// the BB app the plugin itself runs inside.
//
// The type-only import is erased at load time; this file runs as-is.
import type { BbPluginApi } from "@bb/plugin-sdk";

const CONFIGURE_HINT =
  "Set project with `bb plugin config omnibox-agent`, " +
  "then `bb plugin reload omnibox-agent`.";

/** The one item id this provider's `run` action answers to. */
const ASK_ITEM_ID = "ask";

function githubSearchUrl(query: string): string {
  return `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    project: {
      type: "project",
      label: "BB project for omnibox asks",
      description: '"Ask an agent" spawns threads in this project.',
    },
  });

  // Unconfigured is a first-class state: the navigate row still works, so the
  // plugin is useful before anyone touches its settings.
  const initial = await settings.get();
  if (!initial.project) {
    bb.status.needsConfiguration(CONFIGURE_HINT);
  }

  bb.browser.registerOmniboxProvider({
    // Wire item ids are "<providerId>:<item id>", so rows read as
    // "agent:ask" / "agent:github".
    id: "agent",
    // Shown as the row's source, so a user can tell a plugin row from the
    // browser's own.
    label: "Agent",
    async suggest({ query }) {
      // Read settings per call rather than closing over the load-time value:
      // they can change without a reload.
      const current = await settings.get();
      return [
        // Above the site search but below 1: the browser's default action — what
        // Enter does with nothing selected — always keeps the top row.
        ...(current.project
          ? [
              {
                id: ASK_ITEM_ID,
                title: `Ask an agent: ${query}`,
                subtitle: "spawns a BB thread",
                score: 0.8,
                action: { type: "run" } as const,
              },
            ]
          : []),
        {
          id: "github",
          title: `Search GitHub for "${query}"`,
          subtitle: "github.com",
          score: 0.55,
          action: { type: "navigate", url: githubSearchUrl(query) } as const,
        },
      ];
    },
    async run(itemId, { query }) {
      if (itemId !== ASK_ITEM_ID) {
        throw new Error(`unknown omnibox item ${JSON.stringify(itemId)}`);
      }
      const current = await settings.get();
      if (!current.project) {
        throw new Error(`omnibox-agent is not configured. ${CONFIGURE_HINT}`);
      }
      // BB fills in origin "plugin" and originPluginId automatically, so the
      // thread is attributed to this plugin in the thread list.
      const thread = await bb.sdk.threads.spawn({
        projectId: current.project,
        prompt: query,
        environment: { type: "project-default" },
        title: `Omnibox: ${query.slice(0, 60)}`,
      });
      bb.log.info(`omnibox ask → thread ${thread.id}`);
      // Open the new thread in the tab the omnibox was used from: the browser
      // navigates to the BB app served by the server this plugin runs in.
      return { navigate: `${bb.server.loopbackBaseUrl}/threads/${thread.id}` };
    },
  });
}
