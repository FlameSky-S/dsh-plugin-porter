# dsh-plugin-porter

**English** | [简体中文](README.zh-CN.md)

[![Build plugin package](https://github.com/FlameSky-S/dsh-plugin-porter/actions/workflows/build.yml/badge.svg)](https://github.com/FlameSky-S/dsh-plugin-porter/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Export installed DSH plugins — with their **dependency closure** and **documentation** — to removable media, then install or update them inside an isolated intranet from that folder. It also bootstraps itself on the intranet without npm, pnpm, or network access.

## Why

Air-gapped DSH machines cannot reach the npm registry. This plugin:

1. **Exports** selected plugins plus every runtime dependency, README/LICENSE/GitHub docs, and SHA-256 checksums.
2. **Imports** on the intranet: scans the transported folder, shows versions and update status, and copies the selected package closure into the profile.
3. **Self-installs** on a machine that does not have the plugin yet via `install-porter.cmd` / `.ps1` / `.sh`.

Typical setup: an online machine exports; a fully isolated machine imports. Both should use the same DSH major version, OS, and CPU architecture.

## Quick start

### 1. Export (online machine)

1. Install and enable this bundle.
2. Open **Settings → Plugin Porter → Export**.
3. Select plugins; the output defaults to the desktop.
4. Click **Export selected plugins**. Export runs as a background job, so a large dependency closure cannot fail as a timed-out request; the panel reports the target folder when it finishes. The generated folder contains:

```text
dsh-plugin-porter-export-YYYYMMDD-HHmmss/
├─ manifest.json          plugin/dependency/version metadata
├─ checksums.json         SHA-256 for every file
├─ packages/              plugins + dependency closure
├─ docs/                  local docs + upstream GitHub README
├─ porter/                this plugin, used by the installer
├─ install-porter.ps1     intranet self-install (PowerShell)
├─ install-porter.cmd     Windows launcher
├─ install-porter.sh      Linux / macOS launcher
├─ porter-cli.cmd / .sh
├─ INSTALL.md             operator steps (Chinese)
```

Copy the **whole folder** to the intranet.

### 2. Install this plugin on the intranet

Fully quit DSH (tray → Quit), then run:

```bat
install-porter.cmd
```

or:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-porter.ps1
```

The script finds the profile (`%USERPROFILE%\.dsh\profiles\desktop` or `-ProfileDir`), copies `porter\` into `node_modules`, registers it in `dependencies` and `dsh.profile.bundles`, and backs up the previous `package.json` and package directory.

Restart DSH, then open **Settings → Plugin Porter**.

Linux/macOS:

```sh
./install-porter.sh /path/to/profile
```

### 3. Install or update plugins

1. **Settings → Plugin Porter → Import**.
2. Choose the transported folder (or paste its absolute path) and scan.
3. Check integrity, versions, and statuses (`new` / `same` / `update` / `downgrade`).
4. Install the selected plugins. Affected packages and `package.json` are backed up first; failures roll back.
5. Fully quit and restart DSH.

## Install this plugin (developer machine)

The `dsh-plugin-porter/` directory is a complete bundle. Install it with DSH's plugin manager (`plugin_manager` → `install_bundle`, target = absolute path of this directory), or with the desktop "install local plugin" action. Restart DSH and check **Settings → Plugin Porter**.

For a prebuilt zip, download the latest `dsh-plugin-porter-<version>` artifact from the [Build plugin package](https://github.com/FlameSky-S/dsh-plugin-porter/actions/workflows/build.yml) workflow. Chinese users can read the full guide at [README.zh-CN.md](README.zh-CN.md).

## What the UI does

- **Export**: lists installed plugins with size, direct dependency count, docs count, bundle/UI flags. Options: include local docs, fetch upstream GitHub READMEs. Computes `dependencies` + `optionalDependencies` transitively; skips `peerDependencies` / `devDependencies`; treats `@deepseek-ai/*` as runtime-provided.
- **Import**: verifies checksums, shows source DSH version, target profile, and per-plugin status. Installs the whole closure of each selected plugin.
- **About**: workflow, layout, limits.

## GitHub Actions

The `Build plugin package` workflow builds and uploads a zip artifact on every push to `main`. Pushing a `v*` tag publishes a GitHub Release with the same zip and its `.sha256`. Build output is not committed; `dist/` is ignored.

## CLI

```bash
node bin/porter.mjs list
node bin/porter.mjs status
node bin/porter.mjs export --plugins dsh-skill-hub,dsh-ssh --out D:\porter-out
node bin/porter.mjs scan --dir E:\dsh-plugin-porter-export-...
node bin/porter.mjs verify --dir E:\...
node bin/porter.mjs install --dir E:\... --plugins dsh-skill-hub
```

Global flags: `--profile-dir <path>`, `--json`, `--help`, `--version`.

## How offline installation works

DSH Desktop profiles use a hoisted, flat `node_modules`: each package is a real directory at `node_modules/<name>`. DSH resolves bundles from the installed packages and `dsh.profile.bundles` at startup; `pnpm-lock.yaml` is not consulted at boot. Therefore the importer can:

1. copy each missing package to `<profile>/node_modules/<name>` (dependency packages already present in the target are kept; only the selected plugin itself is replaced);
2. add the selected plugin to `dependencies` in the profile `package.json`;
3. append bundle names to `dsh.profile.bundles`.

No registry and no pnpm are involved. A restart is required so DSH recomposes the bundle graph.

If the exported plugins require multiple versions of the same package, the export keeps all of them and warns. Import keeps any version already installed in the target profile and copies the highest exported version only for packages that are missing. A flat `node_modules` cannot host two versions at once, so preserving a working target environment takes priority over forcing a dependency upgrade.

Installation is transactional: `package.json` and every replaced package directory are backed up under `<profile>/.dsh-plugin-porter/backups/<stamp>/`; any failure restores them.

## Compatibility and limits

- **Same platform, architecture, and Node ABI**: packages are copied, not rebuilt. Native modules must match.
- **DSH version**: recorded and warned about on import, but not blocked.
- **peerDependencies** are not bundled; DSH or another installed plugin must provide them.
- **`pnpm-lock.yaml` is not updated.** A later online pnpm install may re-resolve dependencies.
- **Restart required** after install/update.
- **Web routes** sit behind DSH's trust fence (loopback, browser session, same-origin) and additionally require the `x-dsh-plugin-porter: 1` header on POST.
- **Only the current profile is modified**; the DSH installation directory is untouched.
- **Symlinks** are dereferenced on export and rejected on import if they escape the export root.

## Troubleshooting

- **No "Plugin Porter" section**: verify `dsh.profile.bundles` contains `dsh-plugin-porter`, `node_modules/dsh-plugin-porter/package.json` exists, and fully restart DSH.
- **Profile not found**: pass `-ProfileDir "C:\Users\you\.dsh\profiles\desktop"`.
- **Copy fails / file locked**: fully quit DSH, including the tray process.
- **Scan is slow**: every file is hashed. Large exports take time.
- **Upstream docs count is 0**: missing/non-GitHub `repository`, README filename not in the candidate list, or network restrictions. Local docs are still copied. On Windows the downloader falls back to PowerShell (system proxy); on Linux/macOS to `curl`.
- **Plugin not active after install**: restart DSH; a browser refresh is not enough.

## Development

```bash
node --check index.js
node --check client.js
node --check bin/porter.mjs

node bin/porter.mjs export --plugins dsh-skill-hub --out .porter-test/exports
node bin/porter.mjs scan --dir .porter-test/exports/<generated>
node bin/porter.mjs install --dir <export> --plugins dsh-skill-hub --profile-dir .porter-test/profile
```

No third-party npm dependencies; Node built-ins only.

## License

MIT
