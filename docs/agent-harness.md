# The agent harness

The agent lives in `apps/desktop/electron/harness/`. It follows Vercel's [Build Your Own AI Coding Agent Harness](https://vercel.com/academy/build-ai-agent-harness) course, adapted from coding to notebook cells, on AI SDK 7.

| File | Does |
| --- | --- |
| `run-cell.ts` | The entry point. Runs saved code directly, or drives a `ToolLoopAgent` |
| `tools.ts` | The nine tools and the `guarded()` wrapper |
| `images.ts` | What the model is shown: the image budget, `toModelOutput()` and the note on which charts it sees |
| `prompt.ts` | `buildSystemPrompt()` and `buildCellPrompt()` |
| `model.ts` | Direct provider adapters, effort options, and the local model catalog |
| `title.ts` | Optional titles using the selected model |
| `cost.ts` | The calls a run made and their tokens, for the Show costs setting |
| `approval.ts` | Whether an install, or code that runs commands or uses the network, needs a person |
| `events.ts` | The event bus extensions hook into |
| `extensions.ts` | The built-in extensions: the `.env` block, the code policy and the run log |
| `code-policy.ts` | `inspectCode()`, which finds secret files, shell commands and network use in Python |
| `provenance.ts` | `buildProvenance()`, the record of how a cell was made, and the `RunTrail` the tools fill for it |
| `format.ts` | `clip()`, `outputsToText()`, `formatVariables()` |
| `workspace.ts` | File listing and reading inside the notebook's folder, and `readImage()` for `view_image` |

`NotebookSession` in `electron/session.ts` builds the dependencies and calls `runCell()`. The harness never imports Electron, so tests can run it with a fake kernel and a scripted model.

## The loop

`generateCell()` in `run-cell.ts`:

