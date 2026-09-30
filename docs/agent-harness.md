# The agent harness

The agent lives in `apps/desktop/electron/harness/`. It follows Vercel's [Build Your Own AI Coding Agent Harness](https://vercel.com/academy/build-ai-agent-harness) course, adapted from coding to notebook cells, on AI SDK 7.

| File | Does |
| --- | --- |
| `run-cell.ts` | The entry point. Runs saved code directly, or drives a `ToolLoopAgent` |
| `tools.ts` | The eight tools and the `guarded()` wrapper |
| `prompt.ts` | `buildSystemPrompt()` and `buildCellPrompt()` |
| `model.ts` | Provider setup, effort options, the model list for the picker |
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
| `read_file` | Numbered lines of a text file in the workspace | 500 lines, 500 characters a line, 20,000 characters in all. Refuses binaries |
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

**The system prompt**, `buildSystemPrompt()`, covers identity, how to tell a code cell from a question, the steps of a code cell, code style, guardrails, how to handle ambiguity, and what `finish` fields should hold. It ends by saying the cell message may carry notes from `AGENTS.md`, and that they never override these rules.

**The cell prompt**, `buildCellPrompt()`, is the user message. It holds, in order:

1. The notebook folder's `AGENTS.md`, labelled as notes that describe the project and don't override the system rules. Clipped to 8,000 characters, with a note telling the model to read the rest with `read_file`.
2. The last 12 earlier cells. Notes are clipped to 800 characters, code to 1,500.
3. Variables in memory.
4. Files in the workspace.
5. This cell's current code, when regenerating after a prompt change or a correction.
6. The user's corrections.
7. The prompt.

Some rules in the system prompt shape the product, so change them knowingly:

- Name variables after what they hold, never `df` or `result`. Other cells refer to them with `@name`.
- End with exactly one value to show. Don't `print()` summaries.
- Never call `plt.show()`. The kernel captures figures.
- Base every number in the answer on output the model saw.
- Ask only when a wrong guess would make the cell useless. Otherwise state the assumption in `[[brackets]]`.

## Context and caching

Two constraints shape the loop.

**History is append-only.** With adaptive thinking on, the Anthropic API rejects requests that change earlier turns. So there's no `pruneMessages` and no rewriting of past tool results. The 24-step cap and the output bounds keep a run small instead. `run-cell.test.ts` has a test that checks every request only appends to the one before it.

**The system prompt is cached.** It carries `cacheControl: { type: 'ephemeral' }`, so repeated cells reuse the cached prefix. Anything in it that changes per cell breaks the cache. The Python version, tool names and model id are stable within a session. `AGENTS.md`, variables, files and earlier cells can change, so they go in the cell prompt.

**The history is cached too.** For Anthropic models, `agentProviderOptions()` in `model.ts` adds a top-level `cacheControl`. The API then puts a breakpoint on the last block of every request, so each step reads the steps before it from the cache instead of paying for the whole tool history again. No message is marked, so the history stays append-only. Each step adds two blocks, well inside the API's 20-block lookback. `run-cell.test.ts` runs a cell through the real Anthropic provider with a fake `fetch` and checks that every request body has the top-level `cache_control` and the system breakpoint.

## Models and providers

`model.ts` supports two providers.

| Provider | Setting | Default model | Key |
| --- | --- | --- | --- |
| Vercel AI Gateway | `gateway` | `anthropic/claude-opus-5` | `AI_GATEWAY_API_KEY` |
| Anthropic API | `anthropic` | `claude-opus-5` | `ANTHROPIC_API_KEY` |

`resolveModel()` throws `MissingKeyError` without a key. Effort maps per maker:

- Anthropic models, direct or `anthropic/*` on the gateway, get `thinking: { type: 'adaptive' }`, `effort` and the top-level `cacheControl` described in [Context and caching](#context-and-caching).
- `openai/*` models get `reasoningEffort`. `high`, `xhigh` and `max` all map to `high`.
- Every other maker runs with its defaults.

`listModels()` feeds the model picker. On the gateway it calls `getAvailableModels()`, keeps language models, and turns per-token prices into per-million strings. On the Anthropic API it calls `/v1/models`. Results are cached for 10 minutes per provider and key. `MAKERS` maps gateway prefixes to display names. Logos come from `src/assets/makers/`, see [renderer.md](renderer.md#model-maker-logos).

`checkKey()` tries a key before Settings saves it. On the gateway it asks for the credit balance, which also proves the key, and returns it as the detail. On the Anthropic API it lists one model. A 401 or 403 is `rejected`. Anything else that fails, like no network, is `unchecked`, and the renderer saves the key anyway with a note.

`friendlyError()` in `run-cell.ts` rewrites auth, rate limit, unknown model, overload, server and network errors into short messages, pointing at Settings where the fix is there. It goes by the HTTP status on the AI SDK's `APICallError` or the gateway's `GatewayError`, looking through `RetryError` to the last attempt. Without a status it only trusts one the message spells out, like `status code 401` or `429 Too Many Requests`, so a number like `40132 tokens` is never read as an auth error.

## Titles

`title.ts` names cells with a small model, whatever model writes the code.

| Provider | Title model |
| --- | --- |
| Gateway | `openai/gpt-6-luna` with low reasoning effort |
| Anthropic | `claude-haiku-4-5` |

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
