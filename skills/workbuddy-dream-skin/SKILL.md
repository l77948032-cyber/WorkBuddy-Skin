---
name: workbuddy-dream-skin
description: Use when an agent needs to inspect, create, edit, apply, verify, or restore a WorkBuddy skin through the local workbuddy-skin command.
---

# WorkBuddy Skin

Use `workbuddy-skin` instead of editing generated CSS, WorkBuddy application
files, runtime state, or CDP settings directly. The CLI is dedicated to
WorkBuddy on macOS and Windows and writes one JSON protocol envelope to stdout.
Treat a nonzero exit code or `ok: false` as failure.

## Theme Workflow

1. Run `workbuddy-skin theme inspect` before changing a theme.
2. Run `workbuddy-skin templates` to discover bundled starting points.
3. Install a template with `workbuddy-skin template install <templateId> --as
   <themeId>`, or create an original theme with `workbuddy-skin theme create`.
4. Read the theme and retain its revision:
   `workbuddy-skin theme read <themeId>`.
5. Dry-run an update with `workbuddy-skin theme update <themeId>
   --expected-revision <revision> --input @change.json --dry-run`.
6. Repeat without `--dry-run`, then run `workbuddy-skin theme validate
   <themeId>`.

Use `--input -` for JSON on stdin, `--input @file.json` for a JSON file, or
`--input '{...}'` for a literal object. For a replacement background, import a
PNG, JPEG, or WebP with `workbuddy-skin theme asset import`, passing the latest
revision.

## Runtime Workflow

Runtime commands have user-visible effects. Apply a theme only after the user
asks:

```bash
workbuddy-skin status
workbuddy-skin apply <themeId>
workbuddy-skin verify --screenshot /absolute/path/check.png
```

`workbuddy-skin preview <themeId>` temporarily applies and verifies a theme,
then restores the previous state. `workbuddy-skin restore` removes the active
skin and returns WorkBuddy to its native appearance. `workbuddy-skin doctor`
reports local availability and runtime status.

## Guardrails

- Never pass `--target`, `--plugin`, or `--edition`; this CLI has one fixed
  WorkBuddy target.
- Never write raw CSS, selectors, JavaScript, WorkBuddy bundle files, or runtime
  state.
- Never bypass a revision conflict. Read the theme again and reconcile the
  intended change.
- Do not apply or restore merely because a theme was created or validated.
- Consume the JSON envelope on stdout instead of parsing log text.
