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
    panes/                    Brief, Variables, History, Files, Pinned, Activity
    welcome/                  first-run setup and the start page
    ui/                       shadcn components, generated. Edit sparingly
  lib/notebook/text.ts        Markdown, answers, @refs, Python highlighting, titles, durations
  lib/notebook/samples.ts     starter prompts and the sample notebook
  lib/makers.ts               model maker logos
  dev/demo.ts                 the fake bridge behind ?demo
  test/                       jsdom setup and fakeApi
```

## The store

`src/store/notebook-store.ts` exports `useNotebook`, a zustand store, and `actions`, plain functions that change it. Components read with selectors, `useNotebook((s) => s.pane)`, and call `actions.*`. Besides the actions, `App.tsx`, `main.tsx` and the Settings sections write bridge results straight into `settings`, `python` and `kernel`.

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
| `log` | The Activity pane's entries, newest first, at most 60 |
| `lastFinishedId` | The cell that shows its suggestions |
| `pane`, `pinnedIds` | The open side pane and pinned cells |
| `brief`, `models`, `variables`, `settings`, `python`, `kernel` | Data from the main process |
| `notice` | The message at the bottom of the window, with an Undo when the change can be taken back. See [Notices and errors](#notices-and-errors) |

`getApi()` and `setApi()` wrap `window.dalliance`, so tests and the demo can swap in a fake.

### The run queue

`queue` and `pump()` live at module level. `actions.run(id)` pushes an id unless it's already queued or running. `pump()` runs one cell at a time: it builds the request, awaits `api.runCell()`, and calls `finish()`. Events for the running cell arrive through `applyRunEvent()`. When the queue empties, the store refreshes variables.

`pump()` passes the cell as it was sent to `finish()`. The user can keep typing while the agent works. If the prompt or the code changed during the run, their edits stay, `generatedFrom` is the prompt that was sent, and the cell ends `edited` instead of `done`. The next run then regenerates for the new prompt, or runs their code. History keeps the version that ran.

`interrupt()` empties the queue and drops queued runs, then calls the bridge. `deleteCell()` interrupts the cell if it's running. `restart()` interrupts, restarts the kernel, and marks every cell that has run `stale` with no execution count.

What `finish()` does to a cell is in [notebook-model.md](notebook-model.md#after-a-run).

## Layout

`App.tsx` renders the top bar and then `Workspace`, three columns from `react-resizable-panels`:

```
┌──────────┬────────────┬──────────────────────────┐
│ Overview │ Side pane  │ Notebook                 │
│ 220-420  │ 280-680    │ at least 360             │
└──────────┴────────────┴──────────────────────────┘
```

The overview sits in its own outer group, so opening a side pane never changes its width. Both groups use `preserve-pixel-size`. Widths persist through `useDefaultLayout` in `localStorage` under `dalliance-overview` and `dalliance-panes`. Whether the overview is open is `dalliance-sidebar`. Every column is a `Pane` from `components/panes/Pane.tsx`: a rounded card on the canvas.

A banner above the workspace asks for a key, a Python or missing packages when the settings or Python state say so.

## Keyboard

The main process menu owns the global shortcuts. The renderer owns the rest.

| Keys | Where | Does |
| --- | --- | --- |
| Cmd+N, Cmd+O, Cmd+S, Shift+Cmd+S | Menu | New, Open, Save, Save As |
| Cmd+, | Menu | Settings |
| Shift+Cmd+Enter | Menu | Run all |
| Cmd+. | Menu | Interrupt |
| Cmd+B | Renderer, shown in the menu | Toggle the overview and side pane |
| Cmd+1 to Cmd+6 | Renderer, shown in the menu | Brief, Variables, History, Files, Pinned, Activity |
| Shift+Enter | Editor or command mode | Run and move to the next cell, adding one at the end |
| Cmd+Enter | Editor or command mode | Run in place |
| Alt+Enter | Editor | Run and insert a cell below |
| Esc | Editor | Leave the editor for command mode |
| Enter | Command mode | Edit the selected cell |
| A, B | Command mode | Insert a prompt cell above, below |
| M, Y | Command mode | Make the cell a note, a prompt. A note keeps only the prompt, so M on a cell with code, outputs or history offers Undo |
| T | Command mode | Fold or unfold tables |
| D D | Command mode | Delete, with a 6 second Undo notice |
| Up, Down, J, K | Command mode | Move the selection |

Command mode is `useCommandMode()` in `App.tsx`, on when no text field, dialog or listbox has focus. Editor keys are `editorKeys()` in `CellView.tsx`. `useScopedSelectAll()` makes Cmd+A select only the text field, answer or output that holds the selection, like a desktop app.

## Cells

`CellView.tsx` holds the notebook's main component. A prompt cell shows, top to bottom:

1. The prompt editor, with `@name` references coloured by `RefText`.
2. The interpretation, when it has `[[assumptions]]`. Click one to correct it.
3. Run progress: the activity list, a status line, and a question card or install bar.
4. A message for non-Python errors.
5. Result and Code tabs. A question answered in words shows only the answer, without tabs.

Under Result: the answer, the outputs, the variables the run created, and suggestions. Suggestions show only on the cell that just finished or the selected one.

`HighlightedEditor` is a transparent `<textarea>` over a mirror that renders the highlighting. The two share one box so the caret lines up. With `indent`, Tab and Shift+Tab indent lines through `execCommand` so Undo still works.

`OutputList` in `outputs/OutputView.tsx` merges adjacent `stream` chunks, and folds printed text away when the cell has a real result. Tables fold when the cell has an answer or a chart. `tablesOpen()` in the shared model decides, and the user's choice in `showTables` overrides it.

## Side panes

All in `components/panes/`. One is open at a time, set by `actions.openPane()` or `togglePane()`.

| Pane | Shows |
| --- | --- |
| Brief | The workspace's `AGENTS.md` as a document, editable in place. Starts from a template. `- [ ]` tasks toggle on click |
| Variables | `listVariables()` from the kernel |
| History | The selected cell's revisions. Restore brings one back without calling the model |
| Files | Workspace files, reloaded after every run. Clicking a data file adds a prompt cell to load it |
| Pinned | Result cards for pinned cells, in pin order |
| Activity | The session log. Click an entry to jump to its cell |

## Notices and errors

`actions.notify(text, { undo, tone })` puts one message at the bottom of the window for 6 seconds. `NoticeToast` in `App.tsx` draws it. With `undo` it shows an Undo button, without it a Dismiss button. A newer notice replaces the one showing, and loading a notebook clears it. D D and M use it to offer Undo.

A bridge call the user started should never fail silently. `actions.notifyFailure(what, err)` shows "Couldn't save the notebook." and the reason, with the `Error invoking remote method` wrapper stripped by `errorText()`. Saving, writing the brief, refreshing the variables, restarting Python and the fresh kernel for a new notebook all report failures this way. A new notebook still opens when its kernel fails to restart. Background calls, like the variables refresh after each run, stay quiet.

`ErrorBoundary` in `components/app/` wraps every cell, the open side pane and the overview. A throw while drawing one of them shows "This cell couldn't be shown." with the error and a Retry button in its place, and the rest of the window keeps working. The side pane's boundary is keyed by pane, so opening another pane starts fresh.

## Settings

Settings is a screen of its own, not a dialog. `actions.openSettings(section?)` opens it on a section, or on the one it was last left on, and `closeSettings()` goes back. The menu's Cmd+,, the gear in the top bar, the banner over the workspace, the model picker's provider item and the setup's Python step all call it. The banner and the setup open the section that fixes their problem.

`SettingsScreen` in `components/settings/` draws the sections down the left as Radix vertical tabs, so the arrow keys move between them, and the open section on the right. The order is `SETTINGS_SECTIONS` in the store:

| Section | Component | Holds |
| --- | --- | --- |
| Models | `ModelSettings` | Provider, key, model id, effort |
| Agent | `AgentSettings` | Package installs, cell names |
| Python | `PythonSettings` | The managed environment and a Python path |

It sits over the area under the top bar with the screen below still mounted and `inert`, so the setup's step, the notebook's scroll and the resizable columns come back as they were. Command mode and the Cmd+number keys stay off while it's up. Esc goes back, unless a select or menu is open, or a text field has focus, which it leaves instead.

Changes save as they're made. Selects save on change. The model id and the Python path save on Enter or when the field loses focus. The API key has its own button, because it's checked with the provider first. `saveSettings()` in `settings/save.ts` sends an update and puts the new view in the store. `Group` and `Row` in `settings/parts.tsx` lay out a section: a bordered group of rows, each with its name and a line on the left and the control on the right, or under the text with `wide`.

## First run and the start page

`WelcomeScreen` in `components/welcome/Welcome.tsx` shows `Onboarding` until `settings.onboarded` is true, and `StartPage` after that. Onboarding has four steps: what a cell is, a model key, a Python, and a first notebook. The key step links to each provider's keys page, switches provider to match a pasted key, and checks the key before saving it, see [storage.md](storage.md#settings-and-keys). Skipping any step still sets `onboarded`. The start page offers new, open, the sample notebook, recent files, and the `STARTERS` prompts from `lib/notebook/samples.ts`. Help > Welcome opens it over the current notebook with `canReturn` set.

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

Fonts are bundled through Fontsource: Inter for UI, JetBrains Mono for code, Source Serif 4 for answers, the brief and headings on the setup screens. A `short` custom variant tightens spacing for windows under 760 px tall.

## shadcn components

`components/ui/` came from the shadcn CLI with the `radix-nova` style, configured in `apps/desktop/components.json`. Add new ones with `pnpm --filter @dalliance/desktop exec shadcn add <name>`. Keep app behaviour in `components/app/` and friends rather than editing these files.

Shortcut hints use `Kbd` from `ui/kbd.tsx`, in tooltips, menus and text alike. `IconButton` takes a `shortcut` and shows it in its tooltip, so the accessible name stays the plain label.

## Model maker logos

`src/assets/makers/*.svg` are single-colour logos from `@lobehub/icons-static-svg`, MIT licensed. The file name is the maker label lowercased with only letters and digits: "Moonshot AI" is `moonshotai.svg`. `lib/makers.ts` loads them all with `import.meta.glob` and maps gateway prefixes that don't match, such as `spacexai` to `xai`. A maker without a file shows no logo.

## The browser preview

Without Electron there's no `window.dalliance`. `main.tsx` then checks the URL:

| URL | Shows |
| --- | --- |
| `/?demo` | A clinical trial notebook with results. The last cell asks a question when run |
| `/?demo&welcome` | The start page |
| `/?demo&setup` | The first-run setup with no key and no Python. Any key saves, except one containing `bad` |
| anything else | The app with no bridge. Runs fail with "Running cells needs the desktop app." |

`dev/demo.ts` builds the fake bridge from `test/fake-api.ts` and scripts the runs. It's how the website screenshots are made. See [website.md](website.md#screenshots).
