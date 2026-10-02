# Releasing

Dalliance ships as one universal `.dmg` for Apple Silicon and Intel Macs. The website's download comes from the Vercel Blob store `dalliance-downloads`, on the `dalliance` Vercel project. The repo is private, so its GitHub releases are only a record.

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

3. The workflow checks that the tag matches the version and fails if it doesn't. It sets up Python 3.12 with pandas, NumPy, matplotlib and IPython 8 or 9 and runs `pnpm turbo run lint typecheck test`, the same checks as CI, so a failing test stops the release. Then it runs `dist:mac --publish never` and uploads `Dalliance.dmg` to the blob store twice: as `releases/<tag>/Dalliance.dmg`, kept for good, and over `Dalliance.dmg`, the one `/download` sends people to. That one has a five-minute cache, so a new release reaches the site within minutes. Last, `gh release create` records the tag, with the DMG and notes generated from the merged pull requests.

Keep the name `Dalliance.dmg`. `downloadUrl` in `apps/web/src/lib/site.ts` is its blob URL.

The upload needs the `BLOB_READ_WRITE_TOKEN` repository secret, the store's read-write token from the Vercel dashboard under Storage > dalliance-downloads.

To put an older build back, copy its versioned file over the latest one:

```bash
vercel blob copy releases/v0.2.0/Dalliance.dmg Dalliance.dmg
```

Before tagging, it's worth building the DMG locally and checking that the app launches, finds Python, and runs a cell. CI doesn't open the app.

### Install notes

The app isn't notarized, so macOS blocks the first launch. Every release needs to tell users to open System Settings > Privacy & Security and click Open Anyway, once. It also needs to say the app wants Python 3.9 or newer. The v0.1.0 release has the wording to reuse.

## Signing, notarization and auto-update

None of this is set up yet. Releases are ad-hoc signed, and that path keeps working until every step below is done. They need the owner's Apple Developer account, so they're a checklist rather than config in the repo. Do them in order, on a branch, and check a test tag before the next real release.

### 1. Get the credentials

- [ ] Join the Apple Developer Program (the paid membership, not a free account).
- [ ] In Xcode > Settings > Accounts > Manage Certificates, or at developer.apple.com > Certificates, create a **Developer ID Application** certificate. Export it from Keychain Access as a `.p12` with a strong password.
- [ ] At App Store Connect > Users and Access > Integrations > App Store Connect API, create a team key with the **Developer** role. Download `AuthKey_<KEY_ID>.p8` (it downloads once), and note the key ID and the issuer ID. electron-builder recommends an API key over an Apple ID and app-specific password.

### 2. Add the repository secrets

In GitHub > Settings > Secrets and variables > Actions:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | The `.p12`, base64: `base64 -i DeveloperID.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | The `.p12` password |
| `APPLE_API_KEY_P8` | The whole text of `AuthKey_<KEY_ID>.p8` |
| `APPLE_API_KEY_ID` | The key ID |
| `APPLE_API_ISSUER` | The issuer ID |

The release job already gets `GITHUB_TOKEN` and `BLOB_READ_WRITE_TOKEN`.

### 3. Add the entitlements

- [ ] Create `apps/desktop/build/entitlements.mac.plist`. With the hardened runtime on, Electron's V8 needs JIT and executable memory. The kernel is a separate `python` process, so spawning it needs no entitlement, and the app isn't sandboxed, so there's no sandbox key.

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
  </dict>
  </plist>
  ```

- [ ] Copy it to `apps/desktop/build/entitlements.mac.inherit.plist` for Electron's helper apps. electron-builder picks up both names from `build/` on its own.
- [ ] Only if a native Node module is ever added: add `com.apple.security.cs.disable-library-validation` to both.

### 4. Change the electron-builder config

In the `build` key of `apps/desktop/package.json`:

