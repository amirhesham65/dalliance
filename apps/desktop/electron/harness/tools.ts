import { tool } from 'ai'
import { z } from 'zod'
import { leakedList, splitLeaked } from '@ilios/shared/leaked'
import type { Output } from '@ilios/shared/notebook'
import type { ExecuteResult, Kernel } from '../kernel/kernel'
import type { EventBus } from './events'
import { clip, formatVariables, outputsToText } from './format'
import { listFiles, readFileBounded } from './workspace'

/** What the tools learn during a run. The harness reads it after the loop ends. */
export interface RunState {
  lastRun: { code: string; result: ExecuteResult } | null
  finished: { interpretation: string | null; answer: string | null; suggestions: string[] } | null
  attempts: number
}

export interface ToolDeps {
  cellId: string
  kernel: Kernel
  workspaceDir: string
  bus: EventBus
  state: RunState
  /** Streams outputs of a run_cell attempt to the UI as they arrive. */
  onAttempt: (code: string) => void
  onOutput: (output: Output) => void
  askUser: (question: string, options: string[]) => Promise<string | null>
  /** Returns true when the user approved. Only called when the approval policy says a person must decide. */
  requestApproval: (title: string, detail: string) => Promise<boolean>
  needsApproval: (packages: string[]) => boolean
  installPackages: (packages: string[]) => Promise<string>
  exploreTimeoutMs?: number
}

const MAX_EXPLORE_CHARS = 4000
/** Exploration should take seconds. Anything slower is usually scanning something huge. */
export const EXPLORE_TIMEOUT_MS = 20_000
const MAX_RUN_CHARS = 5000

/**
 * Tool descriptions are the model's selection API: WHEN TO USE, WHEN NOT TO USE, DO NOT USE FOR.
 * Every tool bounds its output, and every call goes through the event bus first.
 */
