# Project apps

A prompt such as "Create an app that lets me filter @orders by plan" builds a local Streamlit app. Apps in the overview, or Cmd+7, lists the apps in the current workspace. Selecting an app starts its server and displays it inside Dalliance. The creation cell also has Open app.

## Design and appearance

Apps use Dalliance's design by default: bundled Inter and JetBrains Mono fonts, restrained heading sizes, warm neutral backgrounds, green accents, rounded controls, subtle borders and the shared chart colour palette. `electron/apps/theme.ts` supplies Streamlit's native light and dark theme configuration. No remote font requests or static-file serving are needed.

The theme follows Dalliance's system appearance without reloading Python or resetting widgets. `main.tsx` also subscribes to the main process's appearance event, since Electron can change media-query values without notifying existing listeners. For managed frames, the main process invokes Streamlit 1.66's theme recalculation hook on appearance changes. This compatibility adapter is covered by the real Electron smoke check. Changing `design` to `custom` in an explicit user request opts out of the managed theme. App code should not inject competing styles unless the user requests them.

## Files and ownership

Apps belong to the notebook's containing folder, following the existing workspace rule. There is no search for a parent project root. A notebook in a subfolder has that subfolder's apps. Save As into another folder stops the previous folder's servers and changes the apps shown; it does not copy app files. Move the whole project folder to carry its apps and snapshots with it.

```
apps/<id>/
  app.json                 title, source, snapshots, checks, design and verified environment
  app.py                   user-readable Streamlit source
  requirements.txt         requested dependencies
  requirements.lock.txt    exact installed versions after verification
  data/                    CSV and JSON notebook snapshots
apps/.history/<id>/        retained previous app folders, including their data
apps/.build-<uuid>/        unpublished candidate
apps/.checks-<uuid>/       disposable interaction-test copy
apps/.runtime-<uuid>/      temporary supervisor, entry point and theme configuration
```

Ids are stable. Regenerating the creation cell reuses its id, including after a notebook rename when the saved reference is present. Later cells can edit an app by id without changing its original source link. Deleting the source cell leaves the app. A renamed notebook's recorded source filename is not rewritten automatically; the app can still be edited from a new prompt.

Managed paths reject traversal and symlinks, and broad folders such as Documents cannot host managed apps. Only valid manifests whose ids match their folders are listed, up to 300 directory entries. Source is limited to 200,000 characters, with 20 snapshots of at most 100 MB each. Updates preserve user assets and app-created files; copying refuses special files and more than 5,000 entries.

## Safe updates and verification

`save_app` stages a complete candidate without changing published files or stopping the working server. It exports requested data, prepares its environment, runs interaction checks in a disposable copy, and opens a separate server for page verification. Only a successful candidate replaces the published directory. Failed exports, checks and page renders leave the published version and server available. A failed candidate's error is visible separately in the shell and the agent can repair it.

Checks specify a widget type, exact label, value different from its default, and expected visible result afterward. Supported controls include checkboxes, toggles, selectboxes, radio buttons, sliders, number inputs, text inputs, text areas, multiselects, date inputs and buttons. Streamlit AppTest checks startup exceptions, applies each interaction, requires visible output to change and checks the expected result. Interactive apps without a check fail verification with a list of their controls. Static reports need no interaction check. This tests specified flows, not every possible interaction. Apps whose primary flow depends on a control outside this list need a testable supported flow or an extension to the check schema.

`verifyAppPage` then opens a hidden sandboxed BrowserWindow without a preload, waits for the first script run, checks for exceptions and captures a screenshot. The agent inspects the screenshot and repairs visual problems before `finish`. Both the finish gate and text fallback reject failed app work. Failed app builds report the setup or verification error directly and clear any earlier cell success message, even when no notebook code ran. The published app remains on disk. Verification never becomes the user's browser session. A previously running app resumes after a successful promotion; a new app starts on demand.

Publication keeps the previous directory in history. A failed rename restores that directory. Restore prefers the latest version that passed page verification. History defaults to five previous versions, configurable in Settings > Apps from 1 to 20. Pruning preserves the latest verified version within the limit. Clear history and Delete app require explicit confirmation in the UI. Deletion removes the app's code, snapshots, app-created files and history, leaving notebook cells intact.

## Environments and reproducibility

Apps require Python 3.11 or newer because Streamlit 1.66 requires it, and support Streamlit 1.66 through the 1.x series. Notebook Python still supports 3.9 or newer.

`AppEnvironments` first reuses an existing verified app environment without consulting notebook settings. When creating an environment, it uses notebook Python if compatible, otherwise discovers a compatible installed Python without changing notebook settings. Recreating a lock searches for its exact Python version. If none is installed, the error asks for a compatible Python installation. Dalliance does not download Python itself.

Immutable virtual environments live under `userData/app-environments/<project-hash>/`, indexed by the chosen interpreter and dependency set, plus a lock index independent of notebook Python. Different projects do not share these environments. Verified apps record the Python version and all installed distribution versions, plus a portable lock file.

Preparing an environment goes through the existing package approval policy. `save_app.requirements` installs into the app environment; `install_packages` continues to target notebook Python. Installing or upgrading an app therefore does not modify notebook Python or a running app's environment. An app's locked environment is checked before reuse and recreated from exact versions if needed. An unavailable locked runtime produces a clear error; install the recorded Python or regenerate to verify the app with an available interpreter. Environment caches remain under userData and are separate from the bounded on-disk app history.

## Data freshness and refresh

