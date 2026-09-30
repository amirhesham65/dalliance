import type { Output, PinnedPackage } from '@dalliance/shared/notebook'

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

/** The kernel's Python and the packages its executes imported. See docs/kernel.md. */
export interface KernelEnvironment {
  /** The Python version, like 3.12.4. */
  python: string
  /** The distributions behind what the executes imported, and the loaded ones they require, sorted by name. */
  packages: PinnedPackage[]
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
  /** What the notebook's pins record about the Python. Waits behind a running execute, like every request. */
  environment(): Promise<KernelEnvironment>
  /** Stop the running execution, like Ctrl+C in Jupyter. */
  interrupt(): void
  restart(): Promise<void>
  shutdown(): Promise<void>
}
