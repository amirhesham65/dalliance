# The renderer

The UI is React 19 with zustand for state, shadcn components on Radix, and Tailwind v4. It lives in `apps/desktop/src/`.

```
src/
  main.tsx                    theme, session restore, ?demo, render
  App.tsx                     menu handling, keyboard modes, the three-column layout
  store/notebook-store.ts     all document and run state, and every action
  components/
    app/                      TopBar, Sidebar (the overview), IconButton, MakerLogo
    settings/                 the Settings screen and one component per section
    notebook/                 NotebookView, CellView, editors, text renderers
    notebook/outputs/         OutputView: tables, images, text, errors, printed output
    panes/                    Brief, Variables & Environment, History, Files, Pinned, Activity
    welcome/                  first-run setup and the start page
    ui/                       shadcn components, generated. Edit sparingly
  lib/notebook/text.ts        Markdown, answers, @refs, Python highlighting, titles, durations
  lib/notebook/samples.ts     starter prompts and the sample notebook
  lib/makers.ts               model maker logos
  hooks/                      useMediaQuery, and shadcn's useIsMobile
  dev/demo.ts                 the fake bridge behind ?demo
  test/                       jsdom setup and fakeApi
```

## The store

`src/store/notebook-store.ts` exports `useNotebook`, a zustand store, and `actions`, plain functions that change it. Components read with selectors, `useNotebook((s) => s.pane)`, and call `actions.*`. Besides the actions, `App.tsx`, `main.tsx` and the Settings sections write bridge results straight into `settings`, `python`, `kernel`, `account` and `billing`.

Saved with the notebook: `notebook`. Everything else is session state:

