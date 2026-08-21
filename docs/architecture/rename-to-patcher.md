# bb → Patcher: Rename Plan

How this fork stops being a fork of `get-bb/bb` and becomes Patcher. Written
before the work so each phase can be executed and verified on its own, and so
nothing that looks mechanical gets applied to something that is actually a
contract.

Companion to [bb-migration.md](bb-migration.md), which records what this fork
inherited and which invariants survive. Read its **Invariants** section before
touching anything in the "Frozen" table below.

## Decisions this plan is built on

| Decision                           | Choice                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Compatibility with bb installs     | **Clean break.** No dual reads, no fallbacks, no state migration. Old bb data stays where it is and is ignored. |
| Naming style                       | **Full words**: `PATCHER_*` env, `@patcher/*` scope, `patcher` binary, `~/.patcher`.                            |
| Cloud (`apps/web`, `apps/connect`) | **Removed from the fork**, along with the tunnel/connect packages and the `connect` plugin.                     |
| Wire strings                       | **Frozen.** Constant names and types are renamed; the string values on the IPC wire are not.                    |

The clean break is what makes this plan tractable: every "how do we migrate the
user's X" question collapses into "pick the new name." The one deliberate
exception is the Frozen table, and it is frozen for a reason that has nothing to
do with bb — see below.

## Scale

Roughly **20 000 occurrences across ~2 580 tracked files** (of 4 143), but only a
few hundred distinct tokens.

| Token class                                    | Occurrences | Distinct |
| ---------------------------------------------- | ----------: | -------: |
| `@bb/*` (workspace scope + shadcn registry)    |       5 141 |       61 |
| `BB_*` environment variables                   |       2 856 |      297 |
| `bb.*` dotted keys (API, permissions, storage) |       2 599 |      299 |
| `Bb*` TypeScript identifiers                   |       1 940 |      173 |
| `bb-plugin-*` package names                    |         822 |        — |
| `bb-app`                                       |         610 |        — |
| `get-bb` / `getbb.app`                         |         472 |        — |
| `.bb` / `.bb-dev` (incl. CSS classes)          |        ~856 |        — |
| `"bb-desktop:*"` IPC channel strings           |           — |       74 |
| Prod ports 38886 / 38887                       |         186 |        2 |
| Files needing `git mv`                         |          56 |        — |

By tree: `apps` 9 630 / 1 599 files, `packages` 5 991 / 629, `plugins` 2 413 /
207, `examples` 554 / 71, `docs` 381 / 14, `qa` 295 / 3, `.github` 44 / 6.

## Traps

These are the reasons this is a phased plan and not one `sed`.

1. **Never `s/bb/patcher/g`.** It destroys `getbb` (413), `bubble` /
   `BubbleChatIcon` (~70), `grabbing`, `clobber`, `stubbed`, `abbrev`,
   `tinyglobby`, `nbb`, hex digests (`e40bda56…`, the CSS class
   `.bb71-authored-decoration`), `bbedit.png`, and the migration filename
   `0063_broken_robbie_robertson.sql`. Every pass must be anchored to a token
   boundary and paired with an allow-list.
2. **"patcher" is a substring of "dispatcher".** The tree already holds ~190
   `CommandDispatchError` / `ExpectedCommandDispatchError` / `dispatcher`. Any
   reverse audit for the new name must use `(?<!dis)patcher`.
3. **CSS classes leak to plugins.** `.bb-sidebar-*`, `.bb-tasks-*`,
   `.bb-code-highlight` and friends ship to plugin authors through vendored
   `@bb/shared-ui` components, so they move with the plugin contract (phase 5),
   not with the cosmetic pass.
4. **`bun.lock` in its own commit.** Regenerating it is a dependency upgrade —
   see bb-migration.md invariant 4 and its §2. Watch `@opentelemetry/api`,
   `hono`, and `PLUGIN_TOOLCHAIN_PINS`.
5. **Test environment is load-bearing.** Node 22.20.0 from `.nvmrc`, and
   `env -u CLAUDE_CONFIG_DIR`. A failure list gathered without both is noise.
