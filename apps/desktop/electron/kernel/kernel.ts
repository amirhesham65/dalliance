import type { Output } from '@dalliance/shared/notebook'

export interface VariableInfo {
  name: string
  type: string
  shape: string
  detail: string
}

export interface ExecuteResult {
  ok: boolean
  outputs: Output[]
  /** Null for exploratory runs, which don't advance the counter. */
  executionCount: number | null
  durationMs: number
  /** Names the run bound or rebound. Empty for exploratory runs. */
  assigned: VariableInfo[]
  /** Files inside the working directory the run opened for reading. Absent when the kernel doesn't report them. */
  filesRead?: FilesRead
}

/** What the kernel's audit hook saw one execute read. See docs/kernel.md. */
export interface FilesRead {
  /** Paths relative to the folder the run started in, with `/` separators, in the order first opened, each once. */
  paths: string[]
  /** True when the run read more than the kernel lists (MAX_FILES_READ). */
  truncated: boolean
}

export interface ExecuteOptions {
  /** Cell runs advance the execution counter and set `_`; exploratory runs by the agent don't. */
  store: boolean
  onOutput?: (output: Output) => void
}

export type KernelStatus = 'starting' | 'idle' | 'busy' | 'dead'

export interface KernelInfo {
  status: KernelStatus
  python: string | null
  executable: string | null
  cwd: string
  error: string | null
}

/**
 * One interface, several implementations: the agent's tools call kernel.execute(),
 * never child_process directly. Tests swap in FakeKernel.
 */
export interface Kernel {
  info(): KernelInfo
  execute(code: string, options: ExecuteOptions): Promise<ExecuteResult>
  variables(): Promise<VariableInfo[]>
  /** Stop the running execution, like Ctrl+C in Jupyter. */
  interrupt(): void
  restart(): Promise<void>
  shutdown(): Promise<void>
}
