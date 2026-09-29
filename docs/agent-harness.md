# The agent harness

The agent lives in `apps/desktop/electron/harness/`. It follows Vercel's [Build Your Own AI Coding Agent Harness](https://vercel.com/academy/build-ai-agent-harness) course, adapted from coding to notebook cells, on AI SDK 7.

| File | Does |
| --- | --- |
| `run-cell.ts` | The entry point. Runs saved code directly, or drives a `ToolLoopAgent` |
| `tools.ts` | The eight tools and the `guarded()` wrapper |
| `prompt.ts` | `buildSystemPrompt()` and `buildCellPrompt()` |
| `model.ts` | Provider setup, effort options, the model list for the picker |
| `ollama.ts` | Ollama's key check, model list and plan probe |
| `title.ts` | The small model that names cells |
| `approval.ts` | Whether a package install needs a person |
| `events.ts` | The event bus extensions hook into |
| `format.ts` | `clip()`, `outputsToText()`, `formatVariables()` |
| `workspace.ts` | File listing and reading inside the notebook's folder |

`NotebookSession` in `electron/session.ts` builds the dependencies and calls `runCell()`. The harness never imports Electron, so tests can run it with a fake kernel and a scripted model.

## The loop

`generateCell()` in `run-cell.ts`:

1. Emits `run_start` on the event bus.
2. Reads the kernel's variables and lists up to 80 files in the workspace.
3. Builds the tools with `createCellTools()` and a `ToolLoopAgent` with the system prompt as `instructions`.
4. Streams with `stopWhen: [stepCountIs(24), () => state.finished != null]`.
5. Turns stream parts into activity items and status text for the renderer.
6. Emits `run_end` and builds a `CellRunResult` from `state.lastRun` and `state.finished`.

The tools write to a shared `RunState`:

```ts
interface RunState {
  lastRun: { code; result } | null  // the last run_cell, successful or not
  finished: { interpretation; answer; suggestions } | null
  attempts: number
}
```

The result is `ok` when there was no error and either the last `run_cell` succeeded, or `finish` was called with an answer and no code ran at all. That second case is a question answered in words, and the cell ends up with empty code. When the model stops without finishing, the error says so: either the code still failed after N tries, or the model's own text, clipped to 600 characters.

If the model answers in plain text instead of calling `finish`, and the last run succeeded, that text becomes the answer.

## Tools

Every tool's description follows the course's format: WHEN TO USE, WHEN NOT TO USE, and DO NOT USE FOR where it helps. The description is how the model chooses, so keep it accurate when you change behaviour.

| Tool | Does | Bounds |
| --- | --- | --- |
| `list_variables` | Lists kernel variables with type, shape and DataFrame columns | 40 variables, 300 characters of detail each |
| `explore` | Runs a snippet with `store: false`. No execution count, no `_` | 4,000 characters. Interrupted after 20 s |
| `list_files` | Lists the workspace, 4 folders deep, skipping dotfiles and `node_modules`, `.venv` and similar | 200 files |
| `read_file` | Numbered lines of a text file in the workspace | 500 lines, 500 characters a line, refuses binaries |
| `run_cell` | Runs the complete cell with `store: true` and records it as `lastRun` | 5,000 characters. Tables show 15 rows to the model |
| `install_packages` | `pip install` into the kernel's interpreter | 1 to 5 packages. Last 1,500 characters of the log |
| `ask_user` | A multiple-choice question in the cell | 2 to 4 options |
| `finish` | Ends the cell with interpretation, answer and `next` | Up to 3 suggestions |

`finish` is the verification gate. It refuses when no code ran and there's no answer, or when the last `run_cell` failed. The refusal goes back to the model as the tool result, and the loop carries on.

### guarded()

Every tool body runs inside `guarded(toolName, input, run)`:

1. Emits `tool_call`. A handler can return `{ block: true, reason }`, and the tool returns `Blocked: <reason>` instead of running.
2. Runs the tool.
3. Emits `tool_result` with the output or the error.

A new tool must use it. The `.env` block and the run log both depend on it.

### Leaked tool markup

Some models write the rest of a tool call into a text field, like `...the answer.</answer><parameter name="next">[...]`. `splitLeaked()` and `leakedList()` in `packages/shared/src/leaked.ts` cut that markup off and recover the parameters. `finish` runs both `interpretation` and `answer` through them. The renderer's `Answer` component does the same for answers saved before this existed.

## Prompts

`prompt.ts` builds two messages.

**The system prompt**, `buildSystemPrompt()`, covers identity, how to tell a code cell from a question, the steps of a code cell, code style, guardrails, how to handle ambiguity, and what `finish` fields should hold. The notebook folder's `AGENTS.md` is appended at the end as project instructions.

**The cell prompt**, `buildCellPrompt()`, is the user message. It holds, in order:

1. The last 12 earlier cells. Notes are clipped to 800 characters, code to 1,500.
2. Variables in memory.
3. Files in the workspace.
4. This cell's current code, when regenerating after a prompt change or a correction.
5. The user's corrections.
6. The prompt.

Some rules in the system prompt shape the product, so change them knowingly:

- Name variables after what they hold, never `df` or `result`. Other cells refer to them with `@name`.
- End with exactly one value to show. Don't `print()` summaries.
- Never call `plt.show()`. The kernel captures figures.
- Base every number in the answer on output the model saw.
- Ask only when a wrong guess would make the cell useless. Otherwise state the assumption in `[[brackets]]`.

## Context and caching

Two constraints shape the loop.

