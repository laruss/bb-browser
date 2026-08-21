---
name: bb-cli
description: Control bb itself from the command line. Use whenever the task is to inspect or orchestrate bb — spawn, steer, wait on, or read threads and subagents; delegate work to another agent; inspect projects, environments, machines, providers, or terminals; or manage skills, plugins, automations, themes, and app settings. Trigger on bb status, bb thread, bb project, bb environment, bb terminal, bb plugin, bb skill, bb automation, or any request to hand work to another bb thread.
---

# bb CLI

Use `bb` when controlling bb itself: inspect current context, coordinate threads,
message agents, or inspect projects, providers, and environments.

This file covers the everyday loop — get context, spawn, coordinate, inspect.
Each other area has a reference file; read the one your task needs rather than
all of them.

## Start With Context

- Use `bb status` to identify the current project, thread, and environment.
- Prefer `--json` when command output will drive follow-up work.
- Run `bb guide` for the system overview and `bb guide <chapter>` for full
  command reference.
- A standalone `bb` CLI with no connection env targets the default local server
  at `http://127.0.0.1:38986` and host daemon port `38987`. Set
  `PATCHER_SERVER_URL` and `PATCHER_HOST_DAEMON_PORT` only for remote or non-default
  targets. The Add machine installer injects its enrolled daemon's selected
  local API port automatically and atomically reserves it across default and
  custom machine data directories.
- The main server and source Vite app bind to loopback by default. Use bb
  connect or a private Tailscale Serve URL for remote browsers and execution
  machines. `--server-bind-host 0.0.0.0` is a compatibility escape hatch only:
  the public API is unauthenticated and permits command execution and file
  reads, so wildcard binding requires a trusted network boundary.

## Spawning Threads

- Use `bb thread spawn --project <project-id> --prompt "..."` to create another
  thread. Pass the intended project explicitly; the CLI does not infer it from
  context variables. Omitted execution flags use remembered project defaults.
- Add repeatable `--file <path>` / `--image <path>` for structured prompt
  attachments and `--section <id>` to file the new thread. Use `--parent-self`
  inside a thread, or `--parent-thread <thread-id>`, to set the parent; spawn
  creates a root thread otherwise.
- Pass `--visibility hidden` for background workers that should stay out of
  sidebar organization. Use `bb thread fork <source-thread-id>` to clone a
  provider session instead of starting fresh.
- Public permission modes are `accept-edits`, `auto`, and `full`. Subagents
  inherit the parent's mode; pass `--permission-mode full` only when the user
  or task needs unsandboxed execution.

Give spawned threads clear prompts: objective, constraints, expected deliverable,
validation to perform, and what to report back. Ask for outcome, changed files
or artifacts, validation performed, and blockers.

Every flag in full, plus machine, environment, and provider selection, is in
[references/threads.md](references/threads.md) and
[references/machines-projects.md](references/machines-projects.md).

## Coordinating Work

- Use one clear owner per task.
- Spawn independent tasks separately when parallel work is useful.
- Let threads work after spawning. Do not poll with shell sleeps, repeated log
  reads, or repeated status reads.
- Use `bb thread wait <thread-id>` when you explicitly need to block until a
  thread finishes. It defaults to waiting for `idle` for up to 20 minutes;
  pass `--status` or `--event` for a different target, and `--timeout
<seconds>` when you need a shorter or longer budget.
- Use `bb thread tell <thread-id> "..."` when requirements change, a blocker
  needs clarification, or follow-up work is needed.
- Use `bb thread edit-message <thread-id> --message "..."` to replace and rerun
  the latest completed user message in an idle Codex, Claude Code, or Pi thread.
  Pass `--expected-request-sequence <sequence>` to select an earlier message.
  Opening edit mode in the app is non-destructive; history changes only when the
  edit is submitted successfully, and workspace changes remain. When an agent
  edits another thread, the CLI carries its `PATCHER_THREAD_ID` so the replacement
  runs under agent permission policy.
- `bb thread tell` steers by default, delivering the message immediately into
  the active turn. Use `--mode queue` when the message is non-urgent and the
  agent can finish its current work first. Steer is especially important for a
  wrong direction, hard stop, or critical clarification.
  Example: `bb thread tell <thread-id> "Stop and use approach B" --mode steer`.

## Inspecting Results

- Use `bb thread search`, `history`, `read|unread`, and `section` for the same
  organization and recall features as the sidebar. `bb thread queue` exposes
  queued-message list/create/update/send/reorder/group/delete operations. Queue
  updates use the listed message version to prevent overwriting a concurrent
  edit and accept repeatable `--file` and `--image` attachment options.
- Use `bb thread show <thread-id>` for status, parent, environment, pull request
  status, and result.
- Use `bb thread show <thread-id> --git-diff` to review file changes.
- Use `bb thread log <thread-id>` to inspect the conversation.
- Use `bb thread output <thread-id>` to read the latest final output, or
  `bb thread output --self` for the current thread.

For review or fix pipelines, get the environment ID from
`bb thread show <thread-id> --json`, then spawn the follow-up with
`--environment <environment-id>` so it sees the same files.

## Which reference to read

| Read                                                               | When the task involves                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [references/threads.md](references/threads.md)                     | every `bb thread` flag, permission inheritance, opening threads and files in the app, `bb terminal` for long-running commands, `bb file`/`bb voice`, and recovering failed or stopped threads |
| [references/machines-projects.md](references/machines-projects.md) | Enrolled execution machines, projects and their sources, environments and diffs, providers/models/ACP agents, and the repo `.patcher-env-setup.sh` hook                                       |
| [references/configuration.md](references/configuration.md)         | `bb-app config` / `bb settings`, experiments, `AGENTS.md` instruction files, and `bb skill ...`                                                                                               |
| [references/app-settings.md](references/app-settings.md)           | the Settings → General and Settings → Keyboard preferences in detail                                                                                                                          |
| [references/plugins.md](references/plugins.md)                     | installing, updating, configuring, inspecting, or scaffolding plugins                                                                                                                         |
| [references/optional-plugins.md](references/optional-plugins.md)   | `bb memory`, `bb tasks`, `bb docs`, `bb automation`, `bb secret`, `AskUserQuestion`, or `bb workflows`                                                                                        |
| [references/theming.md](references/theming.md)                     | `bb theme` commands, or authoring a custom app palette                                                                                                                                        |

Plugins can add top-level `bb` subcommands (e.g. `bb linear issues`). Run them
directly — unknown `bb` commands are resolved against installed plugins and
proxied to the server, and core command names always win. In agent threads the
injected `plugin-commands` skill lists what is available.

**Writing a plugin?** Use the `patcher-plugin-authoring` skill — the complete
authoring reference for the backend `PatcherPluginApi` and the frontend
`@patcher/plugin-sdk/app` contract. `bb guide plugins` has the short walkthrough.
