# skin-cli Contract v1

## Targets And Commands

Use an explicit `--target` on every target-specific command. `trae` selects
Trae International or TRAE SOLO CN; `workbuddy` selects macOS WorkBuddy.

```bash
skin-cli targets
skin-cli paths --target trae
skin-cli templates --target trae
skin-cli template install violet-rift --as local-violet --target trae --dry-run
skin-cli theme inspect --target trae
skin-cli theme list --target trae
skin-cli theme read local-violet --target trae
skin-cli theme create new-theme --target trae --source blank --input @theme.json --dry-run
skin-cli theme update local-violet --target trae --expected-revision <sha256> --input @patch.json --dry-run
skin-cli theme asset import local-violet --target trae --expected-revision <sha256> --file /absolute/path/background.png --dry-run
skin-cli theme validate local-violet --target trae
skin-cli theme delete local-violet --target trae --edition international --expected-revision <sha256>
skin-cli status --target trae --edition international
skin-cli apply local-violet --target trae --edition international
skin-cli verify --target trae --edition international --screenshot /absolute/path/check.png
skin-cli preview local-violet --target trae --edition international --screenshot /absolute/path/preview.png
skin-cli restore --target trae --edition international
skin-cli doctor --target trae --edition international
```

`--input` accepts a JSON object as literal text, `@file` input, or `-` for
stdin. It is limited to 1 MiB. Create and update input is a structured theme
patch; validation input is a complete structured theme. Unknown, duplicate,
extra, and action-inapplicable arguments are rejected.

## Envelope

The CLI writes exactly one JSON document to stdout and exits with `0` on success
or `1` on failure.

```json
{
  "protocolVersion": 1,
  "ok": true,
  "operation": "theme.update",
  "scope": {
    "pluginId": "dreamskin.trae",
    "themeId": "local-violet"
  },
  "result": {}
}
```

Failures replace `result` with a stable `error` object containing `code`,
`message`, and optional `details`. Error envelopes do not expose a stack or
nested cause.

## Write And Runtime Safety

Always dry-run a theme update before committing it. A committed update, image
import, or delete must use the revision returned by the latest `read` or `list`.
On `REVISION_CONFLICT`, read and reconcile rather than retrying a stale write.

The CLI never accepts CSS, selectors, shell commands, runtime scripts, or
general-purpose file reads. `theme asset import` is the only asset-path command:
it accepts a regular PNG/JPEG/WebP file up to 16 MiB, rejects symlinks, verifies
its signature, and copies the bytes into the managed theme directory.

`status`, `apply`, `verify`, `preview`, and `restore` operate on the explicit
target runtime. Trae also accepts `--edition auto|international|cn`; select an
explicit edition when both are installed. `apply` and `restore` are
user-visible changes and require an explicit user request. Preview restores the
previous runtime state after it finishes.

## Theme Fields

- Content: `name`, `description`, `layout`, `brandSubtitle`, `tagline`,
  `statusText`, `quote`. Background `image` is managed by asset import.
- Semantic colors: `background`, `panel`, `panelAlt`, `accent`, `accentAlt`,
  `secondary`, `highlight`, `onAccent`, `success`, `warning`, `danger`, `info`,
  `disabled`, `text`, `muted`, `line`, `selection`, `terminal`.
- Interaction states: `surfaceHover`, `surfaceActive`, `focus`,
  `tooltipBackground`, `tooltipText`.
- Visual recipes: `motif`, `iconTreatment`, `surfaceTreatment`,
  `accentPlacement`, `cardTreatment`, `ornament`.
- Appearance: treatment, background positioning/blending/opacity,
  surface/sidebar opacity, blur, saturation, radius, shadow, and color scheme.

`theme inspect` describes the exact schema, semantic component slots, and enum
values for the selected target.

## Common Errors

- `REVISION_CONFLICT`: another write changed the theme; read and reconcile.
- `THEME_INVALID`: structured theme validation failed.
- `THEME_NOT_FOUND`: the requested id is absent.
- `THEME_ALREADY_EXISTS`: create selected an existing id.
- `THEME_ACTIVE`: restore or apply another theme before deleting the active one.
- `REPOSITORY_BUSY`: another transaction owns the repository lock.
- `INPUT_TOO_LARGE`: input exceeds 1 MiB.
- `INPUT_FILE_UNAVAILABLE`: an `@file` input is missing, unsafe, or unreadable.
- `ASSET_NOT_FOUND`, `INVALID_ASSET_PATH`, `INVALID_IMAGE`, `ASSET_TOO_LARGE`:
  the background import failed validation.
- `INVALID_ARGUMENT`: the command or its arguments violate the CLI contract.