**History is append-only.** With adaptive thinking on, the Anthropic API rejects requests that change earlier turns. So there's no `pruneMessages` and no rewriting of past tool results. The 24-step cap and the output bounds keep a run small instead. `run-cell.test.ts` has a test that checks every request only appends to the one before it.

**The system prompt is cached.** It carries `cacheControl: { type: 'ephemeral' }`, so repeated cells reuse the cached prefix. Anything in it that changes per cell breaks the cache. The Python version, tool names, model id and `AGENTS.md` are stable within a session. Variables, files and earlier cells change, so they go in the cell prompt.

## Models and providers

`model.ts` supports four providers.

| Provider | Setting | Default model | Key |
| --- | --- | --- | --- |
| Vercel AI Gateway | `gateway` | `anthropic/claude-opus-5` | `AI_GATEWAY_API_KEY` |
| Anthropic API | `anthropic` | `claude-opus-5` | `ANTHROPIC_API_KEY` |
| Ollama - Cloud | `ollama-cloud` | `gpt-oss:120b` | `OLLAMA_API_KEY` |
| Ollama - Local | `ollama-local` | `llama3.2:3b` | none |

`resolveModel()` throws `MissingKeyError` without a key, except for Ollama - Local, which takes none (`needsKey()`). Ollama goes through `@ai-sdk/openai-compatible` at `/v1` on `https://ollama.com` or `http://127.0.0.1:11434`, since Ollama serves the OpenAI chat API next to its own. Effort maps per maker:

- Anthropic models, direct or `anthropic/*` on the gateway, get `thinking: { type: 'adaptive' }` and `effort`.
- `openai/*` models get `reasoningEffort`. `high`, `xhigh` and `max` all map to `high`.
- Every other maker, Ollama models included, runs with its defaults.

`listModels()` feeds the model picker. On the gateway it calls `getAvailableModels()`, keeps language models, and turns per-token prices into per-million strings. On the Anthropic API it calls `/v1/models`. Results are cached for 10 minutes per provider and key. `MAKERS` maps gateway prefixes to display names. Logos come from `src/assets/makers/`, see [renderer.md](renderer.md#model-maker-logos).

`checkKey()` tries a key before Settings saves it. On the gateway it asks for the credit balance, which also proves the key, and returns it as the detail. On the Anthropic API it lists one model. On Ollama - Cloud it posts to `/api/me`, the one route that reads the key, since the catalog is public. Ollama - Local has no key, so the check is whether the server answers, and a failure says Ollama isn't running. A 401 or 403 is `rejected`. Anything else that fails, like no network, is `unchecked`, and the renderer saves the key anyway with a note.

`friendlyError()` in `run-cell.ts` rewrites auth, rate limit and unknown model errors into messages that point at Settings. Ollama's own failures are told apart first: a plan that lacks a model answers 403, which would otherwise read as a bad key, and Ollama not running, a model not pulled and a model that can't call tools each get their own line.

### Ollama

`listOllamaModels()` in `ollama.ts` reads `/api/tags`. The harness works through tool calls, so models without the `tools` and `completion` capabilities, like embedding models, are left out. The local listing reports capabilities itself. The cloud catalog doesn't, so each model is asked through `/api/show`, eight at a time. A model that can't be asked stays in. Ollama ids name the model, not the maker, so `FAMILIES` maps a name's start to a maker for the picker's groups. The local list is never cached, since `ollama pull` changes it.

Ollama - Cloud plans differ in which models they run, and nothing lists that. `probeOllamaModels()` asks each model for one token, two at a time, and marks it `locked` on a 402, 403 or 404. Any other answer, a timeout or a 429 that stays included, leaves it available, since the run itself will say if it isn't. `probeModels()` in `model.ts` caches the result for 10 minutes per key. The renderer shows the full list first and drops the locked models when the probe returns. See [renderer.md](renderer.md#the-model-list).

## Titles

`title.ts` names cells with a small model, whatever model writes the code.

| Provider | Title model |
| --- | --- |
| Gateway | `openai/gpt-6-luna` with low reasoning effort |
| Anthropic | `claude-haiku-4-5` |
| Ollama | none. Cells keep their prompt as the name |

The call has a 10 second timeout, one retry and 1,024 output tokens, since reasoning counts toward output. `cleanTitle()` keeps the first line, strips quotes, prefixes like `Title:`, trailing punctuation and `@`, and caps it at 6 words. Any failure returns `null`, and the cell keeps showing its prompt. The session starts the title request alongside the run and never waits on it. Settings can turn titles off with `autoTitles`.

## Approvals

`approval.ts` models the policy as data:

```ts
type ApprovalConfig =
  | { mode: 'interactive' }                  // ask for anything not yet trusted
  | { mode: 'background' }                   // never ask
  | { mode: 'delegated'; trust: string[] }   // ask for anything outside the list
```

Settings exposes `interactive` and `background`. `delegated` exists in the code but not in the UI. Once the user approves an install, the session trusts those package names, normalized to lowercase without version specifiers, until the app quits.

`installPackages()` in `kernel/python-env.ts` rejects names with characters outside letters, digits and version specifier punctuation before it calls pip.

## The event bus

`EventBus` in `events.ts` has four events: `run_start`, `tool_call`, `tool_result`, `run_end`. Handlers run in registration order. The first `tool_call` handler that returns `{ block: true }` stops the call.

`NotebookSession.installExtensions()` registers the built-in ones:

- Block `read_file` on `.env` and `.env.*`.
- Append every event to `logs/agent.jsonl` in userData, with strings clipped to 2,000 characters.

Add new policy here rather than inside a tool.