1. Emits `run_start` on the event bus.
2. Reads the kernel's variables and lists up to 80 files in the workspace.
3. Builds the tools with `createCellTools()` and a `ToolLoopAgent` with the system prompt as `instructions`.
4. Streams with `stopWhen: [stepCountIs(24), () => state.finished != null]`.
5. Turns stream parts into activity items and status text for the renderer (see [Step labels](#step-labels)), and emits `step` at the end of every model call.
6. Emits `run_end` and builds a `CellRunResult` from `state.lastRun` and `state.finished`, with the record of how the cell was made from `state.trail`. See [The record of a run](#the-record-of-a-run).

The tools write to a shared `RunState`:

```ts
interface RunState {
  lastRun: { code; result } | null  // the last run_cell, successful or not
  finished: { interpretation; answer; suggestions } | null
  attempts: number
  trail: RunTrail  // each attempt, the files read and the approvals, for the cell's record
}
```

The result is `ok` when there was no error and either the last `run_cell` succeeded, or `finish` was called with an answer and no code ran at all. That second case is a question answered in words, and the cell ends up with empty code. When the model stops without finishing, the error says so: either the code still failed after N tries, or the model's own text, clipped to 600 characters.

If the model answers in plain text instead of calling `finish`, and the last run succeeded, that text becomes the answer.

With `suggestNext: false` in `HarnessDeps`, from the setting of the same name, the result's `suggestions` is always empty, even if the model wrote some anyway.

### The record of a run

The tools fill `state.trail` as they go, and `buildProvenance()` in `provenance.ts` turns it into `CellRunResult.provenance` when the run ends. What the record holds and how it's saved is in [notebook-model.md](notebook-model.md#how-a-cell-was-made). Where each part comes from:

- **Attempts.** `run_cell` records every call before it runs: the code, then the error in one line from `attemptError()`, `Stopped after 10 minutes` on a timeout, or the kernel's own error when `execute()` throws. `describeChange()` diffs each attempt's lines against the one before.
- **Files read.** `run_cell` keeps the `filesRead` the kernel reports for each attempt (see [kernel.md](kernel.md#files-read)). `explore` adds its reads to the agent's, and so does a `read_file` that returned lines, with its path made relative the way the kernel reports paths. The final code's reads count as `code`, everything else as `agent`.
- **Approvals.** The `approve` that `guarded()` hands to `tool_call` handlers, and that `install_packages` calls, records each answer, and whether a person was asked (`needsApproval()` before the call). A handler that blocks a call for touching secrets returns `secret` with its block, the file or the line, and `guarded()` records it as `blocked`. `blockSecretFiles()` and `codePolicy()` both do.
- **Steps.** The model of each step comes from `steps`, and the stated rationale from their reasoning summaries, falling back to the interpretation and answer when there are none. See `statedRationale()`.
- **Hashes.** SHA-256 of the final code, and of `canonicalOutputs()` of its outputs, from `packages/shared/src/normalize.ts`.

A plain run of saved code builds no record, so the cell keeps the one it has.

## Tools

Every tool's description follows the course's format: WHEN TO USE, WHEN NOT TO USE, and DO NOT USE FOR where it helps. The description is how the model chooses, so keep it accurate when you change behaviour.

| Tool | Does | Bounds |
| --- | --- | --- |
| `list_variables` | Lists kernel variables with type, shape and DataFrame columns | 40 variables, 300 characters of detail each |
| `explore` | Runs a snippet with `store: false`. No execution count, no `_`. Takes a `summary` and the `code` | 4,000 characters. Interrupted after 20 s |
| `list_files` | Lists the workspace, 4 folders deep, skipping dotfiles and `node_modules`, `.venv` and similar | 200 files |
| `read_file` | Numbered lines of a text file in the workspace | 500 lines, 500 characters a line, 20,000 characters in all. Refuses binaries |
| `view_image` | A PNG, JPEG, GIF or WebP in the workspace, attached for the model to look at | 30 MB on disk. The file's first bytes must match an image format. See [Images](#images) |
| `run_cell` | Runs the complete cell with `store: true` and records it as `lastRun`. Takes a `summary` and the `code` | 5,000 characters. Tables show 15 rows to the model. Interrupted after 10 minutes |
| `install_packages` | `pip install` into the kernel's interpreter | 1 to 5 packages. Last 1,500 characters of the log |
| `ask_user` | A multiple-choice question in the cell | 2 to 4 options |
| `finish` | Ends the cell with interpretation, answer and `next` | Up to 3 suggestions. None when `suggestNext` is off |

`finish` is the verification gate. It refuses when no code ran and there's no answer, or when the last `run_cell` failed. The refusal goes back to the model as the tool result, and the loop carries on.

`run_cell` has a time limit, `runTimeoutMs` in `HarnessDeps`, 10 minutes by default (`RUN_TIMEOUT_MS`). Past it the tool calls `kernel.interrupt()`, like `explore` does after 20 seconds. The kernel escalates to a kill if the interrupt doesn't land; if `execute()` then rejects, the tool still answers. The model gets a fixed, short result, `The cell timed out after 10 minutes and was stopped.` with advice to work on a sample, never the partial output. The run is recorded as `lastRun` with `ok: false`, so `finish` refuses it, and the activity shows "Stopped after 10 minutes". Plain runs of saved code have no limit; the user can stop those.

A model can ask for several tools in one step, and the AI SDK runs them at the same time. Anthropic models are told not to (see [Models](#models)), but other makers may still send `run_cell` and `finish` together. So `finish` first waits for every `run_cell` still executing, and judges the run they leave behind, never the one before.

### Step labels

Each tool call is a line in the cell's activity list, and its label doubles as the status text. `describeCall()` writes it, and `describeResult()` updates it when the call ends. Labels are plain words, never code.

`explore` and `run_cell` take a required `summary`, "3 to 7 plain words for the user", like "Counting patients per stage". It is the first field in both schemas, so models tend to write it before the code. The label shows as early as the stream allows:

1. `tool-input-start`: the step appears with a generic label, "Exploring the data" or "Running the cell".
2. `tool-input-delta`: the harness collects the input's JSON per call id and reads it with `parsePartialJson()`. Once the summary is complete, which means a later field has started or the input is whole, it becomes the label. A summary still being written never shows.
3. `tool-call`: the whole input confirms the label, and the call's code, clipped to 4,000 characters, goes on the item as `code`. The user opens the step to see it.

An empty summary falls back to the generic label, and to "Explored the data" or "Ran the cell" when the call ends. A call without one fails the schema and goes back to the model; its step says the call was malformed, since the SDK's error quotes the whole input. A step's detail is the run's duration, "Ran in 84 ms", or the error's `Name: message` line, never the traceback around it. A step still running when the stream ends, cut off by a stop or an error, is marked failed. An exploration that raised isn't a failed step, since it still did its job of looking, but it carries `warning: true`, so the list doesn't show a check beside an error.

### Images

The agent sees what it makes. When `run_cell` or `explore` draws figures, the tool's result carries them as images as well as text, and `view_image` attaches an image file from the workspace. `toModelOutput()` in `images.ts` turns such a result, a `SeenOutput` of `{ text, images }`, into the AI SDK's content parts: the text, then one `file` part per image. A result without images stays plain text. The catalog models support image input. Custom models must support it too, see [providers.md](providers.md).

The text numbers the figures, `[chart 1, shown to the user in the notebook]`, and a line from `attachNote()` says which are attached: "The chart is attached as an image.", or how many were left out and why. After a successful run with charts, the reply asks the model to check each one before finishing. The system prompt says the same, and that a chart is only described from what the model sees in it.

Images stay in the append-only history and are resent on every step. To bound request size and token use, `imageBudget()` bounds them, fresh for each run:

| Limit | Value |
| --- | --- |
| `MAX_IMAGE_SIDE` | 1,568 pixels on the longer side, the most Anthropic's models see without scaling again |
| `MAX_IMAGE_BYTES` | 600,000 base64 characters for one image, once shrunk |
| `MAX_IMAGES_PER_RESULT` | 4 |
| `MAX_IMAGES_PER_RUN` | 10 |
| `MAX_RUN_IMAGE_BYTES` | 2,500,000 base64 characters for all of a run's images |

An image past a limit isn't attached, and the note says so. One that can't be decoded or made small enough counts as unreadable. Shrinking is the `prepareImage` dependency, a `PrepareImage`, so the harness never imports Electron. `electron/images.ts` implements it with `nativeImage`: a PNG when that fits, which keeps a chart's lines and text crisp, and JPEG at quality 85, 70 then 55 when it doesn't. An image already small enough is sent as it is. nativeImage only decodes PNG and JPEG, so a GIF or WebP goes unchanged when it's small enough, and a PNG or JPEG it can't decode is refused as damaged. `main.ts` passes it to `NotebookSession`, which passes it to `runCell()`. Without one, as in tests, `passThrough` sends an image only when it is already under the per-image limit. A kernel figure is drawn at 2x (see [kernel.md](kernel.md#figures)), so a default 6.4 by 4.8 inch chart, about 1,400 by 1,050 pixels, goes unscaled.

`view_image` checks the path is inside the workspace, the extension is `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`, the file is at most 30 MB, and its first bytes match one of those formats, so a renamed file isn't sent as something it isn't. A file it looked at counts as read by the agent in the cell's record. `blockSecretFiles()` guards it like `read_file`. Its step reads "Looking at chart.png", then "Looked at chart.png", or "Couldn't look at chart.png" with the reason.

The run log writes an image as `{ mediaType, chars }`, never its bytes.

### guarded()

Every tool body runs inside `guarded(toolName, input, run)`:

1. Emits `tool_call`. A handler can return `{ block: true, reason }`, and the tool returns `Blocked: <reason>` instead of running. A blocked call still emits `tool_result`, with `ok: false`, so the log records how it ended.
2. Runs the tool.
3. Emits `tool_result` with the output or the error.

A new tool must use it. The `.env` block, the code policy and the run log all depend on it. `guarded()` also passes `approve` with the `tool_call` event, so a handler can ask for approval.

### Leaked tool markup

Some models write the rest of a tool call into a text field, like `...the answer.</answer><parameter name="next">[...]`. `splitLeaked()` and `leakedList()` in `packages/shared/src/leaked.ts` cut that markup off and recover the parameters. `finish` runs both `interpretation` and `answer` through them.

## Prompts

`prompt.ts` builds two messages.

**The system prompt**, `buildSystemPrompt()`, covers identity, how to tell a code cell from a question, the steps of a code cell, code style, guardrails, how to handle ambiguity, and what `finish` fields should hold. It allows the workspace brief to override chart styling defaults while preserving guardrails and how cells and tools work.

**The cell prompt**, `buildCellPrompt()`, is the user message. It holds, in order:

1. The notebook folder's `AGENTS.md`, labelled as project notes that can override chart styling defaults. This cell's styling request takes precedence over the brief. Guardrails and how cells and tools work still apply. Clipped to 8,000 characters, with a note telling the model to read the rest with `read_file`.
2. The last 12 earlier cells. Notes are clipped to 800 characters, code to 1,500.
3. Variables in memory.
4. Files in the workspace.
5. This cell's current code, when regenerating after a prompt change or a correction.
6. The user's corrections.
7. When Settings turns the suggested next prompts off (`suggestNext`), a line telling the model to leave `next` empty in `finish`. It sits here rather than in the system prompt so switching it never breaks the cache.
8. The files attached to the cell, when there are any, as paths relative to the notebook's folder, which is the kernel's working directory.
9. The prompt. A cell with attached files and no prompt asks the model to load them and show what they hold.

Some rules in the system prompt shape the product, so change them knowingly:

- Name variables after what they hold, never `df` or `result`. Other cells refer to them with `@name`.
- End with exactly one value to show. Don't `print()` summaries.
- Never call `plt.show()`. The kernel captures figures.
- Preserve the kernel's chart styling defaults. For generated charts, styling precedence is Dalliance defaults, workspace brief, then the cell's request. Preserve manual styling in existing code unless the request changes it. Override only the requested properties, preferably on the figure or axes, and keep explicit styles in the saved code for plain reruns. Avoid global styles and hard-coded palettes unless requested. For example, a brief can ask for teal for treatment and gray for control while retaining the default background, or a fixed white background with readable labels for report figures.
- Base every number in the answer on output the model saw.
- Look at each chart before finishing, fix one that doesn't show what was asked, and describe a chart only from what it shows.
- Ask only when a wrong guess would make the cell useless. Otherwise state the assumption in `[[brackets]]`.

## Context and caching

Two constraints shape the loop.

**History is append-only.** With adaptive thinking on, Anthropic's API rejects requests that change earlier turns. So there's no `pruneMessages` and no rewriting of past tool results. The 24-step cap and the output bounds keep a run small instead. `run-cell.test.ts` has a test that checks every request only appends to the one before it.

**The system prompt is cached.** It carries `cacheControl: { type: 'ephemeral' }`, so repeated cells reuse the cached prefix. Anything in it that changes per cell breaks the cache. The Python version, tool names and model id are stable within a session. `AGENTS.md`, variables, files and earlier cells can change, so they go in the cell prompt.

**The history is cached too.** For `anthropic/*` models, `agentProviderOptions()` in `model.ts` adds a top-level `cacheControl`, which the Anthropic adapter passes on to its API. The API then puts a breakpoint on the last block of every request, so each step reads the steps before it from the cache instead of paying for the whole tool history again. No message is marked, so the history stays append-only. Each step adds two blocks, well inside the API's 20-block lookback. The `caching` block in `run-cell.test.ts` checks that every step asks for it and that no message but the system prompt is marked.

## Models

Models call Anthropic, Google, or OpenAI directly with a user-supplied key. `ModelConfig` is `{ model, effort, key }`, with an internal provider-prefixed ID and a main-process key resolver. `resolveModel()` creates the explicit provider adapter, strips the prefix, and fails before generation if the selected key is missing. See [providers.md](providers.md).

`agentProviderOptions()` maps reasoning by model capability. Anthropic gets automatic caching and `disableParallelToolUse`, plus adaptive thinking and effort where supported. OpenAI reasoning families get effort and reasoning summaries. Google uses its defaults. The UI offers low, medium and high effort; saved higher levels read as high. Models without an applicable mapping use defaults.

`listModels(key)` filters the local catalog to configured providers. The picker loads it without a network request. Custom model IDs are never reset just because the catalog does not include them. Provider logos come from `src/assets/makers/`.

`friendlyError()` explains invalid keys or access, quota exhaustion, rate limits, unavailable models, overload, server failures, and network problems. It reads HTTP statuses from AI SDK errors and their retry wrappers, never from arbitrary token counts. Known key values are redacted before a message reaches the renderer.

## Titles

`title.ts` names generated cells with the selected model and the same provider key, at low effort. It never requires another provider's key. Missing keys or any title failure return null, leaving the prompt as the outline label. Saved-code runs and Verify request no titles.

The call has a 10 second timeout, one retry and 1,024 output tokens. `cleanTitle()` keeps the first line, strips quotes, prefixes, trailing punctuation and `@`, and caps the title at 6 words. The session starts the title alongside generation and does not wait for it. Settings can turn titles off with `autoTitles`.

## Token usage

Show token usage, `showUsage` in Settings, is off by default. `costOf()` sums the input and output tokens of each model call into `RunCost`, `{ tokens }`. Counts are collected regardless of the setting, so turning it on later shows earlier runs in the current notebook session.

`stepUsage()` reads provider-reported counts. Input tokens already include cache reads and writes; output tokens already include reasoning. Those details are never added on top. Missing counts are zero.

Title usage rides on the `title` event and counts toward the notebook total, rather than the run. Usage is local and synchronous. Actual charges are shown by the provider.

## Approvals

`approval.ts` models the policy as data:

```ts
type ApprovalConfig =
  | { mode: 'interactive' }                  // ask for anything not yet trusted
  | { mode: 'background' }                   // never ask
  | { mode: 'delegated'; trust: string[] }   // ask for anything outside the list
```

Settings exposes `interactive` and `background`. `delegated` exists in the code but not in the UI.

`createApproval()` answers whether a list of keys needs a person. A key is a package name for an install, or `code:shell` or `code:network` for code (see [The code policy](#the-code-policy)). `approver()` is the one flow both use: ask the policy, and call `requestApproval(title, detail, keys)` only when it says a person must decide. The approval shows in the cell as the title and a one-line detail, like `pip install seaborn` or the line of code. Once the user approves, the session trusts those keys, normalized to lowercase without version specifiers, until the app quits. So an approved package isn't asked about twice, and neither is network use once the user has allowed it.

`installPackages()` in `kernel/python-env.ts` checks every name with `isPackageSpec()` before it calls pip. A name must start with a letter or digit, so pip never reads it as an option (`-e.`) or a local path (`.`), and can only contain letters, digits and version specifier punctuation. Archive file names such as `pkg.whl` or `pkg.tar.gz` are rejected too, since pip would install the local file. pip gets the names after `--`.

## The event bus

`EventBus` in `events.ts` has five events: `run_start`, `tool_call`, `tool_result`, `step`, `run_end`. Handlers run in registration order. The first `tool_call` handler that returns `{ block: true }` stops the call.

`step` fires when a model call ends, after the tool calls it asked for. `generateCell()` builds it from the stream's `start-step` and `finish-step` parts:

| Field | Holds |
| --- | --- |
| `step` | Which model call of the run, from 1 |
| `modelId` | The model that answered, as the provider reports it |
| `finishReason` | `tool-calls`, `stop`, `length` and so on |
| `durationMs` | Wall time from the request to the end of the step's tool calls |
| `reasoning` | The model's reasoning summary for the call, from the stream's `reasoning-delta` parts. `null` when it returned none, never left out, so a missing summary can't pass for lost data |
| `usage` | `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`. Undefined where the provider doesn't say |

`cacheReadTokens` is the quickest check that [caching](#context-and-caching) works: after the first step of a cell it should be most of `inputTokens`.

`generateCell()` returns each step's `{ step, modelId, reasoning, usage }` in `CellRunResult.steps`. The cell record keeps the models and stated rationale. Token counts use `StepUsage`, with zero for missing counts. Plain saved-code runs have no model steps. The request options, summaries included, are the same for every step of a run, so the prompt cache holds.

`installExtensions()` in `extensions.ts` registers the built-in ones. `NotebookSession` calls it once, on its own bus:

- `blockSecretFiles()` blocks `read_file` on `.env` and `.env.*`. `isSecretPath()` matches the file name in any case, after either separator, so `config\.Env.local` is blocked and `environment.csv` or `.envrc` are not.
- `codePolicy()` reads the code `explore` and `run_cell` are about to run. See below.
- `logRuns()` appends every event to `logs/agent.jsonl` in userData, with strings clipped to 2,000 characters, except `reasoning`, which is kept whole. It is registered first, so it sees calls a later handler blocks.

The log comes from `createRunLog()`. Each event is turned into its line at once, then written through one promise chain, so lines land in the order the events happened even when writes are slow. A failed write drops that line and the next one tries again. When the next line would take the file past 5 MB (`MAX_LOG_BYTES`), `agent.jsonl` is renamed to `agent.jsonl.1`, replacing the old backup, and a new file starts. So the log never takes more than about 10 MB. The size is read from disk once and then counted, so rotation costs no extra `stat` per line.

Add new policy here rather than inside a tool. A `tool_call` handler that needs a person calls `data.approve({ title, detail, keys })`, which runs the approval flow above and lands in the cell's record. A handler that blocks a call because it touches secrets returns `{ block: true, reason, secret }`, with `secret` naming the file or the line, so the record lists it.

### The code policy

`explore` and `run_cell` run whatever Python the model writes, with the user's permissions. `codePolicy()` runs `inspectCode()` on that code first and acts on three kinds of finding:

| Kind | Found by | What happens |
| --- | --- | --- |
| Secret files | A string naming `.env` or `.env.*` (same rule as `isSecretPath()`), anything under `.ssh` or `.aws`, an SSH private key such as `id_rsa`, `.netrc`, `_netrc`, `.git-credentials`, `.pgpass`, a `.keychain` file or `Keychains` folder, or `find-generic-password` and friends. Also `load_dotenv()`, `dotenv_values()`, `keyring.get_password()`, and importing `keyring` or `netrc` | Blocked in every mode. The model gets `Blocked: the code reads ~/.ssh (<the line>), which may hold secrets, so it is off limits...` and is told to leave that step to the user |
| Shell | Importing `subprocess`, `pty`, `pexpect` or `pip`; `subprocess.*`, `os.system`, `os.popen`, `os.exec*`, `os.spawn*`, `os.fork`, `create_subprocess_*`, `pip.main()`, `get_ipython().system()`, `get_ipython().run_line_magic()` and `run_cell_magic()`; a line starting with `!`, `%pip`, `%conda`, `%%bash` and similar | Approval with key `code:shell`, title "Let the agent run shell commands?" |
| Network | Importing `requests`, `httpx`, `aiohttp`, `urllib3`, `urllib2`, `socket`, `ftplib`, `smtplib`, `telnetlib`, `websocket(s)`, `paramiko`, `pycurl`, `urllib.request` or `http.client`/`http.server`; calls such as `requests.get()`, `httpx.Client()`, `urlopen()`, `urlretrieve()`, `socket.create_connection()` | Approval with key `code:network`, title "Let the agent use the network?" |

Approvals follow the install semantics exactly, through the same `approver()`: `background` never asks and lets the code run, `interactive` asks once and then trusts that kind of code for the session, `delegated` asks unless the key is on its trust list. A no blocks the call with a reason that points the model at `install_packages` or local files. Importing a module counts as well as calling it, since cells share one namespace: a later cell can call `requests.get()` without importing it.

Secret files are blocked rather than put to the user, because `background` mode approves everything, and because once a key is in a tool result it is in the model's history for good. A user who really wants `load_dotenv()` in a cell can type it in; plain runs of saved code don't go through the agent's tools.

To keep false alarms down, `scanPython()`, in `packages/shared/src/python.ts` so Verify's checks can use it too, first splits the code into code, comments and string literals, keeping offsets. Module and call patterns only match real code, never comments or strings, and never an attribute, so `logs.socket`, `df.requests.sum()` and `print("use requests")` pass. Only file names are looked for inside strings. `environment.csv`, `.envrc`, `notes.env`, `os.environ`, `urllib.parse`, `from http import HTTPStatus`, `id_rsa_counts.csv` and `requests.head()` all pass. `code-policy.test.ts` lists the cases each way.

It is a speed bump, not a sandbox. It reads the text, so code that builds a module name at run time, or a library that fetches on its own, like `pd.read_csv("https://...")`, gets through.
