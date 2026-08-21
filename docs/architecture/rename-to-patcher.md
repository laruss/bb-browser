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

After phase 4 the `BB_*` column is **0** — the one hit left is a comment in
`contract.test.ts` that names the old prefix on purpose — and so are the prod
ports, `~/.bb`, `.bb-dev` and `bb.db`. Counted as literal `bb` substrings
outside this file, the tree went from 13 548 occurrences across 1 395 files to
**12 875 across 1 340**: `bb.*` 2 387, `bb-plugin-*` 831, `bb-app` 609,
`get-bb` / `getbb.app` 78, `.bb-` 167 (CSS classes and one plugin state file).
`apps` 5 486 / 739 files, `packages` 3 897 / 326, `plugins` 1 935 / 148,
`examples` 491 / 67, `docs` 349 / 13, `qa` 240 / 4, `tests` 57 / 16, `scripts`
25 / 8, `.github` 65 / 5. This counting rule is looser than the one used above
— it also catches `bubble`, `abbrev` and lockfile digests — so compare it only
against itself.

After phase 5 the plugin contract is gone from the tree: `bb-plugin*` **0**,
manifest key **0**, `bb.<member>` **0**, `_bb_migrations` **0**, `--bb-` and
`data-bb-` **0**. By the same literal-`bb` count the tree went from 12 875
occurrences across 1 340 files to **8 325 across 1 153** — the largest single
drop of the rename. What is left is `bb-app` 599, `bb-desktop` 169 (the frozen
channel values and their tests), `bb-cli` 101, `get-bb` / `getbb.app` 78, and
358 `bb.` that are test hostnames, the macOS bundle path, repository URLs and
the frozen `bb.ready`. `apps` 3 569 / 665 files, `packages` 3 016 / 298,
`plugins` 719 / 89, `examples` 182 / 42, `docs` 245 / 12, `qa` 240 / 4,
`tests` 56 / 16, `scripts` 25 / 8, `.github` 65 / 5.

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

| Old                                                                                                                   | New                         | Defined in                                                     |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| `BB_*` (297)                                                                                                          | `PATCHER_*`                 | `packages/config/src/env-vars.ts`                              |
| `~/.bb`                                                                                                               | `~/.patcher`                | `runtime.ts` `BB_PROD_DATA_DIR_NAME`                           |
| `~/.bb-dev/<instance>`                                                                                                | `~/.patcher-dev/<instance>` | `runtime.ts` `BB_DEV_DATA_ROOT_DIR`                            |
| `bb.db`                                                                                                               | `patcher.db`                | `runtime.ts` `BB_SQLITE_DATABASE_FILE_NAME`                    |
| `~/.bb-machines`                                                                                                      | `~/.patcher-machines`       | server assets                                                  |
| `.bb-env-setup.sh`                                                                                                    | `.patcher-env-setup.sh`     | repo root                                                      |
| prod ports 38886 / 38887                                                                                              | **38986 / 38987**           | `runtime.ts` `BB_PROD_SERVER_PORT`, `BB_PROD_HOST_DAEMON_PORT` |
| localStorage `bb.theme`, `bb.faviconColor`, `bb.promptbox.*`, `bb.sidebar.*`, `bb.root-compose.*`, `bb.promptDraft.*` | `patcher.*`                 | `apps/app`                                                     |
| `_bb_migrations` (plugin SQLite)                                                                                      | `_patcher_migrations`       | `plugin-api.ts`, `fake-plugin-host.ts`                         |

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

### Phase 4 — Environment, paths, ports, database — **done** (`8e00a054e`)

299 distinct `BB_*` tokens, 2 947 occurrences, plus the paths, ports, database
name and storage keys: 440 files changed (+3 991 / −3 679). By tree: `apps`
271, `packages` 118, `plugins` 19, `tests` 10, `scripts` 4, `examples` 4,
`docs` 4, `qa` 3, `.github` 1, six at the root.

The `BB_` pass is the one place in this rename where a bare prefix swap is
safe: over 2 947 hits no `BB_` is preceded by a letter or digit, so
`DEFAULT_BB_SERVER_URL` and `TEST_BB_VERSION` come along for free. Print that
histogram before trusting it — the preceding characters were space, `"`, `.`,
`(`, `_`, backtick, `$`, `{`, `/`, `[`, `'`, `-`, `>` and nothing else.

