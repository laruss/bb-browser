import type {
  BbPluginApi,
  PluginBrowserAction,
  PluginBrowserKeyModifier,
  PluginBrowserPageState,
  PluginBrowserTab,
  PluginCliResult,
} from "@bb/plugin-sdk";
import { DEFAULT_PAGE_TEXT_MAX_LENGTH, explainBrowserError } from "./tools.js";

/**
 * `bb browser …` — the same `bb.browser` API the agent tools use, from a
 * terminal.
 *
 * It exists because the agent path is only observable by running an agent: the
 * tools are served to a provider session inside a thread, so a broken bridge
 * shows up as a model saying something odd, minutes later. This drives the whole
 * chain — server → hub → WebSocket → app → executor → Electron — in one command,
 * which makes it the fast way to tell a broken bridge from a broken tool.
 *
 * Plugin CLI commands run in the server process, exactly where the agent tools'
 * handlers run, so what this exercises is genuinely the same path.
 */

interface ParsedArgs {
  positionals: string[];
  json: boolean;
  newTab: boolean;
  tabId: string | undefined;
  max: number | undefined;
  generation: number | undefined;
  button: "left" | "middle" | "right";
  double: boolean;
  modifiers: PluginBrowserKeyModifier[];
}

const MODIFIERS = new Set(["Alt", "Control", "Meta", "Shift"]);

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const positionals: string[] = [];
  let json = false;
  let newTab = false;
  let tabId: string | undefined;
  let max: number | undefined;
  let generation: number | undefined;
  let button: "left" | "middle" | "right" = "left";
  let double = false;
  const modifiers: PluginBrowserKeyModifier[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json") {
      json = true;
    } else if (arg === "--new-tab") {
      newTab = true;
    } else if (arg === "--double") {
      double = true;
    } else if (arg === "--tab") {
      index += 1;
      tabId = argv[index];
      if (tabId === undefined || tabId.length === 0) {
        return { error: "--tab needs a tab id" };
      }
    } else if (arg === "--button") {
      index += 1;
      const raw = argv[index];
      if (raw !== "left" && raw !== "middle" && raw !== "right") {
        return { error: "--button needs left, middle or right" };
      }
      button = raw;
    } else if (arg === "--modifier") {
      index += 1;
      const raw = argv[index];
      if (raw === undefined || !MODIFIERS.has(raw)) {
        return { error: "--modifier needs Alt, Control, Meta or Shift" };
      }
      modifiers.push(raw as PluginBrowserKeyModifier);
    } else if (arg === "--max" || arg === "--generation") {
      index += 1;
      const raw = argv[index];
      const value = Number(raw);
      const floor = arg === "--max" ? 1 : 0;
      if (raw === undefined || !Number.isInteger(value) || value < floor) {
        return {
          error:
            arg === "--max"
              ? "--max needs a positive integer"
              : "--generation needs a non-negative integer",
        };
      }
      if (arg === "--max") {
        max = value;
      } else {
        generation = value;
      }
    } else if (arg.startsWith("--")) {
      return { error: `unknown option ${arg}` };
    } else {
      positionals.push(arg);
    }
  }

  return {
    positionals,
    json,
    newTab,
    tabId,
    max,
    generation,
    button,
    double,
    modifiers,
  };
}

function tabLine(tab: PluginBrowserTab): string {
  const marks = [
    tab.active ? "*" : " ",
    tab.live ? "live" : "cold",
    tab.loading ? "loading" : "",
  ]
    .filter((mark) => mark.length > 0)
    .join(" ");
  return `${marks}\t${tab.tabId}\t${tab.url === "" ? "(new tab)" : tab.url}\t${tab.title ?? ""}`;
}

function renderTabs(tabs: readonly PluginBrowserTab[], json: boolean): string {
  if (json) {
    return `${JSON.stringify(tabs, null, 2)}\n`;
  }
  if (tabs.length === 0) {
    return "No open tabs.\n";
  }
  // "cold" is the one worth seeing at a glance: a tab with no live view cannot
  // be read or navigated back/forward.
  return `${tabs.map(tabLine).join("\n")}\n`;
}

function renderTab(tab: PluginBrowserTab, json: boolean): string {
  return json ? `${JSON.stringify(tab, null, 2)}\n` : `${tabLine(tab)}\n`;
}

function renderPageState(
  state: PluginBrowserPageState,
  json: boolean,
): string {
  if (json) {
    return `${JSON.stringify(state, null, 2)}\n`;
  }
  return `${state.url}\t${state.title ?? ""}\n`;
}