6. **Do not interleave with browser-gaps work.** A rename pass touching 1 599
   files under `apps/` conflicts with everything. Run each phase in a window
   between browser-gaps tasks, land it, then resume.

## Frozen: strings that keep their `bb` values

Renamed as identifiers, **not** as values.

| What                                                | Where                                                  | Why                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 74 × `"bb-desktop:*"` IPC channel names             | `apps/desktop/src/desktop-browser-ipc.ts` etc.         | bb-migration.md invariant 2, and it applies to Patcher against itself: the shell attaches to any healthy server with **no version handshake**, so renderer and main process routinely come from different builds. Renaming a channel value breaks old-SPA/new-shell instantly. |
| `exposeInMainWorld("bbDesktop")`, `("bbLogViewer")` | `apps/desktop/src/preload.ts`, `log-viewer-preload.ts` | Same mixed-build boundary.                                                                                                                                                                                                                                                     |
| `exposeInIsolatedWorld(..., "bb", ...)`             | `apps/desktop/src/page-script-preload.ts:112`          | Public page-script API (`bb.ready`). Same boundary.                                                                                                                                                                                                                            |
| `persist:bb-browser`                                | `apps/desktop/src/desktop-browser-view.ts:353`         | The partition name is the on-disk directory. Renaming it wipes every site cookie and session. No user-facing value in changing it.                                                                                                                                             |

**Refinement, not a rename:** where the frozen string is a _developer-facing
API_ — `bbDesktop` and the page-script `bb` — expose the new name **in addition**
to the old one. An additive exposure crosses no wire and breaks no parser, so
plugin authors get `patcher.ready(...)` while `bb.ready(...)` keeps working for
older renderers. Document `bb` as the deprecated alias.

Every frozen string goes into the audit allow-list with this file as the
justification, so the phase-8 gate does not flag them forever.

## Name table

### Product and repository

| Old                      | New                               |
| ------------------------ | --------------------------------- |
| `bb`                     | `Patcher` (long: Patcher Browser) |
| `bb Nightly`             | `Patcher Nightly`                 |
| `laruss/bb-browser`      | new repo (TBD)                    |
| `get-bb/bb`, `getbb.app` | gone with the cloud removal       |

### Packages, binaries, scope

| Old                                                | New                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `@bb/<name>` (61)                                  | `@patcher/<name>`                                                 |
| `bb-app` (npm)                                     | `patcher-app`                                                     |
| `packages/bb-app`                                  | `packages/patcher-app`                                            |
| bins `bb`, `bb-app`, `bb-server`, `bb-host-daemon` | `patcher`, `patcher-app`, `patcher-server`, `patcher-host-daemon` |
| `apps/cli/bin/bb`                                  | `apps/cli/bin/patcher`                                            |
| shadcn registry `@bb/<name>`                       | `@patcher/<name>`                                                 |

### Code identifiers

