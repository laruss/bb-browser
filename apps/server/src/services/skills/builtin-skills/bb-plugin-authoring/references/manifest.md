# Plugin manifest, packaging, and distribution

Everything `package.json` declares, what `bb plugin build` emits, how engine
ranges and updates are enforced, and how users install a plugin.

The complete manifest, with the optional fields SKILL.md leaves out:

```json
{
  "name": "bb-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "engines": { "bb": ">=0.9", "bbPluginSdk": "^0.4.1" },
  "bb": {
    "name": "Hello",
    "description": "A friendly example plugin.",
    "branding": { "icon": "Zap" },
    "server": "./server.ts",
    "app": "./app.tsx",
    "skills": ["skills"]
  }
}
```

- `bb.server` (required) — backend entry. Path installs load it as
  TypeScript directly (no build step); `bb plugin build` also emits a
  self-contained `dist/server.js` + `server.meta.json` that git/npm installs
  prefer when its SDK major matches, so consumers never need npm or
  node_modules. `bb.app` (optional) — frontend entry compiled by
  `bb plugin build` into `dist/app.js` + `app.css` + `app.meta.json`; path
  and git installs build it automatically at install time. Git installs also
  run `npm install --omit=dev` first (so a git plugin may use third-party
  packages) and keep node_modules, since bundling cannot inline data files read
  at runtime. So every package your source imports that bb does not shim
  belongs in `dependencies`: a build-required package left in
  `devDependencies` makes the plugin uninstallable from git, and unbuildable
  after any install that omits dev deps — including the packaged CLI's own,
  which runs npm under `NODE_ENV=production`. `devDependencies` is for types
  and tooling only.
  Installing or updating a git plugin needs `npm` on PATH; checking for
  updates does not, because a check reads the manifest and never builds. Path
  installs build from dependencies you have already installed.
- Building yourself (CI, or verifying a build without a running bb): add
  `bb-app` to `devDependencies` and set `"build": "bb plugin build"`.
  `bb plugin build` needs no server, and depending on `bb-app@X` builds
  against exactly that release's shim configuration. bb downloads its build
  toolchain on first use, so cache `<dataDir>/plugins/toolchain-*` in CI.
- `bb.skills` (optional) — relocates the auto-imported skills directories
  (default `skills/`; `[]` opts out). Every `skills/<name>/SKILL.md` is
  injected into agent threads as the plugin skills tier.
- `bb.themes` (optional) — contributes palettes to Settings → Appearance and
  `bb theme list`. Each entry is
  `{ id, name, description?, css: "./themes/name.css" }`; bb namespaces its
  selectable id as `plugin:<plugin-id>:<id>`. Only loaded plugins contribute.
- `bb.name` and `bb.description` (required) — non-empty human-facing plugin
  identity. The top-level package `name` remains the package identity and
  source of the plugin id.
- `bb.branding` (required) — declare `bb.branding.icon` as either the plugin's
  canonical BB icon name, such as `Zap`, or a plugin-relative compact SVG path
  such as `./assets/icon.svg`. BB validates and hash-serves path-shaped SVGs,
  then renders them as CSS masks so their shape inherits the surrounding text
  color; SVG colors are ignored. BB reuses this icon on roomy surfaces when no
  logo override is declared. Add `logo.light` only for
  intentionally different rich/full-size identity artwork; optional
  `logo.dark` is preferred in dark mode. Logo paths are explicit
  plugin-relative `.svg`, `.png`, or `.webp` files: nulls, empty strings,
  missing/escaping files, unsupported extensions, and a dark logo without a
  light logo fail the manifest. There is no root logo auto-detection. Logo-only
  manifests remain supported for compatibility, so at least an icon or light
  logo is required. BB uses a declared logo where space permits, such as roomy
  Settings rows and cards.
  Compact sidebar, menu, action, mention, and panel-title surfaces prefer the
  plugin-owned icon asset, then a named manifest icon, then a contribution's
  local `icon` hint, then Zap. Branding changes are picked up on
  `bb plugin reload`. Named inline icons use `currentColor`; compact SVG assets
  should contain only the intended transparent glyph shape. Do not duplicate
  the same artwork across `icon` and `logo`; reserve logos for intentionally
  different branded artwork and provide a dark variant when needed.
- `engines.bb` — optional semver range checked against the bb app version.
- `engines.bbPluginSdk` — optional semver range for the plugin SDK surface
  (currently `0.4.1`; the scaffold writes `"^0.4.1"`). Absent means a legacy
  manifest. Managed (`git:`/`npm:`) installs **refuse** a mismatch against
  the running SDK; path installs surface it as `incompatible` at load.
  Compatible updates (`bb plugin outdated` / `bb plugin update`) only select
  candidates that satisfy these ranges; newer incompatible releases are
  reported as blocked rather than applied. Dev builds (bb `0.0.0`) skip
  enforcing `engines.bb` and annotate that on check results.
- **Manual updates:** `bb plugin outdated` checks tracking sources and
  `bb plugin update` applies compatible candidates (reinstall of an already
  installed managed plugin is refused). A failed activation **rolls back** to
  the previous state snapshot and records the failure for the user. Keep
  `engines.*` honest and ship load-safe factories so an update never strands
  users.
- `bb plugin build` stamps authoritative metadata into both
  `dist/server.meta.json` and `dist/app.meta.json`: `sdkMajor`, `sdkVersion`,
  `artifactFormatVersion` (currently `1`), `pluginId`, `pluginVersion`, and
  `builtWith: { bbVersion, pluginSdkVersion }`. Managed installs reject
  artifacts whose `pluginId`/`pluginVersion` disagree with the package
  manifest, or whose SDK major does not match the host.
- Default to `bb-plugin-hello` for the package name. Scoped names such as
  `@acme/bb-plugin-hello` are also supported. The plugin id is the final
  package-name component minus the `bb-plugin-` prefix, so both forms use
  `hello`; it namespaces routes, storage, settings, and CLI commands. Builtin
  ids such as
  `automations`, `connect`, `custom-instructions`, `inline-vis`, and `secrets`
  cannot use a non-`builtin:` source — use `builtin:<name>` instead.

## Distributing a plugin

Users can install third-party plugins directly from a local path, npm package,
or Git repository:

```sh
bb plugin install ./bb-plugin-notes
bb plugin install npm:bb-plugin-notes@^1.0.0
bb plugin install https://github.com/acme/bb-plugin-notes
bb plugin install git:https://github.com/acme/bb-plugin-notes.git@main
```

A bare HTTP(S) repository URL tracks its default branch. Use the `git:` form
with an explicit branch, tag, or commit when that tracking intent matters.

BB has one maintained set of official plugins; users cannot add third-party
catalogs. Official-plugin inclusion is a BB release decision, not part of the
plugin authoring workflow: official plugins ship bundled inside the app itself
and install from that local copy — no network fetch, no separate publish
pipeline.
