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

## Publish a release

1. Bump `version` in `apps/desktop/package.json`. The DMG title and the About panel read it.
2. Build the DMG as above, then open it and check the app launches, finds Python, and runs a cell.
3. Tag and publish:

   ```bash
   gh release create v0.2.0 apps/desktop/release/Dalliance.dmg --title "Dalliance 0.2.0" --notes-file notes.md
   ```

4. Keep the asset name `Dalliance.dmg`. The website's `/download` points at `releases/latest/download/Dalliance.dmg`, and so does the repo README.

The release notes must tell users how to get past Gatekeeper. The app isn't notarized, so macOS blocks the first launch. Users open System Settings > Privacy & Security and click Open Anyway. The v0.1.0 notes have the wording to reuse. They also need to say that the app wants Python 3.9 or newer.

## When there's a Developer ID

Set `mac.identity` to the certificate name, turn on `hardenedRuntime`, add entitlements that allow spawning Python, and add notarization. Then drop the Gatekeeper steps from the notes.
