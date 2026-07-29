---
name: trae-dream-skin
description: Use when an agent needs to inspect, create, edit, apply, verify, or restore a Trae or WorkBuddy skin through the local skin-cli command. WorkBuddy is macOS-only.
---

# skin-cli

Use `skin-cli` instead of editing generated CSS, target application files,
runtime state, or CDP settings directly. The supported targets are Trae
International, TRAE SOLO CN, and macOS WorkBuddy only. Every command writes one
JSON v1 envelope to stdout; treat a nonzero exit code or `ok: false` as failure.

## Theme Workflow

1. Run `skin-cli targets` and choose an explicit `--target`.
2. Run `skin-cli theme inspect --target <trae|workbuddy>` before changing a theme.
3. Use `skin-cli templates --target ...` and `template install` for a copy of a
   catalog template, or `theme create` with structured JSON for an original theme.
4. Run `skin-cli theme read <themeId> --target ...` and preserve its revision.
5. Dry-run an update with `theme update ... --expected-revision <revision>
   --input @change.json --dry-run`.
6. Repeat the update without `--dry-run`, then run `theme validate`.
7. After an explicit request to change the running application, run `status`,
   `apply`, and `verify`; run `restore` only when explicitly requested.

Use `--input -` for JSON on stdin, `--input @file.json` for a JSON file, or
`--input '{...}'` for a literal object. Theme creation accepts `--source
<templateId>`; omit it or use `--source blank` for a new base theme.

For a generated or replacement background, create or select a PNG, JPEG, or
WebP file, then dry-run and commit `skin-cli theme asset import` with the
revision returned by the latest read. Read the theme again after import because
the asset commit creates a new revision.

## Runtime Workflow

Runtime commands have user-visible effects. Do not apply a skin merely because
it was created or validated. For an approved apply, use:

```bash
skin-cli status --target trae --edition <auto|international|cn>
skin-cli apply <themeId> --target trae --edition <auto|international|cn>
skin-cli verify --target trae --edition <auto|international|cn> --screenshot /absolute/path/check.png
```

`preview <themeId>` restores the prior runtime state after verification.
`restore --target ...` removes the active skin and returns that target to its
native state. `doctor [--target ...]` reports availability and status.

## Guardrails

- Always pass `--target`; never infer a target or reuse a result across targets.
- Use `trae` for Trae International or TRAE SOLO CN, and `workbuddy` only on
  macOS.
- When both Trae editions are installed, pass `--edition international` or
  `--edition cn`; never rely on discovery order.
- Never write raw CSS, DOM selectors, JavaScript, target application files, or
  runtime state.
- Never bypass a revision conflict. Read the theme again and reconcile the
  intended change.
- Treat a missing semantic component as a plugin enhancement, not permission to
  inject an ad hoc selector.
- Apply, preview, verify, and restore only through `skin-cli` and only for the
  target requested by the user.
- Do not parse human log text. Consume the versioned JSON envelope on stdout.

Read [references/tool-api.md](references/tool-api.md) for the command contract,
transaction behavior, theme fields, and error codes.
