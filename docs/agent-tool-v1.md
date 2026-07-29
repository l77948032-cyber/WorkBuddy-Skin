# skin-cli Reference v1

`skin-cli` is the only public interface for this product. It manages structured
skins and their target runtime for Trae International, TRAE SOLO CN, and
WorkBuddy. WorkBuddy is supported on macOS only. All runtime-changing commands
require an explicit `--target`; do not rely on a default target.

## Install And Discovery

The CLI requires Node.js `>= 22.12`. Install the current GitHub source or a
tagged release tarball:

```bash
npm install --global github:l77948032-cyber/Agent-Dream-Skin
skin-cli --version
skin-cli targets
skin-cli paths --target trae
```

GitHub Releases publish the same npm tarball and `SHA256SUMS.txt`. It can be
installed with `npm install --global ./agent-dream-skin-X.Y.Z.tgz` after
verifying the checksum. No macOS application bundle, Apple certificate, or
notarization is involved.

`targets` reports the supported targets and their platform availability.
Friendly names map to stable plugin IDs:

| Target flag | Plugin ID | Supported hosts |
| --- | --- | --- |
| `trae` | `dreamskin.trae` | Trae International and TRAE SOLO CN |
| `workbuddy` | `dreamskin.workbuddy` | WorkBuddy on macOS |

## Commands

```text
skin-cli targets
skin-cli paths [--target <trae|workbuddy>]
skin-cli templates --target <trae|workbuddy>
skin-cli template install <templateId> --as <themeId> --target <trae|workbuddy> [--input <json|@file|->] [--dry-run]
skin-cli theme inspect --target <trae|workbuddy>
skin-cli theme list --target <trae|workbuddy>
skin-cli theme read <themeId> --target <trae|workbuddy>
skin-cli theme create <themeId> --target <trae|workbuddy> [--input <json|@file|->] [--source <templateId>] [--dry-run]
skin-cli theme update <themeId> --target <trae|workbuddy> --expected-revision <sha256> --input <json|@file|-> [--dry-run]
skin-cli theme asset import <themeId> --target <trae|workbuddy> --expected-revision <sha256> --file <image> [--dry-run]
skin-cli theme validate <themeId> --target <trae|workbuddy>
skin-cli theme validate --target <trae|workbuddy> --input <json|@file|->
skin-cli theme delete <themeId> --target <trae|workbuddy> --expected-revision <sha256> [--edition <auto|cn|international>]
skin-cli status --target <trae|workbuddy> [--edition <auto|cn|international>]
skin-cli apply <themeId> --target <trae|workbuddy> [--edition <auto|cn|international>]
skin-cli verify --target <trae|workbuddy> [--edition <auto|cn|international>] [--screenshot <png>]
skin-cli preview <themeId> --target <trae|workbuddy> [--edition <auto|cn|international>] [--screenshot <png>]
skin-cli restore --target <trae|workbuddy> [--edition <auto|cn|international>]
skin-cli doctor [--target <trae|workbuddy>] [--edition <auto|cn|international>]
```

`--input` accepts a JSON object as literal text, `@file` input, or `-` for
stdin. Input is limited to 1 MiB. Unknown, duplicate, extra, and
action-inapplicable arguments are rejected.

## Theme Workflows

Use a template when its starting point is close to the desired result:

```bash
skin-cli templates --target trae
skin-cli template install violet-rift --as violet-local --target trae --dry-run
skin-cli template install violet-rift --as violet-local --target trae
```

For an original theme, read the schema from `theme inspect` and create it with
a structured patch. Passing `--source blank` is equivalent to omitting
`--source`; a real source deep-inherits that template before the patch is
applied.

```bash
skin-cli theme inspect --target workbuddy
skin-cli theme create focus-room --target workbuddy --input @theme.json
```

For edits, preserve optimistic concurrency. The revision returned by `read` or
`list` is mandatory for `update`, asset import, and delete:

```bash
skin-cli theme read violet-local --target trae
skin-cli theme update violet-local --target trae \
  --expected-revision <revision> --input @patch.json --dry-run
skin-cli theme update violet-local --target trae \
  --expected-revision <revision> --input @patch.json
skin-cli theme validate violet-local --target trae
```

If a write reports `REVISION_CONFLICT`, read the theme again and construct a
fresh patch. Do not retry with a stale revision.

`theme asset import` is the only command that reads a caller-provided asset
path. It accepts a regular PNG, JPEG, or WebP file up to 16 MiB, rejects
symlinks, checks the extension and signature, and copies it into the managed
theme directory. Asset import creates a new revision.

## Runtime Workflow

Apply and restore intentionally change a target application. Check status
first, validate the theme, then verify the applied runtime:

```bash
skin-cli status --target trae --edition international
skin-cli apply violet-local --target trae --edition international
skin-cli verify --target trae --edition international --screenshot /absolute/path/trae-check.png
skin-cli restore --target trae --edition international
```

`preview` temporarily applies a theme, performs verification, and restores the
previous runtime state. `doctor` collects availability and status for one or
both targets. Trae accepts `auto`, `international`, or `cn`; use an explicit
edition whenever both variants are installed.

## JSON Envelope And Errors

Each invocation writes exactly one JSON v1 envelope to stdout. It exits with
`0` when `ok` is true and `1` otherwise. Consume `ok`, `operation`, `scope`,
and the stable `error.code`; do not parse human-oriented diagnostics.

```json
{
  "protocolVersion": 1,
  "ok": true,
  "operation": "theme.read",
  "scope": {
    "pluginId": "dreamskin.trae",
    "themeId": "violet-local"
  },
  "result": {}
}
```

Common error codes are `REVISION_CONFLICT`, `THEME_INVALID`,
`THEME_NOT_FOUND`, `THEME_ALREADY_EXISTS`, `THEME_ACTIVE`, `REPOSITORY_BUSY`,
`INPUT_TOO_LARGE`, `INVALID_IMAGE`, `ASSET_TOO_LARGE`, and `INVALID_ARGUMENT`.

## Safety, Backups, And Restore

- Themes are structured data; raw CSS, selectors, JavaScript, shell commands,
  and arbitrary target-file writes are not accepted from the CLI.
- Theme writes are validated before atomic replacement. The repository uses
  locks and transaction backups to recover interrupted writes.
- `restore` removes the currently applied skin for the explicit target and
  returns its runtime to the native state. It is not a theme-history rollback.
- `paths` reports the managed data, theme, runtime, and runtime-state roots for
  inspection. Do not edit these directories directly; use the CLI so revision,
  validation, and recovery rules remain intact.
