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
| Cloud (`apps/web`, `apps/connect`) | **Removed from the fork**, along with the tunnel/connect packages and the `connect` plugin. Done in phase 1.    |
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

Measured before phase 1. After it the tree is 3 961 tracked files and **19 333
occurrences across 2 488 files**: `@bb/*` 4 969, `BB_*` 2 807, `bb.*` 2 492,
`Bb*` 1 935. The one column that moved sharply is `get-bb` / `getbb.app`,
472 → **86**, and none of the 86 is cloud any more — they are repository and
npm URLs in `package.json` files (phase 7), test hostnames, and prose.

After phase 2 the `@bb/*` column is **0** everywhere except this file, and the
tree is at **14 227 occurrences across 1 263 files**: `BB_*` 2 807, `bb.*`
2 481, `Bb*` 1 935, `bb-plugin-*` 834, `bb-app` 610, `get-bb` / `getbb.app` 88.
By tree: `apps` 6 131 / 696 files, `packages` 4 882 / 344, `plugins` 1 886 /
122, `examples` 478 / 57, `docs` 328 / 13, `tests` 92 / 16, `scripts` 37 / 4,
`.github` 18 / 2.

After phase 3 the `Bb*` column is **0** and the tree is at **12 306
occurrences across 1 181 files**: `BB_*` 2 800, `bb.*` 2 461, `bb-plugin-*`
710, `bb-app` 595, `get-bb` / `getbb.app` 78. `apps` 5 118 / 630 files,
`packages` 4 170 / 330, `plugins` 1 721 / 121, `examples` 454 / 56, `docs`
321 / 13, `tests` 92 / 16, `scripts` 37 / 4, `.github` 18 / 2.

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

| What                                    | Where                                          | Why                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 74 × `"bb-desktop:*"` IPC channel names | `apps/desktop/src/desktop-browser-ipc.ts` etc. | bb-migration.md invariant 2, and it applies to Patcher against itself: the shell attaches to any healthy server with **no version handshake**, so renderer and main process routinely come from different builds. Renaming a channel value breaks old-SPA/new-shell instantly.          |
| `exposeInMainWorld("bbDesktop")`        | `apps/desktop/src/preload.ts`                  | Same mixed-build boundary. **`bbLogViewer` was listed here and does not belong**: the log viewer's HTML is a template literal built by the same main process that installs its preload and handed to `loadURL`, so both sides are always one build. It was renamed outright in phase 3. |
| `exposeInIsolatedWorld(..., "bb", ...)` | `apps/desktop/src/page-script-preload.ts:112`  | Public page-script API (`bb.ready`). Same boundary.                                                                                                                                                                                                                                     |
| `persist:bb-browser`                    | `apps/desktop/src/desktop-browser-view.ts:353` | The partition name is the on-disk directory. Renaming it wipes every site cookie and session. No user-facing value in changing it.                                                                                                                                                      |

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

### Phase 1 — Remove the cloud — **done** (`1c40464b0`)

First, because it deleted 183 files and most of the 472 `getbb.app` references
before any rename pass had to walk over them.

Deleted whole: `apps/web`, `apps/connect`, `packages/connect-client`,
`packages/connect-db`, `packages/tunnel-client`, `packages/tunnel-contract`,
`plugins/connect`, the five desktop `connect-*.ts` modules,
`apps/host-daemon/src/connect-tunnel/`, `machine-auth-proxy.ts`, and
`apps/server/src/ws/host-shared-ports.ts`.

**Three things reached further than this plan estimated.** They are recorded
here because the same underestimate is available to the phases below.

1. **The wire, not just the apps.** `connect-tunnel.ensure-identity`,
   `connect-tunnel.identity`, `connect-shares.replace`, and the
   `connectMachineId` / `hasMachineCredential` session fields lived in
   `@bb/host-daemon-contract`. `HOST_DAEMON_PROTOCOL_VERSION` went
   **106 → 107**. The estimate had said `apps/server` held only an unused
   dependency declaration; it also held the shared-port coordinator, the
   daemon-protocol handler, and the enroll/session write paths.
2. **The plugin contract, which is phase 5 territory.** `bb.hosts`
   (`ensureSharedPortTunnel`, `declareSharedPorts`) existed only to mint and
   use gate labels, so it had to go now: removed from the SDK, both plugin
   runtimes, the host-call protocol, the fake host, and the authoring skill.
3. **Gate auth became a security hole the moment the gate left.**
   `x-bb-gate-auth` and `x-bb-gate-machine-id` were set by the Cloudflare
   worker alone. With no worker in front, honoring them from a direct client
   would let any caller claim machine auth, so they went with the checks that
   read them. The `bbcm_` machine credential is likewise unobtainable now that
   `/api/connect/redeem-machine` is gone — its path is out of the daemon,
   `install-machine.sh` (`--machine-code`), `BB_CONNECT_MACHINE_*`, the
   launcher, and managed config.

Also gone: the cloud dev ports (`cloudPort`, `cloudWorkerPort`,
`BB_DEV_CONNECT_BASE_URL`) and with them `reservePackagedAppPorts`, whose only
purpose was that the cloud port range overlapped 38886/38887.

