# Notices

WorkBuddy Skin is an unofficial customization project. It is not affiliated
with, endorsed by, or sponsored by WorkBuddy, its publisher, OpenAI, or the
Codex Dream Skin project.

## Open-source basis

Parts of the external Chromium DevTools Protocol theming approach were derived
from [`Fei-Away/Codex-Dream-Skin`](https://github.com/Fei-Away/Codex-Dream-Skin),
which is distributed under the MIT License:

> Copyright (c) 2026 Codex Dream Skin Studio contributors

The source project's copyright notice is retained in `LICENSE`. WorkBuddy Skin
does not include the source project's demo artwork.

## Theme artwork inventory

The bundled catalog scenes are original, AI-assisted artwork created for
WorkBuddy Skin. They do not use an identified person's likeness or a named
franchise as a reference. Checksums identify the exact source bitmaps included
in this distribution.

| Catalog artwork | SHA-256 | Dimensions |
| --- | --- | --- |
| `plugins/workbuddy/catalog/city-rain/background.png` | `bc45ae96c51c1488808b907745fb8e783b3b224e11dc7646187b8fb6cc4ef12a` | 1672 x 941 |
| `plugins/workbuddy/catalog/coral-studio/background.png` | `957192169685d7e0ca4defff170022c87c9bbbf63e7ed5c7f62e5a220260ce55` | 1672 x 941 |
| `plugins/workbuddy/catalog/desert-dawn/background.png` | `5ba301312add3e41055acfeaa20a343fac82be7b5f521e791c4ff13ccd9b0a75` | 1672 x 941 |
| `plugins/workbuddy/catalog/forest-notes/background.png` | `c82ea7585af5bcc98c6a3307deca671accbb71bcee7da940c6726b924bdb4d50` | 1672 x 941 |
| `plugins/workbuddy/catalog/harbor-focus/background.png` | `ced18279dda4a159a67fb52ff513f34bff8c8110183723e4e71df6494e429ec3` | 1942 x 809 |
| `plugins/workbuddy/catalog/ink-courtyard/background.png` | `07cc9258096f44385cba14a4aca895686ef24621f79d84efbe96869740c9e804` | 1672 x 941 |
| `plugins/workbuddy/catalog/orbit-console/background.png` | `f27031c2a3d643c04969194ce0cf7e2651044e2f8a6be2a134c5445ab0dce1ca` | 1672 x 941 |
| `plugins/workbuddy/catalog/orchid-night/background.png` | `0c524043cf4fcdfb793c9bbce0564e3d1f4129275aeff817adf31bf7bc5dc43f` | 1942 x 809 |
| `plugins/workbuddy/catalog/paper-garden/background.png` | `9cf324c8831d7f526efad37cc8c37c5877a24241877465cefc4be2e55579d920` | 1942 x 809 |
| `plugins/workbuddy/catalog/winter-lodge/background.png` | `9f97d9c49d1d5f600ed8e114570a7497dfe7dae8189f8a3a5cc6f5afab398dfb` | 1672 x 941 |

Each preset may apply its own color, opacity, position, material, and overlay
through theme data. Users are responsible for having permission to use images
they add to custom themes.

## Product boundaries

Neither license grants rights to WorkBuddy, OpenAI, or other vendors'
trademarks, product names, logos, trade dress, application binaries, or bundled
application resources. This project does not redistribute a target application.

## Security model

WorkBuddy Skin stores themes locally and exposes a scoped CLI for theme
documents. Applying or restoring a theme is always an explicit CLI action.
Runtime connections use loopback-only local mechanisms; while a themed session
is active, treat its local debugging endpoint as sensitive and do not run
untrusted local software.
