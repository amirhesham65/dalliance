# Releasing

Dalliance ships as one universal `.dmg` for Apple Silicon and Intel Macs, attached to a GitHub release.

## Build the installer

```bash
pnpm --filter @dalliance/desktop dist:mac
```

`dist:mac` clears `dist/` and `dist-electron/`, runs the production build, and calls `electron-builder --mac`. The output is `apps/desktop/release/Dalliance.dmg`.

electron-builder reads its config from the `build` key in `apps/desktop/package.json`:

| Setting | Value | Why |
| --- | --- | --- |
| `files` | `dist/**`, `dist-electron/**` | Vite bundles every dependency, so `node_modules` stays out |
| `mac.target` | `dmg`, `universal` | One download for both architectures |
| `mac.identity` | `-` | Ad-hoc signing. There's no Developer ID yet |
| `mac.hardenedRuntime` | `false` | Required without notarization |
| `mac.icon` | `build/icon.png` | 1024 by 1024, drawn from the site's mark |
| `artifactName` | `${productName}.${ext}` | A stable name, so the download link never changes |
| `extendInfo` | `NSDocumentsFolderUsageDescription` | macOS asks before the app creates `Documents/Dalliance Notebooks` |
| `fileAssociations` | `.ipynb`, named "Jupyter Notebook", role `Editor` | Finder lists Dalliance under Open With for notebooks. The main process handles the `open-file` event |

## Publish a release

Releases publish from a version tag. `.github/workflows/release.yml` does the build on a macOS runner.

1. Bump `version` in `apps/desktop/package.json` in a pull request and merge it. The DMG title and the About panel read it.
2. Tag the merge commit on `main` with the same version and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The workflow checks that the tag matches the version and fails if it doesn't. It sets up Python 3.12 with pandas, NumPy and matplotlib and runs `pnpm turbo run lint typecheck test`, the same checks as CI, so a failing test stops the release. Then it runs `dist:mac --publish never` and `gh release create` with `Dalliance.dmg` and notes generated from the merged pull requests.
4. Edit the release on GitHub and add the install notes below. Generated notes only list pull requests.

Keep the asset name `Dalliance.dmg`. The website's `/download` points at `releases/latest/download/Dalliance.dmg`, and so does the repo README.

Before tagging, it's worth building the DMG locally and checking that the app launches, finds Python, and runs a cell. CI doesn't open the app.

### Install notes

The app isn't notarized, so macOS blocks the first launch. Every release needs to tell users to open System Settings > Privacy & Security and click Open Anyway, once. It also needs to say the app wants Python 3.9 or newer. The v0.1.0 release has the wording to reuse.

## When there's a Developer ID

Set `mac.identity` to the certificate name, turn on `hardenedRuntime`, add entitlements that allow spawning Python, and add notarization. Then drop the Gatekeeper steps from the notes.