**`HOST_DAEMON_PROTOCOL_VERSION` 107 → 108, and the reason is not the wire.**
Nothing in `@patcher/host-daemon-contract` changed shape. The daemon builds
the agent shell itself: it injects the thread-context variables, strips
inherited ones by prefix, and puts the CLI shim on `PATH`. A 107 daemon
injects `BB_*` and a `bb` shim, so a thread the new server started would run
agents that cannot see their own thread id. The version is the only handshake
there is, so it has to carry a break the message schemas do not show.

**`<repo>/.bb` → `<repo>/.patcher`, which the table above did not list.** This
is a directory in the _user's_ repository — `.bb/AGENTS.md`, `.bb/skills/`,
`.bb/workflows/` — not app state, so renaming it makes every project that
adopted bb move a committed directory. That is the clean break working as
intended, and the alternative was leaving the old product's name inside the
user's own checkout, which is the most visible leftover available.

**`.bb` cannot be matched by a pattern.** The tree holds 62 distinct `.bb*`
literals and most of them must not move: property access (`host.bb`,
`pkg.bb`, `engines.bb`, `manifest.bb`, `PROJECT_IDS.bb`), CSS classes
(`.bb-sidebar-*`, `.bb-tasks-*`, `.bb-app-shell`, and the digest-derived
`.bb71-authored-decoration`), the frozen `globalThis.bb`, and `.bbedit`.
Fifteen explicit path forms moved — the quoted segment, `.bb/`, `/.bb` at a
path end, and the named scratch prefixes — and the leftovers were read one by
one. Two survived a first pass and were fixed by hand: a Windows path written
with escaped backslashes, and one built from `${path.sep}`.

**Two traps worth carrying into phases 5–7.**

1. **A rename moves a name's place in the alphabet.** `bb.db` sorted before
   `logs`; `patcher.db` sorts after it, which broke a `localeCompare`-sorted
   assertion in the dev-data migration test. Nothing else in the suite is
   order-dependent on a renamed name, but the failure looked like lost data
   until the diff was read.
2. **Regex literals escape the dot.** `/^bb\.db\./u` does not match a search
   anchored on the literal `bb.db`, so the migration matcher kept the old name
   while its `Set` of entry names moved. Phase 2 hit the same shape with
   `@bb\/`. Search the escaped forms as their own pass.

Deliberately left, with the reason: `bb.ready` is the frozen page-script
global, not a storage key; `bb.themes` is a plugin contribution point and was
spared by anchoring `bb.theme` against a following letter; the `http://bb.test`
hostnames in the fixtures are not product state, so only the three
`bb.test.promptbox.*` storage keys moved; `.bb-docs-state.json` is written by
the `docs` plugin into the user's repo and travels with that plugin in phase 5.

**Two gaps this phase exposed in the plan itself.**

1. **`x-bb-*` HTTP headers are in no phase.** `x-bb-plugin-token`,
   `x-bb-plugin-id` and `x-bb-plugin-key` are plugin contract → phase 5;
   `x-bb-content-encoding`, `x-bb-size-bytes` and `x-bb-app-surface` are
   server ↔ SDK → phase 7, and `x-bb-app-surface` needs the mixed-build
   question asked before it moves.
2. **Test fixture ids and scratch temp-dir prefixes are in no phase either** —
   `bb-thread-1`, `bb-user`, `bb-project`, `bb-workspace-`, `bb-browser-cli-`
   and ~40 more. Nothing reads them back, so they are not runtime state and
   they stayed; they belong with the cosmetic pass in phase 6. One coupling to
   remember: the four glob defaults in
   `packages/scripts/src/commands/archive-codex-tmp-patcher-sessions.ts`
   (`*/bb-standalone-*`, `*/bb-integration-*`, `*/bb-integ-*`,
   `*/bb-qa-smoke-*`) match those prefixes and must move in the same commit.