const USAGE = `Usage: bb browser <command> [options]

Reading
  status                     Whether an app window can serve browser commands
  snapshot [--max <depth>]   Accessibility tree with [ref=eN] on interactive elements
  tabs                       List open tabs
  url | title                Read a tab's address or title
  text [--max <n>]           Read the page's visible text
  selection                  Read the page's selected text

Acting (refs come from snapshot)
  click <ref> [--button b] [--double] [--modifier M]
  hover <ref>
  drag <ref> <target-ref>
  fill <ref> <text>          Replace a field's value
  type <ref> <text>          Send one keystroke per character
  press <key> [<ref>]        e.g. Enter, Escape, Control+a
  select <ref> <value>...    Choose options in a dropdown
  check <ref> | uncheck <ref>
  upload <ref> <path>...     Hand a file input local files
  resize <width> <height>    Emulated viewport; "resize reset" restores it

Navigating
  open <url> [--new-tab]     Open a URL (http/https)
  close <tab-id>             Close a tab
  activate <tab-id>          Bring a tab to the front
  back | forward | reload    Drive a tab's history
  dialog <accept|dismiss>    Answer a JavaScript dialog blocking a page

Options:
  --tab <tab-id>       Act on this tab instead of the active one
  --generation <n>     Refuse refs unless they came from this snapshot
  --max <n>            Characters of page text to return, or tree depth
  --button <b>         left (default), middle, right
  --double             Double click
  --modifier <M>       Alt, Control, Meta or Shift; repeatable
  --json               Machine-readable output
`;

