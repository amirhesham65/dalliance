# Releasing

Dalliance ships as one universal `.dmg` for Apple Silicon and Intel Macs. Downloads come from [amirhesham65/dalliance-releases](https://github.com/amirhesham65/dalliance-releases), which holds a README and the installers, never code. Its GitHub releases are the downloads; this repo's releases are only a record.

## Build the installer

```bash
pnpm --filter @dalliance/desktop dist:mac
```

`dist:mac` clears `dist/` and `dist-electron/`, runs the production build, and calls `electron-builder --mac`. The output in `apps/desktop/release/` is `Dalliance.dmg`, plus the update files `Dalliance.zip`, `Dalliance.zip.blockmap` and `latest-mac.yml`.

electron-builder reads its config from the `build` key in `apps/desktop/package.json`:

| Setting | Value | Why |
| --- | --- | --- |
| `files` | `dist/**`, `dist-electron/**` | Vite bundles every dependency, so `node_modules` stays out |
| `mac.target` | `dmg` and `zip`, both `universal` | One download for both architectures. The zip is what electron-updater will download once releases are signed |
| `publish` | `generic`, at `releases/latest/download` in `dalliance-releases` | Makes electron-builder write `latest-mac.yml`, and bake `app-update.yml` into the app for electron-updater later. A plain URL rather than the `github` provider, so checks never touch GitHub's rate-limited API. `--publish never` keeps electron-builder from uploading anything itself |
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

3. The workflow checks that the tag matches the version and fails if it doesn't. It sets up Python 3.12 with pandas, NumPy, matplotlib and IPython 8 or 9 and runs `pnpm turbo run lint typecheck test`, the same checks as CI, so a failing test stops the release. Then it runs `dist:mac --publish never` and publishes a release in `dalliance-releases` with `Dalliance.dmg` and the update files, its notes from `.github/release-notes.md`. Last, it records the tag here, with notes generated from the merged pull requests.
4. Edit the release in `dalliance-releases` to add what's new above the install notes. Generated notes stay in the source repository.

Keep the file names. `downloadUrl` in `apps/web/src/lib/site.ts` is `releases/latest/download/Dalliance.dmg` in `dalliance-releases`, and the app reads `releases/latest/download/latest-mac.yml`, so both follow the newest release on their own.

Publishing there needs the `RELEASES_TOKEN` repository secret: a fine-grained personal access token with access to `dalliance-releases` only and Contents set to read and write. `GITHUB_TOKEN` can't write to another repo.

To put an older build back, delete the newer release in `dalliance-releases` (or mark it as a pre-release), and `latest` falls back to the one before.

Before tagging, it's worth building the DMG locally and checking that the app launches, finds Python, and runs a cell. CI doesn't open the app.

### Install notes

The app isn't notarized, so macOS blocks the first launch. Every release needs to tell users to open System Settings > Privacy & Security and click Open Anyway, once. Notebook cells need Python 3.9 or newer; Apps need a compatible installed Python 3.11 or newer and prepare separate environments. Dalliance does not download Python itself. `.github/release-notes.md` has the wording, and every release in `dalliance-releases` starts from it.

## Update notices

Releases are ad-hoc signed, so the app can't install an update itself (see the end of the checklist below). Instead it says one is out and links to the download:

1. `Updates` in `electron/updates.ts` fetches `latest-mac.yml` from the latest release in `dalliance-releases` when the app starts, and every six hours after. Only packaged builds check. A release without the file, such as v0.3.0, or a failed request counts as nothing newer.
2. A later plain `x.y.z` than `app.getVersion()` goes to the page through `onUpdate`. Pre-releases are never offered.
3. `UpdateBanner` says "Dalliance 0.4.0 is available." Download opens `dalliance.io/download?from=update`, and the user drags the new app over the old one in Applications. It has the same name and app ID, so it replaces the old one, and settings, provider keys and drafts carry over.

The privacy page lists the check, so change both together.

### The Terminal installer

`apps/web/public/install.sh`, served at `dalliance.io/install.sh`, installs the latest release without the unidentified developer warning:

```bash
curl -fsSL https://dalliance.io/install.sh | sh
```

curl doesn't quarantine what it downloads, so Gatekeeper never checks the app. The script downloads the DMG through `/download?from=install`, mounts it, and replaces `Dalliance.app` in `/Applications`, or in `~/Applications` when `/Applications` isn't writable. It stops if Dalliance is running. The home page shows the command under each download button, from `InstallCommand` in `apps/web/src/components/`. Once releases are notarized it isn't needed, but it keeps working.

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

The release job already gets `GITHUB_TOKEN` and `RELEASES_TOKEN`.

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

- [ ] Add `timeout-minutes: 60` to the job. Notarization usually takes a few minutes but can queue for longer.

### 6. Install updates in the app

The zip, `latest-mac.yml`, the `publish` feed and the banner are already in place, see [Update notices](#update-notices). What's left is installing.

- [ ] Add `electron-updater` to the desktop app's `dependencies`. Vite bundles it into `dist-electron/main.js` like every other dependency. Check the build still starts, since `files` leaves `node_modules` out of the app.
- [ ] In `electron/updates.ts`, let `autoUpdater` check on the same schedule, still only in a packaged build. It reads the same `latest-mac.yml` and downloads the zip in the background. Set `found` on its `update-downloaded` event, so a version reaches the page once it's ready to install.
- [ ] Make `download()` call `autoUpdater.quitAndInstall()`, and rename it and its IPC call to say install.
- [ ] In `UpdateBanner`, say "Dalliance 0.4.0 is ready." and label the button Restart to update.
- [ ] Check the privacy page's update row still describes what the app sends.

Squirrel.Mac only installs an update whose signature matches the running app's. Ad-hoc builds can't update themselves, so the first signed release has to be downloaded by hand. The banner in the ad-hoc builds is what tells people about it, and updates install themselves from there.

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