| Key | Holds |
| --- | --- |
| `screen` | `'welcome'` or `'notebook'`. The notebook stays loaded behind the start page |
| `settingsPage` | The open Settings section, or null. Settings covers whichever screen is up. See [Settings](#settings) |
| `path`, `dirty` | The file and whether it has unsaved changes |
| `selectedId`, `focusId` | Selection, and a cell whose editor should take focus next render |
| `runs` | `CellRun` per queued or running cell: status text, activity, live outputs, live code, a pending question or approval |
| `activity` | Each cell's activity from its last generation |
| `messages` | Non-Python errors per cell |
| `log` | The Activity pane's entries, newest first, at most 60. A run's entry has its `cost`, shown only with Show costs on |
| `spend` | What the notebook's runs and cell names have cost since it loaded, and how many runs' credits are still counting. Clear keeps it, `load()` starts it again |
| `lastFinishedId` | The cell that shows its suggestions |
| `pane`, `pinnedIds` | The open side pane and pinned cells |
| `brief`, `models`, `variables`, `settings`, `python`, `kernel` | Data from the main process |
| `environment`, `environmentLoading`, `environmentStale` | The Python's libraries once the Environment view has asked, whether a read is under way, and whether they may be out of date. See [Side panes](#side-panes) |
| `variablesView` | Which view the Variables & Environment pane shows |
| `notice` | The message at the bottom of the window, with an Undo when the change can be taken back. See [Notices and errors](#notices-and-errors) |
| `verify`, `verifyAsking` | The last Verify run's report, and whether its confirmation is showing. See [Verify](#verify) |
| `pinChanges` | What differs from the notebook's pins, for the banner over the notebook. Empty when nothing does, or once dismissed. See [Layout](#layout) |

`getApi()` and `setApi()` wrap `window.dalliance`, so tests and the demo can swap in a fake.

### Undo and redo

`actions.undo()` and `actions.redo()` take back and redo notebook edits: insert, delete, move, the note or prompt switch, an assumption correction and a restored revision. Each action records an operation on one cell in a module-level stack, not a snapshot of the notebook:

| Edit | Records | Undo |
| --- | --- | --- |
| `insert` | The cell and its index | Removes it, keeping what was typed so Redo brings it back |
| `delete` | The cell and its index | Puts it back at that index |
| `move` | The cell and the direction | Moves it the other way |
| `swap` | The whole cell before and after M or Y | Switches back, carrying over text typed since |
| `fields` | Only the fields a correction or restore changed | Puts those fields back |

Because nothing else is recorded, undo never touches other cells, and it never rolls back a run: a `swap` or `fields` edit whose cell has run since, so its outputs or fields no longer match, is dropped instead of applied, and the next one down is undone. The stack holds 100 edits, a new edit clears the redo side, and `load()` clears both. Text typed into a field isn't on it; fields keep their native undo.

The notices for D D and M offer Undo through the same stack. Their button undoes only while that edit is still the last one, and a newer edit or a Cmd+Z retires the notice.

### The run queue

`queue` and `pump()` live at module level. `actions.run(id)` pushes an id unless it's already queued or running. `pump()` runs one cell at a time: it builds the request, awaits `api.runCell()`, and calls `finish()`. Events for the running cell arrive through `applyRunEvent()`. When the queue empties, the store refreshes variables and calls `environmentChanged()`, since a cell may have installed a library.

`pump()` passes the cell as it was sent to `finish()`. The user can keep typing while the agent works. If the prompt or the code changed during the run, their edits stay, `generatedFrom` is the prompt that was sent, and the cell ends `edited` instead of `done`. The next run then regenerates for the new prompt, or runs their code. History keeps the version that ran.

`interrupt()` empties the queue and drops queued runs, then calls the bridge. `deleteCell()` interrupts the cell if it's running. `restart()` interrupts, restarts the kernel, marks every cell that has run `stale` with no execution count, and calls `environmentChanged()`. Verify's reruns go through the same queue, see [Verify](#verify).

A result must land only in the cell and notebook that asked for it. `load()`, which New, Open, a recent file, the start page and session restore all go through, clears the queue and interrupts a running cell before it swaps the notebook in. That cell's id goes into `abandoned`, as does a running cell that is deleted, and `finish()` drops an abandoned result without touching any cell, even one with the same id: reopening the same file, or Undo after a delete, brings the id back. `finish()` also ignores a cell that no longer exists, and a `title` event for a missing cell changes nothing and leaves `dirty` alone.

What `finish()` does to a cell is in [notebook-model.md](notebook-model.md#after-a-run).

### Verify

The Verify button in the notebook's header, and Kernel > Verify Notebook… in the menu, call `askVerify()`, which opens `VerifyConfirm` in `notebook/VerifyReport.tsx`. Its Verify calls `actions.verify()`:

1. `interrupt()`, then `beforeVerify()`, the place for checks before the restart (see [notebook-model.md](notebook-model.md#verifying-a-notebook)).
2. A report with one entry per prompt cell: its code and outputs as they are now, and the seed warnings read from the code. The phase is `restarting`.
3. The same restart as `restart()`, through `restartKernel()`, so the tab keeps its one kernel. If it fails, the phase is `failed` with the reason, and nothing runs.
4. Every cell with code goes on the queue, recorded in `verifyRuns` with the code it started with. `pump()` runs those with `generate: false` and `nameIt: false`, whatever `needsGeneration()` says, and hands the result to `finishVerify()` instead of `finish()`. The result lands in the report, never in the cell's outputs. Only a cell that came back the same changes, back to `done`.
5. When no rerun is left, the phase is `done`, and the Activity pane gets one `verified` entry: "Verified 5 cells: 3 the same, 1 changed, 1 failed."

Stop is the usual `interrupt()`. It drops the cells still waiting, which the report lists as not run, and the phase is `stopping` until the running cell answers, then `stopped`. Stopped during the restart, nothing runs. A cell deleted or made a note while it waits is listed as not run, and `load()` drops the report with the rest of the session state. While Verify runs the Verify button is off, and the report has its own Stop.

`VerifyReportView` sits above the cells until it's closed. It says where the run is, then gives one row per prompt cell with its result in words. A failed row shows the error in one line and, for a `NameError`, why the name was missing. Seed warnings show under their cell. A changed row, or one whose figure differs, folds out the saved and new outputs side by side through `OutputList`, and offers Keep the new outputs. That calls `keepVerified()`, an undoable edit with a notice, which applies only while the cell still has the code that ran.

## Layout

`App.tsx` renders the top bar and then `Workspace`, three columns from `react-resizable-panels`:

```
┌──────────┬────────────┬──────────────────────────┐
│ Overview │ Side pane  │ Notebook                 │
│ 220-420  │ 280-680    │ at least 360             │
└──────────┴────────────┴──────────────────────────┘
```

The overview sits in its own outer group, so opening a side pane never changes its width. Both groups use `preserve-pixel-size`. Widths persist through `useDefaultLayout` in `localStorage` under `dalliance-overview` and `dalliance-panes`. Whether the overview is open is `dalliance-sidebar`. Every column is a `Pane` from `components/panes/Pane.tsx`: a rounded card on the canvas.

Below 1200 px wide, `NARROW_WINDOW` in `App.tsx`, there is no room for a side pane column without squeezing the notebook to its minimum. `PaneOverlay` then draws the side pane over the notebook's left edge, 400 px wide at most, with a light scrim over the rest. Esc closes it and puts focus back where it was. A click on the scrim closes it and leaves focus with the notebook. Esc inside a text field, menu or dialog stays with that control. `useMediaQuery()` in `hooks/use-media-query.ts` follows the width.

A banner above the workspace asks for a sign-in, a Python or missing packages when the account or Python state say so. `signedIn()` in `lib/cloud.ts` decides the first, and an account not answered yet counts as signed in, so nothing flashes up. Its Open Settings goes to Account for a sign-in and Python otherwise. It has a cross on its right. Dismissing it hides that message for the session: it comes back if the message changes, or once the problem has been fixed and returns.

Under it, `PinChangesBanner` in `components/notebook/` says what changed since the notebook was saved, from `pinChanges`: "Changed since this notebook was saved: pandas 2.1.0, now 2.2.3; data/visits.csv has changed." `describePinChange()` in `lib/pins.ts` words each change. It lists three and folds the rest behind an "and 2 more" button, and it isn't there at all when nothing changed. Its cross calls `dismissPinChanges()`, which hides it until the next check. `load()` starts a check for a notebook with pins without waiting for it, and `checkPins()` runs one on demand and returns the changes, which is what Verify should await before it restarts the kernel. A check for a notebook that another has replaced since is dropped. See [notebook-model.md](notebook-model.md#pins).

## Keyboard

The main process menu owns the global shortcuts. The renderer owns the rest.

| Keys | Where | Does |
| --- | --- | --- |
| Cmd+N, Cmd+O, Shift+Cmd+O, Cmd+S, Shift+Cmd+S | Menu | New, Open, Open Folder, Save, Save As |
| Cmd+Z, Shift+Cmd+Z | Menu, and command mode | Undo, Redo. In a text field, the field's own undo. Elsewhere, notebook edits. See [Undo and redo](#undo-and-redo) |
| Cmd+, | Menu | Settings |
| Shift+Cmd+Enter | Menu | Run all |
| Cmd+. | Menu | Interrupt |
| Cmd+B | Renderer, shown in the menu | Toggle the overview and side pane |
| Cmd+1 to Cmd+6 | Renderer, shown in the menu | Brief, Variables & Environment, History, Files, Pinned, Activity |
| Shift+Enter | Editor or command mode | Run and move to the next cell, adding one at the end |
| Cmd+Enter | Editor or command mode | Run in place |
| Alt+Enter | Editor | Run and insert a cell below |
| Esc | Editor | Leave the editor for command mode. A note's preview takes focus back |
| Esc | Side pane over the notebook | Close it |
| Enter | Command mode, or a note's preview | Edit the selected cell |
| A, B | Command mode | Insert a prompt cell above, below |
| M, Y | Command mode | Make the cell a note, a prompt. A note keeps only the prompt, so M on a cell with code, outputs or history offers Undo |
| T | Command mode | Fold or unfold tables |
| D D | Command mode | Delete, with a 6 second Undo notice |
| Up, Down, J, K | Command mode | Move the selection |

Command mode is `useCommandMode()` in `App.tsx`. It listens only while focus is inside the notebook column, marked `data-command-scope` on `NotebookView`'s `<main>`, or on nothing at all, the body. Keys pressed on a button in the overview, a side pane or the top bar never act on the selected cell, so D D there deletes nothing. Inside the notebook it still stays off while a text field, dialog or listbox has focus, and it skips a key another handler already took with `preventDefault()`. Editor keys are `editorKeys()` in `CellView.tsx`. `useScopedSelectAll()` makes Cmd+A select only the text field, answer or output that holds the selection, like a desktop app.

Undo and Redo come two ways. The Edit menu in `electron/menu.ts` replaces the built-in undo and redo roles with items that send `'undo'` and `'redo'` menu actions; cut, copy, paste and select all keep their roles. `editFromMenu()` in `App.tsx` runs `document.execCommand('undo')` or `'redo'` when a text field has focus, since the role no longer does it, and notebook undo otherwise. Command mode also handles Cmd+Z and Shift+Cmd+Z, or Ctrl, itself, for the browser preview and for platforms where the page sees the key before the menu. `notebookEdit()` ignores the second of a menu action and a keydown for the same key press within 150 ms, so one press never undoes twice.

## Cells

`CellView.tsx` holds the notebook's main component. A prompt cell shows, top to bottom:

1. The prompt editor, with `@name` references coloured by `RefText`.
2. The interpretation, when it has `[[assumptions]]`. Click one to correct it.
3. Run progress: the activity list, a status line, and a question card or install bar. Each step's label is plain words. A step that ran code, an `explore` or a `run_cell`, is a button that opens its code underneath. Its detail, a duration or an error line, sits on its own line under the label, so a long error never squeezes the label. A step marks done with a check, failed with a cross, and `warning` (an exploration that raised) with a warning sign. After the run, the list folds into the "N steps" toggle by the duration, which opens it in a popover that keeps itself inside the window, wherever the toggle sits.
4. A message for non-Python errors.
5. Result and Code tabs. A question answered in words shows only the answer, without tabs. The record of how a cell was made is saved with the notebook for Verify, but the UI never shows it.

Under Result: the answer, the outputs, the variables the run created, and suggestions. Suggestions show only on the cell that just finished or the selected one, and not at all when `settings.suggestNext` is off, including ones a cell saved earlier.


Between two cells, `CellInserter` in `NotebookView.tsx` draws a 1px line in `foreground/10`, so it's clear where one ends. It sits in the cells' column, right of the 44 px gutter that holds the run count, and stops 12 px short of each side, so it's a little narrower than the cells. There is none after the last cell. Hovering the gap raises the line to `foreground/20` and shows the Prompt and Note buttons centred on it. They sit on the page background, so the line breaks around them.

`HighlightedEditor` is a transparent `<textarea>` over a mirror that renders the highlighting. The two share one box so the caret lines up. With `indent`, Tab and Shift+Tab indent lines through `execCommand` so Undo still works.

`OutputList` in `outputs/OutputView.tsx` merges adjacent `stream` chunks, and folds printed text away when the cell has a real result. Tables fold when the cell has an answer or a chart. `tablesOpen()` in the shared model decides, and the user's choice in `showTables` overrides it.

A note shows as its rendered Markdown. The preview takes keyboard focus, and Enter or a double-click opens the editor. It has no button role, so its headings stay headings to a screen reader.

### Rendering cost

A notebook can hold dozens of cells with 100-row tables, and every keystroke replaces the cells array. What keeps typing cheap:

- `CellView` is `memo`. The store keeps unchanged cells as the same objects, so only the cell whose object changed redraws. Its props are the cell, its number and whether it's selected; keep them that way, and don't pass fresh callbacks to it. It calls `actions` directly instead.
- Each cell subscribes to its own run with `useNotebook((s) => s.runs[id])`, so status ticks and streamed output from one running cell redraw only that cell. `RunButton` subscribes to the run's status alone.
- Selectors that many cells share return a yes or no for this cell, `s.focusId === id`, never the raw value, so a change for one cell doesn't wake all of them.
- `OutputList` and `RowsView` are `memo`, and the merged output list and the table's column types are `useMemo` on the outputs. `PromptCellView` passes them `useCallback` handlers, so typing a prompt doesn't redraw its own tables.
- The overview reads run statuses through `useShallow`, so it redraws when a status changes, not on every status line.

With 40 cells each showing a 100 × 10 table, one keystroke took about 2.7 s in jsdom before this and about 50 ms after.

### Accessibility

- Each run button is named after its cell, "Run cell 2", counting prompt cells as the overview's summary does. The `[n]` it shows is its description, "Execution count 3", "Running", "Queued" or "Not run yet". Each prompt cell's article is "Prompt cell 2".
- The overview's status dots are `aria-hidden` and the cell's button carries the status in words, ", failed". Each progress bar segment is labelled "Cell 2, Revenue by month: out of date" and shows the same as a tooltip.
- The summary under the progress bar updates on screen with every status, but its `aria-live` twin announces only the end of a run: "Finished running." and where the notebook stands.

## Side panes

All in `components/panes/`. One is open at a time, set by `actions.openPane()` or `togglePane()`.

| Pane | Shows |
| --- | --- |
| Brief | The workspace's `AGENTS.md` as a document, editable in place. Starts from a template. `- [ ]` tasks toggle on click |
| Variables & Environment | Two views under a switch. Variables from the kernel through `listVariables()`. Environment is the Python's version and its libraries with versions, through `listPackages()`, searchable. The libraries are read when the view is first shown. After a run, a restart or a Python change, `environmentChanged()` reads them again at once if the view is on screen, and otherwise marks them stale so the view reads them when it's next shown, never spawning a Python nobody looks at. `loadEnvironment()` called during a read queues one more read after it, and only the last answer lands |
| History | The selected cell's revisions. Restore brings one back without calling the model |
| Files | Workspace files, reloaded after every run. Clicking a data file adds a prompt cell to load it |
| Pinned | Result cards for pinned cells, in pin order |
| Activity | The session log. Click an entry to jump to its cell. With `settings.showCosts` on, each run says what it cost and the top shows the notebook's total. See [Costs](#costs) |

### Costs

Show costs is off by default, and with it off the Activity pane shows nothing about cost, even for entries that have one. The main process counts every run anyway, so turning it on shows the runs made while it was off, see [agent-harness.md](agent-harness.md#costs). `finish()` puts the run's `RunCost` on its log entry and adds it to `spend` through `trackCost()`. A cell name's cost comes on the `title` event and goes to `spend` only.

`lib/cost.ts` words them, in credits, never dollars. The entry says "Counting credits" until `countCredits()` answers, then "4.2 credits", or the tokens if none were counted. A notebook loaded while credits are counting drops them when they arrive, so they never reach the new notebook's total. Tokens whose credits never came add up in `spend.uncountedTokens`, and the total says "12,345 tokens not counted".

## Notices and errors

`actions.notify(text, { undo, tone })` puts one message at the bottom of the window for 6 seconds. `NoticeToast` in `App.tsx` draws it. With `undo` it shows an Undo button, without it a Dismiss button. A newer notice replaces the one showing, and loading a notebook clears it. D D and M use it to offer Undo, which goes through the notebook's undo stack, see [Undo and redo](#undo-and-redo).

Opening the model picker loads the model list. A saved model the list doesn't offer goes back to the default with a notice, since the service only offers models with zero data retention.

A bridge call the user started should never fail silently. `actions.notifyFailure(what, err)` shows "Couldn't save the notebook." and the reason, with the `Error invoking remote method` wrapper stripped by `errorText()`. Saving, writing the brief, refreshing the variables and restarting Python all report failures this way. A new notebook the main process can't write gets a dialog with the reason from there instead, and the window stays as it was. Background calls, like the variables refresh after each run, stay quiet.

`ErrorBoundary` in `components/app/` wraps every cell, the open side pane and the overview. A throw while drawing one of them shows "This cell couldn't be shown." with the error and a Retry button in its place, and the rest of the window keeps working. The side pane's boundary is keyed by pane, so opening another pane starts fresh.

## The notebook name

The notebook's name at the top of the overview, above the folder and the kernel state, is a button that turns into a text field, `NotebookName` in `components/app/`: Enter or leaving the field calls `renameNotebook()`, Esc, or leaving the field empty, keeps the old name, and a name that can't be used stays in the field with the reason under it. The tab in the top bar is unchanged and opens the recent notebooks, with New notebook, Open and Open folder. The field is read-only while the rename is in flight rather than disabled, so it keeps focus and a refused name still answers Enter and Esc. A rename only changes `path`, so the undo stack and any notice showing are left alone.

## Settings

Settings is a screen of its own, not a dialog. `actions.openSettings(section?)` opens it on a section, or on the one it was last left on, and `closeSettings()` goes back. The menu's Cmd+,, the gear in the top bar, the banner over the workspace, the model picker's provider item and the setup's Python step all call it. The banner and the setup open the section that fixes their problem.

`SettingsScreen` in `components/settings/` draws the sections down the left as Radix vertical tabs, so the arrow keys move between them, and the open section on the right. The order is `SETTINGS_SECTIONS` in the store:

| Section | Component | Holds |
| --- | --- | --- |
| Models | `ModelSettings` | `CloudStatus` for the account (sign in, choose a plan, or the credits left), with the zero data retention line from `CLOUD_RETENTION` in `lib/cloud.ts`, see [cloud.md](cloud.md#zero-data-retention). Then the model id, effort and Show costs |
| Agent | `AgentSettings` | Approvals (package installs, shell and network code), cell names, suggested next prompts |
| Python | `PythonSettings` | The managed environment and a Python path |
| Account | `AccountSettings` | The Dalliance account, the plan and its credits. See [cloud.md](cloud.md) |

It sits over the area under the top bar with the screen below still mounted and `inert`, so the setup's step, the notebook's scroll and the resizable columns come back as they were. Command mode and the Cmd+number keys stay off while it's up. Esc goes back, unless a select or menu is open, or a text field has focus, which it leaves instead.

Changes save as they're made. Selects save on change. The model id and the Python path save on Enter or when the field loses focus. `saveSettings()` in `settings/save.ts` sends an update and puts the new view in the store. `Group` and `Row` in `settings/parts.tsx` lay out a section: a bordered group of rows, each with its name and a line on the left and the control on the right, or under the text with `wide`.

## First run and the start page

`WelcomeScreen` in `components/welcome/Welcome.tsx` shows `Onboarding` until `settings.onboarded` is true, and `StartPage` after that. Onboarding has four steps: what a cell is, a Dalliance account, a Python, and a first notebook. The account step shows `CloudStatus`, and counts as done once the account is on a plan, see [cloud.md](cloud.md#signing-in). Skipping any step still sets `onboarded`. The start page offers new, open, open folder, the sample notebook, recent files, and the `STARTERS` prompts from `lib/notebook/samples.ts`. Help > Welcome opens it over the current notebook with `canReturn` set. New goes through `fresh()` in `welcome/start.ts`, which asks the main process to write the notebook as a file, and Open folder asks for a folder first, then does the same in it, so nothing the start page opens is unsaved. File > Open Folder and the notebook tab's menu do the same, and both name the folder in use with `folderName()`.

## Theming

Colours are CSS variables in `src/index.css`, light under `:root` and dark under `.dark`. `main.tsx` toggles `.dark` from `prefers-color-scheme`. `@theme inline` exposes them to Tailwind, so `bg-canvas` or `text-faint` flip with the theme without a `dark:` variant.

App-specific tokens on top of shadcn's:

| Token | Used for |
| --- | --- |
| `--canvas` | The window behind the panes |
| `--ink` | Done marks and the progress bar, a deep green |
| `--faint`, `--hover`, `--raised` | Quiet text, hover fills, raised surfaces like code blocks |
| `--ref` | `@variable` references |
| `--go`, `--warn` | Status dots |
| `--hatch` | Hatched segments for work still to do |
| `--code-k`, `-s`, `-n`, `-f` | Python highlighting: keywords, strings, numbers, function names |

The quiet text colours, `--muted-foreground` and `--faint`, meet WCAG AA, 4.5:1, on `--background` and `--raised` in both themes. `--faint` sits close to the limit so it stays quieter than muted text. Check the ratios before changing either.

`electron/main.ts` hardcodes the canvas colours for the window background and the Windows title bar overlay. Change both together.

Fonts are bundled through Fontsource: Inter for UI, JetBrains Mono for code, Source Serif 4 for answers, the brief and headings on the setup screens. `src/fonts.css` declares only their Latin and Latin Extended files, so the build skips the Greek, Cyrillic and Vietnamese ones and other scripts fall back to system fonts. A `short` custom variant tightens spacing for windows under 760 px tall.

## shadcn components

`components/ui/` came from the shadcn CLI with the `radix-nova` style, configured in `apps/desktop/components.json`. Add new ones with `pnpm --filter @dalliance/desktop exec shadcn add <name>`. Keep app behaviour in `components/app/` and friends rather than editing these files.

Shortcut hints use `Kbd` from `ui/kbd.tsx`, in tooltips, menus and text alike. `IconButton` takes a `shortcut` and shows it in its tooltip, so the accessible name stays the plain label.

## Model maker logos

`src/assets/makers/*.svg` are single-colour logos from `@lobehub/icons-static-svg`, MIT licensed. The file name is the maker label lowercased with only letters and digits: "Moonshot AI" is `moonshotai.svg`. `lib/makers.ts` loads them all with `import.meta.glob` and maps gateway prefixes that don't match, such as `spacexai` to `xai`. A maker without a file shows no logo.

## The browser preview

Without Electron there's no `window.dalliance`. `main.tsx` then checks the URL:

| URL | Shows |
| --- | --- |
| `/?demo` | A clinical trial notebook with results. The last cell asks a question when run. Verify finds the over-65 cell changed and the rest the same |
| `/?demo&welcome` | The start page |
| `/?demo&hero` | The notebook the website's hero capture shows: Kaplan-Meier curves and an adjusted hazard ratio, with a clean run log |
| `/?demo&setup` | The first-run setup, signed out and with no Python. Sign in lands on the Pro plan after a moment |
| anything else | The app with no bridge. Runs fail with "Running cells needs the desktop app." |

`dev/demo.ts` builds the fake bridge from `test/fake-api.ts` and scripts the runs. It's how the website screenshots are made. See [website.md](website.md#screenshots).