| Old                                                   | New                                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Bb*` types (173)                                     | `Patcher*` — `BbPluginApi`→`PatcherPluginApi`, `BbSdk`→`PatcherSdk`, `BbHttpError`→`PatcherHttpError`, `BbDesktop*`→`PatcherDesktop*`, `BbRuntimeMode`→`PatcherRuntimeMode`, … |
| `__bbPluginRuntime`, `__bbPluginApp`, `__bbWorkflow*` | `__patcher*`                                                                                                                                                                   |
| `useBbContext`, `useBbNavigate`                       | `usePatcherContext`, `usePatcherNavigate`                                                                                                                                      |
| `BBSdk` (bb-app README/smoke)                         | `PatcherSdk`                                                                                                                                                                   |

### Runtime state — clean break, no migration

| Old                                                                                                                   | New                               | Defined in                                                     |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `BB_*` (297)                                                                                                          | `PATCHER_*`                       | `packages/config/src/env-vars.ts`                              |
| `~/.bb`                                                                                                               | `~/.patcher`                      | `runtime.ts` `BB_PROD_DATA_DIR_NAME`                           |
| `~/.bb-dev/<instance>`                                                                                                | `~/.patcher-dev/<instance>`       | `runtime.ts` `BB_DEV_DATA_ROOT_DIR`                            |
| `bb.db`                                                                                                               | `patcher.db`                      | `runtime.ts` `BB_SQLITE_DATABASE_FILE_NAME`                    |
| `~/.bb-machines`                                                                                                      | `~/.patcher-machines`             | server assets                                                  |
| `.bb-env-setup.sh`                                                                                                    | `.patcher-env-setup.sh`           | repo root                                                      |
| prod ports 38886 / 38887                                                                                              | new pair (proposal 38986 / 38987) | `runtime.ts` `BB_PROD_SERVER_PORT`, `BB_PROD_HOST_DAEMON_PORT` |
| localStorage `bb.theme`, `bb.faviconColor`, `bb.promptbox.*`, `bb.sidebar.*`, `bb.root-compose.*`, `bb.promptDraft.*` | `patcher.*`                       | `apps/app`                                                     |
| `_bb_migrations` (plugin SQLite)                                                                                      | `_patcher_migrations`             | `plugin-api.ts`, `fake-plugin-host.ts`                         |

New ports matter even under a clean break: they are what lets a bb install and a
Patcher install run side by side. `reservePackagedAppPorts()` in `runtime.ts`
special-cases both prod ports and must move with them.

Deliberately **not** renamed: the drizzle column `rollback_bb_version` and the
table `bb_connect`. A rename means a new migration plus regenerated snapshots
across ~10 files for zero user-visible gain. `bb_connect` disappears with the
cloud removal anyway.

### Desktop identity

| Old                                                    | New                                |
| ------------------------------------------------------ | ---------------------------------- |
| appId `dev.bb.desktop` / `.nightly`                    | `app.patcher.desktop` / `.nightly` |
| `productName: "bb"`                                    | `"Patcher"`                        |
| window `title: "bb"`                                   | `"Patcher"`                        |
| `assets/bb-logo*.{png,svg}` (5)                        | new artwork                        |
| `apps/desktop/assets/icon*.{png,icns}` (5)             | new artwork                        |
| update feed `github.com/get-bb/bb/releases/download/…` | new repo                           |

A new appId is a new application: its own `userData`, no auto-update link to
the old one, and re-registration with Launch Services as the default browser.
That is the intended consequence of the clean break.

### Plugin contract

| Old                                                                                                                                  | New                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| manifest key `bb` in package.json                                                                                                    | `patcher`                                                          |
| `engines.bb`, `engines.bbPluginSdk`                                                                                                  | `engines.patcher`, `engines.patcherPluginSdk`                      |
| keyword `bb-plugin`                                                                                                                  | `patcher-plugin`                                                   |
| `bb-plugin-*` package names                                                                                                          | `patcher-plugin-*`                                                 |
| `@bb/plugin-sdk`, `@bb/plugin-sdk/app`                                                                                               | `@patcher/plugin-sdk`, `…/app`                                     |
| `bundled-types/bb-plugin-sdk*.d.ts` (6)                                                                                              | `patcher-plugin-sdk*.d.ts`                                         |
| `server.ts` parameter `bb: BbPluginApi`                                                                                              | `patcher: PatcherPluginApi` (local name; scaffold, examples, docs) |
| `bb.permissions`, `bb.sites`, `bb.browser.*`, `bb.storage.kv`, `bb.settings`, `bb.branding.*`, `bb.themes`, `bb.background.schedule` | `patcher.*`                                                        |
| plugin sources `"bb-builtin"`, `"bb-official"`                                                                                       | `"patcher-builtin"`, `"patcher-official"`                          |
| `PLUGIN_SDK_VERSION` `0.4.1`                                                                                                         | `1.0.0` — the break signal                                         |

`@patcher/plugin-sdk` never resolves from npm for external plugins: the scaffold
writes `types/patcher-plugin-sdk.d.ts` and a tsconfig `paths` entry, and
`plugin build` shims the specifier to the host runtime. So the rename is a
source-level break for plugin authors, not an install-level one.

## Phases

Each phase lands on its own and is verifiable on its own.

### Phase 1 — Remove the cloud

First, because it deletes 164 files and most of the 472 `getbb.app` references
before any rename pass has to walk over them.

Delete: `apps/web` (71), `apps/connect` (23), `packages/connect-client` (10),
`packages/connect-db` (23), `packages/tunnel-client` (11),
`packages/tunnel-contract` (5), `plugins/connect` (21).

Surgery outside those trees:

- `apps/desktop/src/`: `connect-credential-cache.ts`, `connect-desktop-session.ts`,
  `connect-machine-enrollment.ts`, `connect-server-sync.ts`,
  `connect-session-renewal.ts`, and six import sites in `main.ts`.
- `apps/host-daemon/src/connect-tunnel/`, wired from `app.ts`,
  `command-dispatch.ts`, `server-connection.ts`.
- `apps/server/package.json`: `@bb/tunnel-contract` is a declared but unused
  dependency — drop it.
- `.github/workflows/deploy-web.yml`, `deploy-connect.yml`.
- `scripts/bb-cloud-dev.mjs` and the root `cloud:dev` script.
- `BB_DEV_CONNECT_BASE_URL`, plus `cloudPort` / `cloudWorkerPort` in
  `DevPortSet` (`runtime.ts`) and the `bb.localhost` dev domain.
- Doc and template mentions of remote access.

What goes away with it: remote access via `<handle>.getbb.app`, connect-based
machine enrollment, and desktop session sync. Local machine enrollment through
the host daemon is unaffected.

**Verify:** `bun install`; `bunx turbo run typecheck`; `env -u CLAUDE_CONFIG_DIR bun run test`;
`git grep -i 'getbb\|tunnel\|connect-client'` returns only unrelated hits.

### Phase 2 — `@bb/*` → `@patcher/*`, packages and paths

- All `package.json` names and `workspace:*` deps, imports, `turbo` filters,
  tsconfig `paths` and `references`, vitest configs, `.github` filters,
  `apps/app/components.json`, `packages/plugin-registry/registry.json` and
  `r/*.json`.
- `git mv` the 56 `bb`-named files and `packages/bb-app` → `packages/patcher-app`;
  fix relative imports and the `files` / `bin` / `exports` entries that name them.
- Regenerate `bun.lock` as a separate commit.

**Verify:** `bun install`; `bunx turbo run typecheck` (task count drops from 58
by the packages deleted in phase 1); `bunx turbo run build`.

### Phase 3 — `Bb*` identifiers and globals

- 173 `Bb*` types → `Patcher*`; `__bb*` globals → `__patcher*`; the two `useBb*`
  hooks.
- Additive alias exposures for `bbDesktop` and the page-script `bb`, per the
  Frozen section. Nothing is removed.
- Regenerate `packages/plugin-build/src/runtime-export-manifest.ts` and the
  bundled `.d.ts` set.

**Verify:** `bunx turbo run typecheck`; targeted tests for `@patcher/plugin-sdk`,
`@patcher/plugin-build`, `@patcher/templates`, `@patcher/desktop`.

### Phase 4 — Environment, paths, ports, database

- 297 `BB_*` → `PATCHER_*` across `packages/config` and every consumer,
  including `apps/server/src/assets/install-machine.sh` and the launchd/systemd
  unit it writes.
- `runtime.ts`: data dir names, db file name, prod ports,
  `reservePackagedAppPorts`.
- localStorage keys in `apps/app` (including the inline bootstrap in
  `index.html`).
- Bump `HOST_DAEMON_PROTOCOL_VERSION` (currently 106) — the daemon's environment
  contract changes, and an enrolled older daemon must be told to update rather
  than enter an `invalid-message` reconnect loop.

**Verify:** `bun run dev` starts and prints the new dev ports; `bun run start`
runs a production build from source; `bun run reset:dev` targets
`~/.patcher-dev`; `bun run dev:restart-host-daemon` reconnects cleanly.

### Phase 5 — Plugin contract

- Manifest key, `engines`, keyword, package names for the 13 bundled plugins,
  the 12 examples, and the server test fixtures.
- SDK specifier, bundled type filenames, scaffold tsconfig `paths`.
- `bb.*` → `patcher.*` across permission ids, contribution points, storage and
  settings namespaces, branding keys.
- `"bb-builtin"` / `"bb-official"` plugin sources.
- `_bb_migrations` → `_patcher_migrations`.
- CSS class prefixes in `@patcher/shared-ui`.
- `PLUGIN_SDK_VERSION` → `1.0.0`.

**Verify:** `bun run patcher plugin new` → `plugin build` → the plugin loads;
all bundled plugins load and their tests pass; `@patcher/templates` scaffold
tests green.

### Phase 6 — Product identity

- README, CHANGELOG, CONTRIBUTING, `docs/**`, `qa/**`, `AGENTS.md`.
- `packages/templates/src/templates/bb-guide-*.md` (11 files, ~430 mentions) —
  product surface, not repo docs: they are served to agents and users through
  the `guide` SDK area (`packages/sdk/src/areas/guide.ts`) and the CLI. Their
  template keys (`bbGuideThreads`, …) rename with them; the guide slugs
  (`threads`, `plugins`, …) carry no `bb` and stay.
- `packages/templates/src/plugin-scaffold.ts` (99).
- UI copy: `create-via-prompt-examples.tsx`, `AddMachineDialog.tsx`, settings
  sections, browser-surface comments.
- `<title>`, `apple-mobile-web-app-title`, the 9 `manifest*.webmanifest` files
  and `apps/app/scripts/generate-pwa-icons.mjs`.
- Electron `productName`, `applicationName`, window title, appId, icons.
- New logo and icon artwork (7 raster + 1 SVG source).

**Verify:** `bunx turbo run build`; `smoke:packaged`; register the packaged
bundle with `lsregister`, confirm Launch Services reports Patcher as an
available default browser, then restore.

### Phase 7 — External identity

- New git remote; the 465 `github.com` links that point at the old repo.
- npm: publish `patcher-app` (check availability first); rename the four bins;
  `.github/workflows/publish-bb-app.yml` → `publish-patcher-app.yml`;
  `check-version-lockstep.mjs`.
- Auto-update feed base URL and the `desktop-latest` / `desktop-nightly` release
  tags in the new repo.
- Telemetry: new PostHog project for `PATCHER_POSTHOG_API_KEY`, and update the
  README telemetry paragraph and the `PATCHER_TELEMETRY` opt-out name.
- Skills-registry proxy UA `bb-skills-registry` → `patcher-skills-registry`.
- Discord invite, or drop the badge.

**Verify:** `smoke:tarball` against the renamed package layout; a `desktop:build`
that publishes to the new feed and updates from it.

### Phase 8 — Audit gate

Add `scripts/rename-audit.mjs`, wired into CI:

- Forward check — residual `bb` tokens:
  `(?<![A-Za-z0-9_-])[Bb][Bb](?![A-Za-z0-9_-])|@bb/|\bBB_[A-Z]|\bBb[A-Z]`
- Allow-list, each entry justified: the Frozen table's strings; the English
  words `bubble`, `abbrev`, `clobber`, `grabbing`, `stubbed`, `stubborn`,
  `rubber`, `tabbable`; `tinyglobby`; `bbedit.png`;
  `0063_broken_robbie_robertson.sql`; hex digests.
- Reverse check — accidental damage from the new name:
  `(?<!dis)patcher` outside the expected set, so `CommandDispatchError` and
  `dispatcher` do not drown the signal.

**Full verification:** on Node 22.20.0 (`.nvmrc`),
`env -u CLAUDE_CONFIG_DIR bun run test` — read turbo's
`Tasks: N successful, M total` line, not `$?`. Then `bun run lint`,
`bunx turbo run typecheck`, `smoke:tarball`, `smoke:packaged`.

## Open items

- The new GitHub org/repo name.
- npm availability of `patcher-app` and of the `@patcher` scope.
- The prod port pair — 38986 / 38987 is a proposal, not a decision.
- The desktop appId — `app.patcher.desktop` is a proposal.
- Logo and icon artwork: eight files that need design, not a rename.
