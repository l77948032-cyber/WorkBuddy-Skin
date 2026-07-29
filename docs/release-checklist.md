# skin-cli Release Checklist

This checklist covers the npm tarball and GitHub Release only. There is no
application bundle, Apple certificate, code-signing, or notarization gate for
`skin-cli`.

## Before Tagging

- [ ] Confirm `package.json` has the intended version and Node requirement.
- [ ] Confirm the changelog or release notes describe only `skin-cli` behavior.
- [ ] Run `npm ci`.
- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Run `npm run pack:check` to build and inspect the CLI package contents.
- [ ] Run `npm pack` and confirm the resulting `.tgz` contains no non-CLI
  application sources or build resources.

## Local Global-Install Smoke Test

Install the produced tarball exactly as a user would. A temporary prefix keeps
the test separate from the developer's global npm packages:

```bash
prefix="$(mktemp -d)/skin-cli"
package="$(find . -maxdepth 1 -name 'agent-dream-skin-*.tgz' -print -quit)"
npm install --global --prefix "$prefix" "$package"
export DREAMSKIN_USER_DATA_ROOT="${prefix}/user-data"
export DREAMSKIN_DATA_ROOT="${prefix}/data"
export DREAMSKIN_TRAE_RUNTIME_STATE_ROOT="${prefix}/trae-runtime"
export DREAMSKIN_WORKBUDDY_RUNTIME_STATE_ROOT="${prefix}/workbuddy-runtime"
"$prefix/bin/skin-cli" --version
"$prefix/bin/skin-cli" targets
"$prefix/bin/skin-cli" templates --target trae
```

The smoke test must execute the installed `skin-cli`, not `node bin/skin-cli.mjs`
from the checkout.

## GitHub Release

Push an annotated tag matching the package version:

```bash
version="$(node -p "require('./package.json').version")"
git tag -a "v$version" -m "skin-cli v$version"
git push origin "v$version"
```

The `skin-cli Release` workflow performs these gates in order:

1. `npm ci`, `npm run check`, `npm test`, and `npm run pack:check`.
2. `npm pack` to create exactly one `.tgz`.
3. Global install into a temporary prefix with isolated CLI data, followed by
   `--version`, `targets`, and `templates --target trae` smoke commands.
4. SHA-256 generation in `SHA256SUMS.txt`.
5. Artifact upload for every run and GitHub Release publication for a matching
   `vX.Y.Z` tag.

The Release must contain exactly the `.tgz` and `SHA256SUMS.txt`. Downloaders
can verify it with:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

The workflow intentionally does **not** invoke `npm publish`. Publishing to the
npm registry is a separate, deliberate operation with its own credentials and
approval.

## Stop Conditions

Do not publish when any of the following is true:

- The tag does not exactly match `v` plus `package.json`'s version.
- Tests, package verification, or global-install smoke testing fails.
- The tarball contains non-CLI application sources or build resources.
- The checksum file is missing or does not verify the release tarball.
- The CLI documents or exposes a target other than Trae International, TRAE
  SOLO CN, or macOS WorkBuddy.
