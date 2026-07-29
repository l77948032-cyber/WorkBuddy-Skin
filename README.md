# skin-cli

`skin-cli` is a local command-line tool for creating, applying, checking, and
restoring structured skins. It supports only **Trae International**, **TRAE SOLO
CN**, and **WorkBuddy**. WorkBuddy support is macOS-only; Trae is supported on
macOS and Windows where its runtime is available.

This product is the CLI itself: it has no graphical management application or
cloud service. Install it, choose a target explicitly, and keep control of every
runtime-changing command in your terminal.

## Install

`skin-cli` requires Node.js `>= 22.12`.

Install directly from the GitHub repository:

```bash
npm install --global github:l77948032-cyber/Agent-Dream-Skin
skin-cli --version
skin-cli targets
```

Tagged releases provide an immutable npm tarball. Substitute the release tag
and package version you downloaded:

```bash
npm install --global "https://github.com/l77948032-cyber/Agent-Dream-Skin/releases/download/vX.Y.Z/agent-dream-skin-X.Y.Z.tgz"
```

Every GitHub Release includes `SHA256SUMS.txt`. Verify the downloaded tarball
before installing it:

```bash
shasum -a 256 -c SHA256SUMS.txt
npm install --global ./agent-dream-skin-X.Y.Z.tgz
```

On Windows, compare
`(Get-FileHash .\agent-dream-skin-X.Y.Z.tgz -Algorithm SHA256).Hash.ToLowerInvariant()`
with the digest in `SHA256SUMS.txt`, then run the same
`npm install --global` command.
Examples below use POSIX `\` line continuations; enter wrapped commands on one
line in PowerShell.

No Apple Developer certificate, notarization step, or application bundle is
needed. `npm` is the installer and the GitHub Release tarball is the alternate
distribution channel.

## Targets

Start by checking the installed targets:

```bash
skin-cli targets
```

Use `--target trae` for both Trae International and TRAE SOLO CN. They are two
host editions of one Trae target and share the same themes, templates, and
commands; they are not separate modules or theme libraries. When only one
edition is available, `--edition auto` is sufficient. When both are installed,
select the host explicitly with `--edition international` or `--edition cn`.
Use `--target workbuddy` only on macOS. Both target names map to stable plugin
IDs; the CLI always returns the selected plugin ID in its JSON result.

## Templates And Custom Themes

List the templates available for a target, then install one under your own
theme ID. `--dry-run` validates the request without writing or applying it.

```bash
skin-cli templates --target trae
skin-cli template install violet-rift --as winter-code --target trae --dry-run
skin-cli template install violet-rift --as winter-code --target trae
```

To build a theme from scratch, inspect the target schema and create a theme
from a structured JSON patch:

```bash
skin-cli theme inspect --target workbuddy
skin-cli theme create calm-work --target workbuddy --input @theme.json --dry-run
skin-cli theme create calm-work --target workbuddy --input @theme.json
```

Use `--source <template-id>` with `theme create` when you want a custom ID based
on a template instead. To edit an existing theme, read its current revision,
dry-run the update, then repeat the command without `--dry-run` using that same
revision:

```bash
skin-cli theme read winter-code --target trae
skin-cli theme update winter-code --target trae \
  --expected-revision <revision-from-read> --input @patch.json --dry-run
skin-cli theme update winter-code --target trae \
  --expected-revision <revision-from-read> --input @patch.json
skin-cli theme validate winter-code --target trae
```

Backgrounds are imported through the guarded asset command only:

```bash
skin-cli theme asset import winter-code --target trae \
  --expected-revision <revision-from-read> --file /absolute/path/background.png
```

Read the theme again after an asset import because it produces a new revision.

## Apply, Check, Restore

Runtime changes are explicit. Check the current state before applying, verify
afterward, and restore the target's native state when you are finished:

```bash
skin-cli status --target trae --edition international
skin-cli apply winter-code --target trae --edition international
skin-cli verify --target trae --edition international --screenshot "$PWD/trae-skin.png"
skin-cli restore --target trae --edition international
```

`preview <theme-id>` temporarily applies and verifies a theme, then restores the
previous state. `doctor` reports target availability and runtime status:

```bash
skin-cli preview winter-code --target trae --edition international --screenshot "$PWD/preview.png"
skin-cli doctor --target trae --edition international
```

## Safety And Data

- Every command writes one JSON v1 envelope to stdout and exits with `0` or `1`.
- Theme writes are schema-validated, revision-checked, locked, and committed
  atomically. A `REVISION_CONFLICT` means read the theme again before retrying.
- Raw CSS, selectors, arbitrary scripts, and arbitrary target-file writes are
  not accepted. Asset import accepts only regular PNG, JPEG, or WebP files and
  copies validated bytes into the managed theme library.
- The repository keeps transaction backups so interrupted theme writes can be
  recovered. `restore` is a runtime operation: it removes the currently applied
  skin and returns the selected target to its native runtime state.
- Existing theme data from earlier DreamSkin Studio releases is reused in
  place. `skin-cli paths` reports `usingLegacyDataRoot: true` when this
  compatibility path is active; no theme library is silently moved or deleted.
- `apply`, `verify`, `preview`, and `restore` operate only on the explicit
  target and Trae edition. Auto-detection fails closed instead of choosing an
  arbitrary installation when the intended host is ambiguous.

See [the CLI reference](docs/agent-tool-v1.md),
[architecture notes](docs/architecture.md), and the
[release checklist](docs/release-checklist.md) for the complete contract.

## Development

```bash
npm install
npm test
npm run pack:check
npm pack
```

Package verification rejects non-CLI application sources from the npm tarball.
GitHub tag releases run the CLI tests, package the tarball, globally install it
in a temporary prefix for a smoke test, generate `SHA256SUMS.txt`, and publish
those two files to GitHub Releases. The workflow never runs `npm publish`.

## License

[MIT](LICENSE)