The private `bb-script-*` bins in `@patcher/scripts` moved too, though the
deferral table only promised the two command names. Leaving
`bb-script-reset-patcher-data` behind would have been an inconsistency this
change created itself. Six lines in `bun.lock` mirror those bins; unlike phase
2 that is workspace metadata rather than a dependency upgrade, so it rides in
the same commit and `bun install --frozen-lockfile` confirms it.

**Verified** on Node 22.20.0: `typecheck --force` 54/54, `lint` clean (0
errors, 152 pre-existing warnings), `build` 13/13,
`env -u CLAUDE_CONFIG_DIR bun run test` 54/54 with no load flakes this time,
and the generated set regenerated with no drift — twice, because formatting
`portal-scope.ts` invalidated the plugin registry that embeds its source.
Resolved values checked directly: `~/.patcher`,
`~/.patcher-dev/<instance>/patcher.db`, prod ports 38986/38987 (free, and in
the unassigned user-port range), and a dev env of `PATCHER_DATA_DIR`,
`PATCHER_DEV_APP_PORT`, `PATCHER_HOST_DAEMON_PORT`,
`PATCHER_INHERITED_SKILLS_ROOTS`, `PATCHER_SERVER_PORT`, `PATCHER_SERVER_URL`.
`bun run dev` was not run by hand: `@patcher/integration-tests` starts a real
server and daemon under the new names across 25 files and 55 tests, which
covers more.

Formatting: 480 files in the tree fail prettier and 418 of them already failed
at the parent commit — the repo has never been prettier-clean and no CI job
checks it. `PATCHER_` is five characters longer than `BB_`, so 62 files
overflowed the print width; those were formatted and the rest left alone.

### Phase 5 — Plugin contract — **done** (`adcd25909`)

468 files, +4 833 / −4 453. By tree: `apps` 196, `plugins` 118, `packages` 84,
`examples` 54, `docs` 13, plus `turbo.json`, one test and `bun.lock`. This is
the break plugin authors see, which is why `PLUGIN_SDK_VERSION` goes to 1.0.0
in the same commit.

**The method: two passes, then let the compiler find the rest.** Rename
`bb.<member>` wherever `<member>` is on an explicit 30-name allow-list. Every
function body that used the API then reads `patcher.x` while its parameter
still reads `bb`, so `tsc` reports `Cannot find name 'patcher'` at exactly the
declarations that have to follow. Five rounds converged. It works because the
API object is only ever reached through member access; the two bare uses that
never dereference (`__stalerApi = bb`, `const bb = pkg.patcher`) were the last
two errors, and nothing else was left over.

**Why an allow-list and not a `bb.` prefix.** There are 40 distinct first
segments and ten must not move: `bb.test` (103) and `bb.example` (65) are test
hostnames, `bb.ready` is the frozen page-script global, `/bb.app` (21) is the
macOS bundle path, `bb.git` (16) is a repository URL, `bb.zip` a fixture file,
`bb.internal` a persisted system-user email, and `bb.threads` / `bb.status`
inside `packages/bb-app` are the `BBSdk` instance, which is phase 7. The left
anchor also had to reject a preceding `/` — for `bb.app` alone, and for nothing
else in the tree.

**`PLUGIN_SDK_VERSION` 1.0.0 is a behaviour change, not a string.**
`PLUGIN_SDK_MAJOR` goes 0 → 1, which switches on the major-only artifact gate
that was deliberately vacuous for 0.x. Two things followed. The pre-1.0 branch
in `isPrebuiltServerSdkCompatible` — exact `sdkVersion` match within major 0 —
became unreachable and was removed with the paragraph that explained it. And
two tests that _encoded_ the pre-1.0 rule had to state the new one instead:
`version.test.ts` asserted `/^0\./`, and a loader test asserted that a
same-major, different-minor dist falls back to source, which is now precisely
what does not happen. A version bump that changes behaviour arrives as failing
tests that are correct to change.

**Four traps.**

1. **`0.4.1` is a version other packages also publish.** The bump corrupted
   `bun.lock`: `lru_map`, `levn`, `@eslint/plugin-kit` and `pe-library` all sit
   at 0.4.1, and the next `bun install` went looking for `lru_map@1.0.0` and
   got a 404. Restored the lockfile and regenerated it from the manifests; the
   diff is exactly the plugin renames plus the SDK version, and the
   transitive entries that look moved are the sort-order shuffle from `bb-` to
   `patcher-` — phase 4's `bb.db`/`logs` effect again. **A version bump needs
   the same allow-list discipline as a name.**