- [ ] In `mac`, delete `"identity": "-"`. With `CSC_LINK` set, electron-builder imports the certificate into a temporary keychain and finds it. Leaving `-` keeps signing ad-hoc.
- [ ] In `mac`, set `"hardenedRuntime": true`. Notarization rejects apps without it.
- [ ] In `mac`, add `"notarize": true`, `"gatekeeperAssess": false`, `"entitlements": "build/entitlements.mac.plist"` and `"entitlementsInherit": "build/entitlements.mac.inherit.plist"`. `notarize` reads `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` from the environment. electron-builder 26 takes a boolean here, not the older options object.
- [ ] For auto-update, add `zip` to `mac.target` next to `dmg`, both `universal`. The updater downloads the zip, never the DMG. `artifactName` gives it the stable name `Dalliance.zip`.
- [ ] For auto-update, add `"publish": [{ "provider": "generic", "url": "https://qxsto1algu0y5wp9.public.blob.vercel-storage.com" }]` at the top of `build`. The repo is private, so the updater can't read GitHub releases. electron-builder then writes `release/latest-mac.yml` and `Dalliance.zip.blockmap`, and bakes `app-update.yml` into the app so it knows where to look.
- [ ] Optionally, `"dmg": { "sign": true }` to sign the disk image as well. The app inside is what Gatekeeper checks, and it's stapled either way.

### 5. Change the release workflow

In `.github/workflows/release.yml`:

- [ ] Before the `dist:mac` step, write the key to a file:

  ```yaml
  - name: Write the notarization key
    env:
      APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY_P8 }}
    run: |
      printf '%s' "$APPLE_API_KEY_P8" > "$RUNNER_TEMP/AuthKey.p8"
      echo "APPLE_API_KEY=$RUNNER_TEMP/AuthKey.p8" >> "$GITHUB_ENV"
  ```

- [ ] Give the `dist:mac` step the signing and notarization variables. Keep `--publish never`, so the upload step stays the one place that publishes:

  ```yaml
  - run: pnpm --filter @dalliance/desktop dist:mac --publish never
    env:
      CSC_LINK: ${{ secrets.CSC_LINK }}
      CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
      APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
      APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
  ```

- [ ] Upload the update files next to the DMG, at the root of the blob store, with the same short cache. The updater reads `latest-mac.yml` there:

  ```bash
  for f in Dalliance.zip Dalliance.zip.blockmap latest-mac.yml; do
    npx --yes vercel@54 blob put "apps/desktop/release/$f" --access public --pathname "$f" --allow-overwrite true --cache-control-max-age 300
  done
  ```

  Keep the DMG's name. The website links to it.
- [ ] Add `timeout-minutes: 60` to the job. Notarization usually takes a few minutes but can queue for longer.

### 6. Check for updates in the app

This part touches the main process, `electron/main.ts`.

- [ ] Add `electron-updater` to the desktop app's `dependencies`. Vite bundles it into `dist-electron/main.js` like every other dependency. Check the build still starts, since `files` leaves `node_modules` out of the app.
- [ ] Once the window is up, check only in a packaged build:

  ```ts
  import { autoUpdater } from 'electron-updater'

  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('update check failed', err))
  ```

  `checkForUpdatesAndNotify()` downloads in the background, shows a system notification, and installs on quit. A menu item or a banner that calls `autoUpdater.quitAndInstall()` can come later.
- [ ] Mention update checks on the privacy page: the app then asks the blob store for `latest-mac.yml` on launch.

Squirrel.Mac only installs an update whose signature matches the running app's. Ad-hoc builds can't update themselves, so the first signed release has to be downloaded by hand, and updates work from there.

### 7. Check a signed build

- [ ] Build a signed DMG locally first, with the same variables exported in the shell and `APPLE_API_KEY` pointing at the `.p8` file: `pnpm --filter @dalliance/desktop dist:mac --publish never`. Don't test with a throwaway tag: the workflow would publish it as the latest release, and the website's download link would follow it.
- [ ] On a Mac that never ran Dalliance, download the DMG in a browser, so it gets the quarantine flag, and open the app. There should be no Open Anyway step.
- [ ] Run the checks. `spctl` should report `source=Notarized Developer ID`:

  ```bash
  codesign --verify --deep --strict --verbose=2 /Applications/Dalliance.app
  codesign -d --entitlements - /Applications/Dalliance.app
  spctl --assess --type execute -vv /Applications/Dalliance.app
  xcrun stapler validate /Applications/Dalliance.app
  ```

- [ ] Check the app still finds Python, sets up the managed environment, and runs a cell. That proves the entitlements.
- [ ] Install the previous signed release, publish a newer one, and check the old one offers the update.
- [ ] Drop the Open Anyway paragraph from [Install notes](#install-notes), and the row about `hardenedRuntime` from the table at the top.