Apps run independently of notebook variables. A requested DataFrame snapshot becomes CSV with no index; JSON-compatible values become JSON. Exports have a 20-second interrupt timer and a 100 MB per-file limit. Arbitrary objects and pickle files are not used. App source reads relative to its folder, such as `data/orders.csv`.

Each snapshot records its variable, file, export time and content hash. After a notebook run, Dalliance compares the current values with the saved source hashes. The shell shows when data changed. After a restart or when source variables are unavailable, it says to run the source notebook to check freshness. Refresh data exports those same variables and verifies the candidate using the existing source, checks and environment. It does not ask the agent to rewrite app code, and failure leaves the working data unchanged. CSV comparisons use the same serialization as the export.

Successful app cells save a valid Python comment reference from `packages/shared/src/apps.ts`. Ordinary reruns, Run All and Verify return the same reference output without writing files, launching servers or refreshing snapshots. Jupyter can open and execute the notebook, where the reference is simply a comment.

## Lifecycle and resources

Settings > Apps controls the background timeout, running-app limit and history size. Defaults are 15 minutes, three user apps and five previous versions. One temporary verification server may run in addition to the user app limit. A new user app is refused at capacity unless another app has already reached its safe idle-stop deadline. Visible or computing apps, apps with Keep running enabled, and apps with unknown execution status are never evicted to make room.

A hidden app gets an inactivity deadline. Foreground apps have no inactivity timeout. Keep running overrides the deadline per app for the session. The UI warns during the last minute and explains that stopping resets temporary widget state while preserving saved files. A computation that finishes after the deadline receives a fresh minute before stopping. Unknown or stale execution signals defer stopping. Changing policy resets background deadlines and prunes history to the new limit.

The Python supervisor reports script execution, fragment reruns and server-process memory over fd 3. Stdout and stderr remain separate, redacted and bounded to 24,000 characters. If Streamlit's runner hook is unavailable, execution status becomes unknown and automatic stopping is disabled for that server. Background threads outside Streamlit script execution need Keep running. Important results should be saved explicitly rather than relying on widget state.

The supervisor watches a stdin pipe owned by Dalliance. EOF terminates its own process group, covering parent crashes without persisting PIDs. Normal shutdown sends SIGTERM, then SIGKILL after 1.5 seconds if necessary. Servers bind only to loopback; browser auto-open, static serving, run-on-save and usage statistics are disabled. Provider credentials are removed from their environment.

Switching projects, closing the window and quitting stop servers. Restarting the notebook kernel, changing notebook Python and updating notebook libraries leave app servers alive. Starts and verifications in flight are cancelled during shutdown. Running iframe nodes stay mounted when switching between Apps and the notebook, so widget state survives that navigation. Stop, automatic stop, restart, successful app updates, window reload and leaving a workspace reset the browser session.

## Permissions

App source uses the same guarded code policy as notebook code. Secret reads are blocked; shell and network use follow the approval setting. Opening an existing app checks its source too. App browser permission checks, requests and device grants are denied by explicit handlers in both the real shell and the verifier. A narrow exception preserves clipboard writes from the trusted Dalliance main frame for Copy answer; app subframes receive no such grant.

The app iframe permits scripts, same-origin resources, forms and downloads. It cannot navigate the Dalliance top frame or open popups. Packaged CSP allows loopback frames; frame navigation is restricted to managed app origins. The preload exposes the privileged bridge only to the main frame, and IPC rejects subframes. Python retains the user's operating-system permissions; the code policy is not an OS sandbox.

## Troubleshooting

### Update libraries keeps an older Python version

Settings > Python controls notebook cells. Update libraries installs packages into the existing private notebook environment and keeps its Python version. A notebook on Python 3.9 can coexist with an app on Python 3.11 or newer. Apps choose a compatible installed Python automatically; changing the notebook's Python path is not required.

### No compatible Python was found

Install Python 3.11 or newer on the computer, then reopen or regenerate the app. Discovery checks the system Python and, on macOS, common Homebrew and python.org locations. Dalliance uses it to prepare the app's separate environment through the package approval policy. Notebook libraries and settings stay intact.

### A locked Python runtime is unavailable

Dalliance validates a cached app environment before reuse. If it cannot reuse that environment, recreating it needs the recorded Python version. Install that version or regenerate the app to verify its code and dependencies with an available interpreter. Regeneration replaces the published app only after its checks pass.

### An older app still opens after an update failed

The published app remains available when a candidate fails setup, interaction checks or page verification. The cell and app shell show the failed update separately. Use Edit or fix this app, or regenerate the creation cell, to repair it. A plain rerun of a saved app-reference cell only returns the saved reference; it does not retry a build or refresh data.

## Verification commands

Normal tests cover candidate publication and failure, snapshot export and freshness, history and deletion, filesystem boundaries, process ownership, cancellation, idle policy, limits, environment locks, permissions and UI controls:

```bash
pnpm --filter @dalliance/desktop test
```

The real integration check needs a desktop display and Python 3.11 or newer with pandas and matplotlib for the source kernel and app environment. It prepares an isolated Streamlit app environment without provider keys:

```bash
pnpm --filter @dalliance/desktop build
DALLIANCE_TEST_PYTHON=/path/to/python pnpm --filter @dalliance/desktop test:apps
```

It snapshots build output before launching, uses temporary project and userData directories, exports a DataFrame, shuts down its source kernel, runs interaction and page checks, then opens through the production shell and preload. It chooses a separate app runtime despite an unavailable notebook interpreter, then checks live widgets, server telemetry, bridge isolation, light/dark appearance without widget reset, session preservation when returning to the notebook, and Stop. Screenshots go in the reported temporary directory. It makes no model requests.