2. **Escaped forms need their own pass, and the fix has its own escaping.**
   `/bb\.name/` in a regex literal and ``new RegExp(`bb\\.${field}`)`` in a
   template are two more byte sequences for one name; phase 4 hit the first
   with `/^bb\.db\./`. Then the repair itself misfired: a JSON rule whose
   replacement read `patcher\\.` inserted two literal backslashes, because a JS
   replacement string treats `\\` as two characters and not as an escape. The
   tests it was meant to fix caught it.
3. **Generated files defeat a left-anchored pattern, and their order matters.**
   In `templates.generated.ts` a line-initial `bb.settings` is `\nbb.settings`
   inside a JSON string, so the character before `bb` is `n` and the anchor
   refused it. Regenerating fixes it — but `generate-templates.mjs` reads
   `bundled-types/*.d.ts`, so the dts build has to run first. Run the other way
   round it embeds a prettier-formatted copy of a generated file, and the drift
   gate catches that instead.
4. **Markdown TOC anchors are derived names.** Renaming `## bb.log` to
   `## patcher.log` silently breaks `](#bblog)` — 26 of them. Verified by
   re-deriving GitHub's slug from every heading and checking each link lands.
   GitHub does not collapse runs of whitespace, so an em-dash heading yields
   two hyphens; a naive slugifier reports false breakage.

**Deliberately left.** `bb.ready` and `window.bb` are the frozen page-script
boundary: the _documented_ surface now teaches `patcher.ready`, and the loader
tests that still pass `code: "bb.ready(…)"` are what keeps the alias covered —
renaming them too would have removed its only regression test.
`PROJECT_IDS.bb` and the `"bb"` provider filter in `SkillsCollection` are a
demo project and a UI label (6). `bb_connect` stays per the table above. The
`bb-cli` builtin skill is named after the binary and moves with it (7).

**A phase-3 residue this phase exposed.** Six identifiers carry `Bb` as a
_suffix_ — `validBb`, `mapCodexReasoningLevelToBb`, `createAutomationServiceBb`,
`readPluginManifestBb`, `updatesWithBb`, `runSourceBb`, 39 occurrences. Phase 3
anchored `Bb` on a following capital, which by construction cannot see a token
that ends in `Bb`. Renamed here. Separately, `apps/app/src/lib/bb-desktop.ts`,
`apps/app/src/types/bb-desktop.d.ts` and `apps/desktop/src/bb-process.ts` with
their tests were assigned to phase 3 by phase 2's deferral table and never
moved; they hold `PatcherDesktop*` identifiers behind `bb-desktop` filenames.
They go to phase 6.

**Verified** on Node 22.20.0: `typecheck --force` 54/54, `lint` clean (0
errors, 152 pre-existing warnings), `build` 13/13,
`env -u CLAUDE_CONFIG_DIR bun run test` 54/54, generated set with no drift.
The plan's own check was run for real, not inferred: `plugin new hello --app`
scaffolds `patcher-plugin-hello` with the `patcher` manifest key,
`engines.patcherPluginSdk: "^1.0.0"`, tsconfig `paths` onto
`types/patcher-plugin-sdk*.d.ts`, and a `(patcher: PatcherPluginApi)` entry;
`plugin build` emits both bundles with `sdkMajor: 1`. `@patcher/server` failed
two or three tests under full parallel load on three separate runs — a
different set each time, including the 90MB plugin-host budget test — and
passed alone at 204/204 files and 1 777/1 777 tests. The load-sensitivity
caveat, as in phases 1–3.

Formatting: 476 files fail prettier and 411 already failed at the parent
commit; 65 were formatted. Six of those 65 were the bundled `.d.ts` — generated
files that have never been prettier-clean and only looked new because they had
just been renamed. Regenerating put them back, and the tree settles at 417
pre-existing failures.

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
- The desktop appId — `app.patcher.desktop` is a proposal.
- Logo and icon artwork: eight files that need design, not a rename.
