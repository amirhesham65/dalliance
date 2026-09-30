# Recipes

Checklists for the changes that touch several files. Each one ends with the tests to add.

## Add an agent tool

1. Add the tool to `createCellTools()` in `electron/harness/tools.ts`.
   - Write the description in the house format: what it does, then WHEN TO USE, WHEN NOT TO USE, and DO NOT USE FOR if it's easy to misuse.
   - Give it a zod `inputSchema` with a `.describe()` on every field.
   - Wrap the body in `guarded('<name>', input, async () => ...)`.
   - Bound the output. Use `clip()` from `format.ts` or return a fixed-size summary.
2. Add the name to `TOOL_NAMES` in `run-cell.ts`. The order there is the order the model sees.
3. Add a label to `describeCall()`, and an outcome to `describeResult()` if the default is wrong. These are what the user sees in the cell's activity list.
4. If the tool needs something from Electron, add it to `ToolDeps` and `HarnessDeps` and pass it in from `NotebookSession.runCell()`. Don't import Electron into the harness.
5. Mention the tool in the system prompt only if the model needs a rule about it. The tool list is already there.
6. Test it in `run-cell.test.ts` with a scripted model that calls it.

## Change the system prompt

1. Edit `buildSystemPrompt()` in `electron/harness/prompt.ts`. Keep anything that changes per cell out of it. It's cached.
2. Per-cell context goes in `buildCellPrompt()`.
3. Update `prompt.test.ts`.
4. Run the end-to-end test. It's the only check against a real model.

   ```bash
   DALLIANCE_E2E=1 pnpm --filter @dalliance/desktop exec vitest run electron/e2e.test.ts
   ```

## Add an IPC call

1. Add the method to `DallianceApi` and a channel name to `IPC` in `packages/shared/src/ipc.ts`. Add any new request or result types there too.
2. Map it in `electron/preload.ts`. Use `ipcRenderer.invoke` for calls that return something and `ipcRenderer.send` for fire and forget. For main-to-renderer events, use `subscribe()` and return the unsubscribe function.
3. Register the handler in `registerIpc()` in `electron/main.ts` with `handle()` or `on()`, never `ipcMain` directly, so the sender check runs. Put the logic in `NotebookSession` or `SettingsStore`, not in the handler.
4. Add it to `fakeApi()` in `src/test/fake-api.ts`. TypeScript fails until you do, and `?demo` uses the same fake.
5. Call it from the store or a component through `getApi()`.
6. Add a row to the table in [ipc.md](ipc.md).

## Add a setting

1. Add the field to `SettingsView` and `SettingsUpdate` in `packages/shared/src/ipc.ts`.
2. In `electron/settings.ts`, add it to `Stored` and `DEFAULTS`, return it from `view()`, and apply it in `update()`. Old settings files don't have it, and the merge over `DEFAULTS` covers that.
3. Read it where it matters, usually through a getter on `SettingsStore` used by `NotebookSession`.
4. If changing it needs a side effect, like a kernel restart for `pythonPath`, do that in the `updateSettings` handler in `main.ts`.
5. Add a `Row` to the right section in `src/components/settings/`, or a new section: add it to `SETTINGS_SECTIONS` in the store and to `SECTIONS` and the tab contents in `SettingsScreen.tsx`. Controls save through `saveSettings()` as they change. Text fields save on Enter or blur.
6. Add it to `fakeSettings()` in `src/test/fake-api.ts`.

## Add a cell field

1. Add it to `PromptCell` in `packages/shared/src/notebook.ts` and give it a default in `newPromptCell()`.
2. Save it under `metadata.dalliance` in `toIpynb()`. Skip empty values, the way `suggestions` and `history` are skipped.
3. Read it in `fromIpynb()` with a type check and a fallback. Files saved before the field existed must still open.
4. If a run produces it, add it to `CellRunResult` in `ipc.ts`, fill it in the harness, and apply it in `finish()` in the store.
5. Add a round-trip case to `ipynb.test.ts`.

## Add an output type

1. Add the variant to `Output` in `packages/shared/src/notebook.ts`.
2. Emit it from `rich_output()` or `run()` in `electron/kernel/dalliance_kernel.py`.
3. Convert it both ways in `ipynb.ts`, using a standard MIME type where one exists so Jupyter can show it.
4. Describe it for the model in `outputsToText()` in `electron/harness/format.ts`, with a size bound.
5. Render it in `OutputView` in `src/components/notebook/outputs/OutputView.tsx`.
6. Test the kernel side in `python-kernel.test.ts` and the round trip in `ipynb.test.ts`.

## Add a side pane

1. Add the name to `PaneName` in `packages/shared/src/ipc.ts`. `MenuAction` picks up `pane-<name>` from it.
2. Add it to `PANE_ORDER` in `src/store/notebook-store.ts`. Its position sets its Cmd+number shortcut.
3. Add an entry to `PANES` in `src/components/app/Sidebar.tsx` with a label, a lucide icon and its key.
4. Write the component in `src/components/panes/`, wrapped in `Pane`, and render it from `SidePane()` in `SidePanes.tsx`.
5. Add a View menu item in `electron/menu.ts` with `registerAccelerator: false`.
6. Test that it opens in `App.test.tsx`.

## Add a menu item

1. Add the action to `MenuAction` in `packages/shared/src/ipc.ts`.
2. Add `item(label, action, accelerator)` to the template in `electron/menu.ts`. Use `registerAccelerator: false` if the renderer handles the key itself.
3. Handle it in the `handleMenu()` switch in `src/App.tsx`.

## Add a model maker

1. Add the gateway prefix and the display name to `MAKERS` in `electron/harness/model.ts`.
2. Drop a single-colour SVG into `src/assets/makers/`, named after the display name lowercased with only letters and digits.
3. If the gateway prefix doesn't match that file name, add it to `ALIASES` in `src/lib/makers.ts`.
4. Check it in `makers.test.ts`.

## Add a harness policy

Rules like "never read this file" or "log this event" belong on the event bus, not in a tool.

1. Register a handler in `installExtensions()` in `electron/harness/extensions.ts`. `NotebookSession` calls it once for its bus.
2. For a block, return `{ block: true, reason }` from a `tool_call` handler. The model sees `Blocked: <reason>` as the tool result.
3. Test it in `run-cell.test.ts` the way "lets an extension block a tool call" does.
