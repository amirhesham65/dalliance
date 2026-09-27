# The renderer

The UI is React 19 with zustand for state, shadcn components on Radix, and Tailwind v4. It lives in `apps/desktop/src/`.

```
src/
  main.tsx                    theme, session restore, ?demo, render
  App.tsx                     menu handling, keyboard modes, the three-column layout
  store/notebook-store.ts     all document and run state, and every action
  components/
    app/                      TopBar, Sidebar (the overview), SettingsDialog, IconButton, MakerLogo
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

`src/store/notebook-store.ts` exports `useNotebook`, a zustand store, and `actions`, plain functions that change it. Components read with selectors, `useNotebook((s) => s.pane)`, and call `actions.*`. Nothing else writes to the store except `App.tsx` and `main.tsx`, which put bridge results into `settings`, `python` and `kernel`.

Saved with the notebook: `notebook`. Everything else is session state:

| Key | Holds |
| --- | --- |
| `screen` | `'welcome'` or `'notebook'`. The notebook stays loaded behind the start page |
| `path`, `dirty` | The file and whether it has unsaved changes |
| `selectedId`, `focusId` | Selection, and a cell whose editor should take focus next render |
| `runs` | `CellRun` per queued or running cell: status text, activity, live outputs, live code, a pending question or approval |
| `activity` | Each cell's activity from its last generation |
| `messages` | Non-Python errors per cell |
| `log` | The Activity pane's entries, newest first, at most 60 |
| `lastFinishedId` | The cell that shows its suggestions |
| `pane`, `pinnedIds` | The open side pane and pinned cells |
| `brief`, `models`, `variables`, `settings`, `python`, `kernel` | Data from the main process |

`getApi()` and `setApi()` wrap `window.dalliance`, so tests and the demo can swap in a fake.

### The run queue

`queue` and `pump()` live at module level. `actions.run(id)` pushes an id unless it's already queued or running. `pump()` runs one cell at a time: it builds the request, awaits `api.runCell()`, and calls `finish()`. Events for the running cell arrive through `applyRunEvent()`. When the queue empties, the store refreshes variables.

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
| M, Y | Command mode | Make the cell a note, a prompt |
| T | Command mode | Fold or unfold tables |
| D D | Command mode | Delete, with a 6 second Undo toast |
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

## First run and the start page

`WelcomeScreen` in `components/welcome/Welcome.tsx` shows `Onboarding` until `settings.onboarded` is true, and `StartPage` after that. Onboarding has four steps: what a cell is, a model key, a Python, and a first notebook. Skipping any step still sets `onboarded`. The start page offers new, open, the sample notebook, recent files, and the `STARTERS` prompts from `lib/notebook/samples.ts`. Help > Welcome opens it over the current notebook with `canReturn` set.

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

`electron/main.ts` hardcodes the canvas colours for the window background and the Windows title bar overlay. Change both together.

Fonts are bundled through Fontsource: Inter for UI, JetBrains Mono for code, Source Serif 4 for answers, the brief and headings on the setup screens. A `short` custom variant tightens spacing for windows under 760 px tall.

## shadcn components

`components/ui/` came from the shadcn CLI with the `radix-nova` style, configured in `apps/desktop/components.json`. Add new ones with `pnpm --filter @dalliance/desktop exec shadcn add <name>`. Keep app behaviour in `components/app/` and friends rather than editing these files.

## Model maker logos

`src/assets/makers/*.svg` are single-colour logos from `@lobehub/icons-static-svg`, MIT licensed. The file name is the maker label lowercased with only letters and digits: "Moonshot AI" is `moonshotai.svg`. `lib/makers.ts` loads them all with `import.meta.glob` and maps gateway prefixes that don't match, such as `spacexai` to `xai`. A maker without a file shows no logo.

## The browser preview

Without Electron there's no `window.dalliance`. `main.tsx` then checks the URL:

| URL | Shows |
| --- | --- |
| `/?demo` | A clinical trial notebook with results. The last cell asks a question when run |
| `/?demo&welcome` | The start page |
| `/?demo&setup` | The first-run setup with no key and no Python |
| anything else | The app with no bridge. Runs fail with "Running cells needs the desktop app." |

`dev/demo.ts` builds the fake bridge from `test/fake-api.ts` and scripts the runs. It's how the website screenshots are made. See [website.md](website.md#screenshots).