export function registerBrowserToolsCli(bb: BbPluginApi): void {
  bb.cli.register({
    name: "browser",
    summary: "Drive the BB desktop app's browser surface",
    commands: [
      {
        name: "status",
        summary: "Show whether a browser window is connected",
        usage: "bb browser status [--json]",
      },
      {
        name: "snapshot",
        summary: "Accessibility tree of a page, with refs on interactive elements",
        usage: "bb browser snapshot [--tab <tab-id>] [--max <depth>] [--json]",
      },
      {
        name: "click",
        summary: "Click an element named by a snapshot ref",
        usage:
          "bb browser click <ref> [--button left|middle|right] [--double] [--modifier <M>] [--tab <tab-id>] [--generation <n>]",
      },
      {
        name: "hover",
        summary: "Move the pointer over an element",
        usage: "bb browser hover <ref> [--tab <tab-id>] [--generation <n>]",
      },
      {
        name: "drag",
        summary: "Drag one element onto another",
        usage: "bb browser drag <ref> <target-ref> [--tab <tab-id>]",
      },
      {
        name: "fill",
        summary: "Replace the value of a text field",
        usage: "bb browser fill <ref> <text> [--tab <tab-id>]",
      },
      {
        name: "type",
        summary: "Type into a field one keystroke at a time",
        usage: "bb browser type <ref> <text> [--tab <tab-id>]",
      },
      {
        name: "press",
        summary: "Press a key, optionally on a specific element",
        usage: "bb browser press <key> [<ref>] [--tab <tab-id>]",
      },
      {
        name: "select",
        summary: "Choose one or more options in a dropdown",
        usage: "bb browser select <ref> <value>... [--tab <tab-id>]",
      },
      {
        name: "check",
        summary: "Make sure a checkbox or radio is checked",
        usage: "bb browser check <ref> [--tab <tab-id>]",
      },
      {
        name: "uncheck",
        summary: "Make sure a checkbox is unchecked",
        usage: "bb browser uncheck <ref> [--tab <tab-id>]",
      },
      {
        name: "upload",
        summary: "Hand a file input one or more local files",
        usage: "bb browser upload <ref> <path>... [--tab <tab-id>]",
      },
      {
        name: "resize",
        summary: "Emulate a viewport size, or reset it",
        usage: "bb browser resize <width> <height> | reset [--tab <tab-id>]",
      },
      {
        name: "dialog",
        summary: "Answer a JavaScript dialog blocking a page",
        usage: "bb browser dialog <accept|dismiss> [text] [--tab <tab-id>]",
      },
      {
        name: "tabs",
        summary: "List the browser's open tabs",
        usage: "bb browser tabs [--json]",
      },
      {
        name: "open",
        summary: "Open a URL in the browser",
        usage: "bb browser open <url> [--tab <tab-id>] [--new-tab] [--json]",
      },
      {
        name: "close",
        summary: "Close a browser tab",
        usage: "bb browser close <tab-id> [--json]",
      },
      {
        name: "activate",
        summary: "Bring a browser tab to the front",
        usage: "bb browser activate <tab-id> [--json]",
      },
      {
        name: "url",
        summary: "Show the URL a browser tab is on",
        usage: "bb browser url [--tab <tab-id>]",
      },
      {
        name: "title",
        summary: "Show the title of a browser tab's page",
        usage: "bb browser title [--tab <tab-id>]",
      },
      {
        name: "text",
        summary: "Read the visible text of a browser tab's page",
        usage: "bb browser text [--tab <tab-id>] [--max <n>]",
      },
      {
        name: "selection",
        summary: "Read the text selected in a browser tab",
        usage: "bb browser selection [--tab <tab-id>]",
      },
      {
        name: "back",
        summary: "Go back in a browser tab's history",
        usage: "bb browser back [--tab <tab-id>] [--json]",
      },
      {
        name: "forward",
        summary: "Go forward in a browser tab's history",
        usage: "bb browser forward [--tab <tab-id>] [--json]",
      },
      {
        name: "reload",
        summary: "Reload a browser tab",
        usage: "bb browser reload [--tab <tab-id>] [--json]",
      },
    ],
    async run(argv, context): Promise<PluginCliResult> {
      const parsed = parseArgs(argv);
      if ("error" in parsed) {
        return { exitCode: 2, stderr: `${parsed.error}\n\n${USAGE}` };
      }
      const [command, ...rest] = parsed.positionals;
      if (command === undefined || command === "help") {
        return { exitCode: command === undefined ? 2 : 0, stdout: USAGE };
      }

      // The invoking CLI's request signal, so Ctrl-C stops the wait rather than
      // leaving the command hanging on a page that never loads.
      const options = { signal: context.signal };

      /** Every interaction reports the same thing: where the tab ended up. */
      const act = async (
        action: PluginBrowserAction,
      ): Promise<PluginCliResult> => {
        const state = await bb.browser.page.act(
          { action, tabId: parsed.tabId, generation: parsed.generation },
          options,
        );
        return { exitCode: 0, stdout: renderPageState(state, parsed.json) };
      };
      const requireRef = (value: string | undefined): string | null =>
        value === undefined || value.length === 0 ? null : value;

      try {
        switch (command) {
          case "status": {
            const status = bb.browser.getStatus();
            if (parsed.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(status)}\n` };
            }
            return {
              exitCode: status.connected ? 0 : 1,
              stdout: status.connected
                ? `Connected (${status.windowCount} window${status.windowCount === 1 ? "" : "s"}).\n`
                : "No browser window is connected. Open the BB desktop app.\n",
            };
          }

          case "snapshot": {
            const result = await bb.browser.page.snapshot(
              { tabId: parsed.tabId, maxDepth: parsed.max },
              options,
            );
            if (parsed.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
            }
            // The generation goes to stderr so stdout stays the tree alone and
            // can be piped, while a human still sees the number the interaction
            // commands want back.
            return {
              exitCode: 0,
              stdout: `${result.snapshot}\n`,
              stderr: `generation ${result.generation}\n${
                result.truncated ? "(truncated)\n" : ""
              }`,
            };
          }

          case "click":
          case "hover":
          case "check":
          case "uncheck": {
            const ref = requireRef(rest[0]);
            if (ref === null) {
              return { exitCode: 2, stderr: "A ref is required.\n" };
            }
            if (command === "hover") {
              return await act({ action: "hover", ref });
            }
            if (command === "click") {
              return await act({
                action: "click",
                ref,
                button: parsed.button,
                clickCount: parsed.double ? 2 : 1,
                modifiers: parsed.modifiers,
              });
            }
            return await act({
              action: "check",
              ref,
              checked: command === "check",
            });
          }

          case "drag": {
            const ref = requireRef(rest[0]);
            const targetRef = requireRef(rest[1]);
            if (ref === null || targetRef === null) {
              return {
                exitCode: 2,
                stderr: "Both a source ref and a target ref are required.\n",
              };
            }
            return await act({ action: "drag", ref, targetRef });
          }

          case "fill":
          case "type": {
            const ref = requireRef(rest[0]);
            if (ref === null) {
              return { exitCode: 2, stderr: "A ref is required.\n" };
            }
            // Everything after the ref, so unquoted multi-word text still works.
            const text = rest.slice(1).join(" ");
            return await act({ action: command, ref, text });
          }

          case "press": {
            const key = requireRef(rest[0]);
            if (key === null) {
              return { exitCode: 2, stderr: "A key is required.\n" };
            }
            const ref = requireRef(rest[1]);
            return await act({
              action: "press",
              key,
              ...(ref === null ? {} : { ref }),
            });
          }

          case "select": {
            const ref = requireRef(rest[0]);
            const values = rest.slice(1);
            if (ref === null || values.length === 0) {
              return {
                exitCode: 2,
                stderr: "A ref and at least one value are required.\n",
              };
            }
            return await act({ action: "select", ref, values });
          }

          case "upload": {
            const ref = requireRef(rest[0]);
            const paths = rest.slice(1);
            if (ref === null || paths.length === 0) {
              return {
                exitCode: 2,
                stderr: "A ref and at least one file path are required.\n",
              };
            }
            return await act({ action: "upload", ref, paths });
          }

          case "resize": {
            if (rest[0] === "reset") {
              return await act({ action: "resize", width: 0, height: 0 });
            }
            const width = Number(rest[0]);
            const height = Number(rest[1]);
            if (
              !Number.isInteger(width) ||
              !Number.isInteger(height) ||
              width < 1 ||
              height < 1
            ) {
              return {
                exitCode: 2,
                stderr: "A width and a height in pixels are required.\n",
              };
            }
            return await act({ action: "resize", width, height });
          }

          case "dialog": {
            const action = rest[0];
            if (action !== "accept" && action !== "dismiss") {
              return {
                exitCode: 2,
                stderr: "Usage: bb browser dialog <accept|dismiss> [text]\n",
              };
            }
            const answered = await bb.browser.page.handleDialog(
              {
                accept: action === "accept",
                tabId: parsed.tabId,
                promptText: rest[1],
              },
              options,
            );
            return {
              exitCode: answered ? 0 : 1,
              stdout: answered
                ? `Dialog ${action === "accept" ? "accepted" : "dismissed"}.\n`
                : "No dialog was waiting on that tab.\n",
            };
          }

          case "tabs": {
            const tabs = await bb.browser.tabs.list(options);
            return { exitCode: 0, stdout: renderTabs(tabs, parsed.json) };
          }

          case "open": {
            const url = rest[0];
            if (url === undefined) {
              return { exitCode: 2, stderr: "A URL is required.\n" };
            }
            const tab = parsed.newTab
              ? await bb.browser.tabs.open(
                  { url, activate: true },
                  options,
                )
              : await bb.browser.navigation.open(
                  { url, tabId: parsed.tabId },
                  options,
                );
            return { exitCode: 0, stdout: renderTab(tab, parsed.json) };
          }

          case "close": {
            const tabId = rest[0];
            if (tabId === undefined) {
              return { exitCode: 2, stderr: "A tab id is required.\n" };
            }
            const result = await bb.browser.tabs.close({ tabId }, options);
            return {
              exitCode: 0,
              stdout: parsed.json
                ? `${JSON.stringify(result, null, 2)}\n`
                : `Closed ${result.closedTabId}.\n${renderTabs(result.tabs, false)}`,
            };
          }

          case "activate": {
            const tabId = rest[0];
            if (tabId === undefined) {
              return { exitCode: 2, stderr: "A tab id is required.\n" };
            }
            const tab = await bb.browser.tabs.activate({ tabId }, options);
            return { exitCode: 0, stdout: renderTab(tab, parsed.json) };
          }

          case "url": {
            const url = await bb.browser.page.getUrl(
              { tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: `${url}\n` };
          }

          case "title": {
            const title = await bb.browser.page.getTitle(
              { tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: `${title ?? ""}\n` };
          }

          case "text": {
            const result = await bb.browser.page.getText(
              {
                tabId: parsed.tabId,
                maxLength: parsed.max ?? DEFAULT_PAGE_TEXT_MAX_LENGTH,
              },
              options,
            );
            if (parsed.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(result)}\n` };
            }
            return {
              exitCode: 0,
              stdout: `${result.text}\n`,
              stderr: result.truncated ? "(truncated)\n" : undefined,
            };
          }

          case "selection": {
            const result = await bb.browser.page.getSelection(
              { tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: `${result.text}\n` };
          }

          case "back":
          case "forward":
          case "reload": {
            const tab = await bb.browser.navigation[command](
              { tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: renderTab(tab, parsed.json) };
          }

          default:
            return {
              exitCode: 2,
              stderr: `Unknown command "${command}".\n\n${USAGE}`,
            };
        }
      } catch (error) {
        // Same explanations the agent tools give, so a failure reads the same
        // way in a terminal as it does in a thread.
        return { exitCode: 1, stderr: `${explainBrowserError(error)}\n` };
      }
    },
  });
}