Left deliberately, both to be picked up later:

- `hosts.connect_machine_id` and its drizzle history — dropping a column is a
  migration plus ~30 regenerated snapshots for no functional gain.
- The `app.getbb.host-daemon.*` launchd label in `install-machine.sh`. It is bb
  branding rather than cloud, so it renames with everything else in phase 6.

What went away with it: remote access via `<handle>.getbb.app`, connect-based
machine enrollment, desktop session sync, and plugin-declared shared ports.
Local machine enrollment through the host daemon is unaffected, and the desktop
shell keeps its custom-server-URL target.

**Verified** on Node 22.20.0: `typecheck` 54/54, `lint` clean,
`env -u CLAUDE_CONFIG_DIR bun run test` 54/54. Two failures that predate the
branch were fixed in passing: commit `985460da2` added `sites` to the plugin DTO
without updating the `@bb/sdk` and `@bb/cli` fixtures, and the committed
`plugin-sdk-dts.generated.ts` had drifted from its source. `@bb/server` also
failed once under full parallel load and passed alone and on rerun — the
load-sensitivity caveat in [bb-migration.md](bb-migration.md), not a defect.

### Phase 2 — `@bb/*` → `@patcher/*` — **done** (`6c5ab591a`, `4494d9152`)

All 34 workspace packages, every import and `workspace:*` dependency, the turbo
filters, tsconfig `paths`, vitest configs, `.github` filters,
`apps/app/components.json`, the plugin component registry, and the root private
package name. 2 037 files, 4 687 replacements.

`bun.lock` followed in its own commit on the assumption that regenerating it is
a dependency upgrade. It was not, this time: 298 lines changed, every one of
them naming the old or the new scope, and no line carrying a semver moved.

**This phase moved no files, though the bullet list it replaced promised 56.**
Phases 3–7 claim the same renames, more specifically, and a file renamed one
phase before the identifier inside it renames is simply touched twice. Every
overlap went to the later phase:

| Deferred                                                                  | To                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| npm name `bb-app`, the four bins, `packages/bb-app`, `publish-bb-app.yml` | 7 — one unit with the release pipeline and the artifact downloader |
| `bb-plugin-*` names, manifest key, `bundled-types/bb-plugin-sdk*.d.ts`    | 5                                                                  |
| `bb-guide-*.md`, `assets/bb-logo*`                                        | 6                                                                  |
| `.bb-env-setup.sh`, `reset-bb-data`, `archive-codex-tmp-bb-sessions`      | 4                                                                  |
| `bb-desktop.ts`, `bb-app-bridge.ts`, `bb-process.ts`                      | 3 — they travel with `BbDesktop*`                                  |

The one row that could **not** be deferred is `@bb/plugin-sdk`, which the
phase-5 table lists as part of the plugin contract. Here the plugin-author-facing
specifier and the workspace package name are the same string — all 24 bundled
and example plugins declare it as a real dependency — so leaving it behind would
have split the scope. It moved with the other 33. Its bundled `.d.ts`
_filenames_ did not; those stay with the rest of the plugin contract.

**Three things worth carrying into phases 3–5,** which are the same kind of
tree-wide token pass.

1. **Anchor on the following character, not on `\b`.** `@bb` was replaced only
   where the next character could not continue an identifier or a hostname.
   That spares `machine-auth@bb.internal` — a persisted system-user email, not
   a package — while still catching the escaped `@bb\/` inside regex literals,
   the bare `"@bb"` used as a path segment in `node_modules` joins, and the
   scaffold's registry alias key. Print the histogram of following characters
   before writing: over 4 687 hits it was `/`, `\`, `"`, and one backtick.
2. **Two source files carry literal NUL bytes** as composite-key separators
   (`PluginNewThreadComposer.tsx`, `packages/db/src/data/events.ts`), so a
   "skip binaries" guard skips them silently. Rewrite those byte-preserving
   (latin1 round-trip) and assert the NUL count is unchanged.
3. **`bun install` leaves the old scope directories behind.** 66
   `node_modules/@bb` directories survived with live symlinks; a missed `@bb/*`
   import would have kept resolving and the build would have stayed green.
   Delete them before trusting a verification run. The same command cleared
   seven orphaned `node_modules` trees left by phase 1's deletions.

**Exposed, not caused:** the scaffold's shadcn registry alias is now `@patcher`
while its URL still points at `raw.githubusercontent.com/get-bb/bb`. Phase 7
owns that URL; the alias had to move with the registry items it names.

**Verified** on Node 22.20.0: `bunx turbo run typecheck --force` 54/54, `lint`
clean, `bunx turbo run build` 13/13, `env -u CLAUDE_CONFIG_DIR bun run test`
54/54. `@patcher/host-workspace` failed twice under full parallel load and
passed alone at 8/8 files and 194/194 tests — the load-sensitivity caveat in
[bb-migration.md](bb-migration.md), as with `@bb/server` in phase 1.