export function createCellTools(deps: ToolDeps) {
  const { kernel, bus, state, cellId } = deps

  async function guarded<T>(toolName: string, input: unknown, run: () => Promise<T>): Promise<T | string> {
    const gate = await bus.emit('tool_call', { cellId, toolName, input })
    if (gate.blocked) return `Blocked: ${gate.reason}`
    try {
      const output = await run()
      await bus.emit('tool_result', { cellId, toolName, input, output, ok: true })
      return output
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await bus.emit('tool_result', { cellId, toolName, input, ok: false, error })
      throw err
    }
  }

  return {
    list_variables: tool({
      description: `List the variables in the kernel's memory with their types, shapes and DataFrame columns.
WHEN TO USE: before writing code that uses existing data, or when the prompt mentions @name.
WHEN NOT TO USE: you already listed them in this run and nothing has run since.`,
      inputSchema: z.object({}),
      execute: () => guarded('list_variables', {}, async () => formatVariables(await kernel.variables())),
    }),

    explore: tool({
      description: `Run a short piece of Python to look at data, without it becoming the cell.
WHEN TO USE: checking columns, dtypes, value counts, a few rows, or whether a value exists before you write the cell.
WHEN NOT TO USE: running the cell itself (use run_cell).
DO NOT USE FOR: creating, changing or deleting variables, files or state. It shares the kernel's namespace.
EXAMPLES: subs.head(3) | subs.plan.value_counts() | sorted(events.type.unique())`,
      inputSchema: z.object({ code: z.string().describe('Python to evaluate. The last expression is returned.') }),
      execute: ({ code }) =>
        guarded('explore', { code }, async () => {
          let timedOut = false
          const timer = setTimeout(() => {
            timedOut = true
            kernel.interrupt()
          }, deps.exploreTimeoutMs ?? EXPLORE_TIMEOUT_MS)
          try {
            const result = await kernel.execute(code, { store: false })
            if (timedOut)
              return `Stopped after ${Math.round((deps.exploreTimeoutMs ?? EXPLORE_TIMEOUT_MS) / 1000)} seconds. Exploration must be quick: don't scan folders or large data. Look at a sample instead.`
            return clip(outputsToText(result.outputs, MAX_EXPLORE_CHARS), MAX_EXPLORE_CHARS)
          } finally {
            clearTimeout(timer)
          }
        }),
    }),

    list_files: tool({
      description: `List files in the notebook's folder, with sizes.
WHEN TO USE: the prompt mentions a file, or you need to know what data is available on disk.
WHEN NOT TO USE: the data is already loaded in a variable.`,
      inputSchema: z.object({}),
      execute: () => guarded('list_files', {}, async () => (await listFiles(deps.workspaceDir)).join('\n') || '(the folder is empty)'),
    }),

    read_file: tool({
      description: `Read a text file from the notebook's folder. Returns numbered lines, at most 500.
WHEN TO USE: checking a CSV header, a config file or a README before loading it with Python.
WHEN NOT TO USE: loading data for analysis (do that in run_cell with pandas).
DO NOT USE FOR: files outside the notebook's folder.`,
      inputSchema: z.object({
        path: z.string().describe("Path relative to the notebook's folder"),
        offset: z.number().int().min(1).optional().describe('First line to read, starting at 1'),
        limit: z.number().int().min(1).max(500).optional().describe('How many lines to read'),
      }),
      execute: ({ path, offset, limit }) =>
        guarded('read_file', { path, offset, limit }, () => readFileBounded(deps.workspaceDir, path, offset, limit)),
    }),

    run_cell: tool({
      description: `Run the complete code for this cell on the kernel and see its outputs.
WHEN TO USE: every time you have a full version of the cell's code, including after fixing an error.
WHEN NOT TO USE: quick looks at data (use explore).
USAGE: pass the whole cell, not a diff. Only the last successful run is kept. After it succeeds, call finish.`,
      inputSchema: z.object({ code: z.string().describe('The complete Python code for the cell') }),
      execute: ({ code }) =>
        guarded('run_cell', { code }, async () => {
          state.attempts += 1
          deps.onAttempt(code)
          const result = await kernel.execute(code, { store: true, onOutput: deps.onOutput })
          state.lastRun = { code, result }
          const text = outputsToText(result.outputs, MAX_RUN_CHARS)
          return result.ok
            ? `Ran successfully in ${result.durationMs} ms.\nOutputs:\n${text}\nIf this answers the prompt, call finish. Otherwise fix the code and call run_cell again.`
            : `The cell failed.\n${text}\nFix the code and call run_cell again.`
        }),
    }),

    install_packages: tool({
      description: `Install Python packages into the kernel's environment with pip. The user approves each install.
WHEN TO USE: an import failed with ModuleNotFoundError and the package is needed for the prompt.
WHEN NOT TO USE: the package is already importable, or the standard library can do the job.`,
      inputSchema: z.object({ packages: z.array(z.string()).min(1).max(5).describe('pip package names') }),
      execute: ({ packages }) =>
        guarded('install_packages', { packages }, async () => {
          if (deps.needsApproval(packages)) {
            const approved = await deps.requestApproval(`Install ${packages.join(', ')}?`, `pip install ${packages.join(' ')}`)
            if (!approved) return `The user declined installing ${packages.join(', ')}. Solve it without these packages, or explain in finish why you can't.`
          }
          const log = await deps.installPackages(packages)
          return `Installed ${packages.join(', ')}.\n${clip(log, 1500, 'end')}`
        }),
    }),

    ask_user: tool({
      description: `Ask the user a multiple-choice question and wait for the answer.
WHEN TO USE: a wrong guess would make the whole cell useless, and the data can't tell you which reading is right.
WHEN NOT TO USE: you can pick a sensible default and state it as an assumption in finish.
DO NOT USE FOR: progress updates, confirmations, or questions the variables and files can answer.`,
      inputSchema: z.object({
        question: z.string().describe('One short question'),
        options: z.array(z.string()).min(2).max(4).describe('Two to four concrete options'),
      }),
      execute: ({ question, options }) =>
        guarded('ask_user', { question, options }, async () => {
          const answer = await deps.askUser(question, options)
          return answer == null ? 'The user skipped the question. Use your best judgment and state it as an assumption.' : `The user answered: ${answer}`
        }),
    }),

    finish: tool({
      description: `Finish the cell. Keeps the last successful run_cell as the cell's code and outputs.
WHEN TO USE: the last run_cell succeeded and its output answers the prompt, or the prompt is a question you answer in words without running cell code.
WHEN NOT TO USE: the prompt asks for a computed result and no run_cell has succeeded yet, or the last run failed.`,
      inputSchema: z.object({
        interpretation: z
          .string()
          .describe('How you read the prompt, with changeable assumptions in [[double brackets]]. Empty string if nothing needed interpreting.'),
        answer: z
          .string()
          .describe('The answer in words, grounded in the output. Plain text with **bold** and `code`; lists one item per line. Empty string if the prompt was not a question.'),
        next: z
          .array(z.string())
          .max(3)
          .optional()
          .describe('Up to three short prompts the user could run as the next cell, written the way they would type them. Empty if nothing obvious follows.'),
      }),
      execute: (input) =>
        guarded('finish', input, async () => {
          // Recover the fields a model wrote into the text instead of passing them
          const leakedInterpretation = splitLeaked(input.interpretation)
          const leakedAnswer = splitLeaked(input.answer)
          const leaked = { ...leakedInterpretation.params, ...leakedAnswer.params }
          const interpretation = leakedInterpretation.text
          const answer = leakedAnswer.text || leaked.answer || ''
          const next = input.next?.length ? input.next : leakedList(leaked.next)
          const suggestions = next.map((n) => n.trim().replace(/^["“]|["”]$/g, '')).filter(Boolean).slice(0, 3)
          // A question answered in words needs no code, but it does need an answer
          if (!state.lastRun) {
            if (!answer.trim()) return 'Nothing has run yet. Call run_cell with the cell code, or give an answer if the prompt is a question.'
            state.finished = { interpretation: interpretation.trim() || null, answer: answer.trim(), suggestions }
            return 'Done.'
          }
          if (!state.lastRun.result.ok) return 'The last run_cell failed. Fix the code and run it again before finishing.'
          state.finished = { interpretation: interpretation.trim() || null, answer: answer.trim() || null, suggestions }
          return 'Done.'
        }),
    }),
  }
}

export type CellTools = ReturnType<typeof createCellTools>