Formatting: 365 of the 2 037 changed files fail prettier, but 275 of them
already failed at the parent commit — verified by extracting those exact paths
from `HEAD` and running the repo-pinned prettier 3.8.3 against them. The new
scope is five characters longer, so 90 import statements overflowed the print
width; those were formatted and the pre-existing 275 left alone.

### Phase 3 — `Bb*` identifiers and globals — **done** (`d745f8def`)

441 distinct tokens, 4 023 replacements across 438 files. More than the 173
the plan counted, because `Bb` also sits inside identifiers
(`createCliBbSdk`, `resolveBbAppVersion`, `linkedBbProjectId`) and the zod
schema constants pair one-for-one with the types they validate.

**The rule that decided scope:** an identifier moves; a name that is written
somewhere and read back by something built separately does not. Under it the
`Bb*` types, their schema constants, the `__bb*` globals, the two `useBb*`
hooks and every embedded form moved, while SQL columns
(`linked_bb_project_id`, `rollback_bb_version`), the plugin manifest keys, the
template keys and the frozen globals stayed. The rule is worth keeping for
phases 4–6: it is sharper than "identifiers vs strings", because plenty of
strings are internal to a single build and plenty of identifiers mirror
something persisted.

**Two things the inventory contradicted.**

1. **`bbLogViewer` was in the Frozen table and does not belong there.** The
   log viewer's HTML is a template literal built by the same main process
   that installs `log-viewer-preload.cjs`, handed to `loadURL` — one build on
   both sides, no server-served renderer, no mixed build. Renamed outright;
   the Frozen table above is corrected.
2. **`builtWith.bbVersion` is a serialized key, not an identifier.** It is
   written into a plugin's `dist/*.meta.json` and validated on read by
   `apps/server/src/services/plugins/app-bundle.ts`. It moved anyway, with
   the rest of the `bbVersion` token: the clean break already invalidates
   artifacts built before the rename, so rejecting them is intended. Phase 5
   owns the artifact format and the `PLUGIN_SDK_VERSION` 1.0.0 signal.

**The additive aliases,** and what they actually cost:

- `preload.ts` calls `exposeInMainWorld` twice. Renderer-side,
  `getPatcherDesktopInfo()` and `getAppSurface()` read
  `patcherDesktop ?? bbDesktop`, so a new SPA works against an older shell.
- The page-script preload **cannot** expose twice: a second
  `exposeInIsolatedWorld` for one world throws and aborts the rest of the
  preload. `patcher` is aliased with a one-line
  `executeJavaScriptInIsolatedWorld` queued ahead of the page scripts.
- **Two `exposeInMainWorld` calls with the same object give the renderer two
  distinct proxies.** They are not reference-equal. The packaged-Electron
  smoke test caught this and a unit test could not have; it now asserts both
  names resolve, expose `getInfo`, and report the same version. Identity was
  never the promise.

Deferred with their phases: `BBSdk*` and `createBBSdk` — the public class of
the `bb-app` npm package, which would otherwise collide with
`BbSdk` → `PatcherSdk` (7); `SCREAMING_CASE` `BB_*`, including the IPC
channel-_name_ constants, which travel with the environment pass (4);
`engines.bbPluginSdk` (5); `bbGuide*` (6).

Anchoring: an explicit 441-token allow-list matched at identifier boundaries,
not a pattern. A pattern catches `DAY_ABBREVIATION`, `ABBREV_OPTION_PATTERN`,
`BUBBLE_ACTIONS`, `BBEdit`, a `sha256/BBBB` test fingerprint, and two base64
blobs containing `Bb` followed by a capital. All are still in the tree.

**Verified** on Node 22.20.0: `typecheck --force` 54/54, `lint` clean,
`build` 13/13, `env -u CLAUDE_CONFIG_DIR bun run test` 54/54, generated set
regenerated with no drift. `@patcher/agent-runtime` failed twice under full
parallel load and passed alone at 45/45 files and 907/907 — the
load-sensitivity caveat again. Formatting: 133 of 442 changed files fail
prettier, 63 already at the parent commit; the 70 the rename broke were
formatted.

### Phase 4 — Environment, paths, ports, database

- 297 `BB_*` → `PATCHER_*` across `packages/config` and every consumer,
  including `apps/server/src/assets/install-machine.sh` and the launchd/systemd
  unit it writes. This also carries the `SCREAMING_CASE` constants that are
  not environment variables — `BB_DESKTOP_*_CHANNEL`,
  `BB_DESKTOP_SPELLCHECK_GLOBAL_NAME` — whose _names_ rename while the
  channel string _values_ stay frozen.
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
- Bundled type filenames and scaffold tsconfig `paths`. The SDK specifier
  itself already moved in phase 2.
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
- npm: publish `patcher-app` (check availability first); rename the four bins
  and `packages/bb-app` → `packages/patcher-app`;
  `.github/workflows/publish-bb-app.yml` → `publish-patcher-app.yml`;
  `check-version-lockstep.mjs`. The directory, the published name, the bins,
  the release workflow, and `bb-app-artifact.ts` move together or not at all.
  `BBSdk` and `createBBSdk` — the package's public class — belong to the same
  unit: renaming them in phase 3 would have collided with
  `BbSdk` → `PatcherSdk`.
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
