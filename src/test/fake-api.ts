import type { CellRunResult, IliosApi, RunCellRequest, RunEvent } from '@/shared/ipc'

type RunHandler = (request: RunCellRequest, emit: (event: RunEvent) => void) => Promise<CellRunResult> | CellRunResult

/** A stand-in for the Electron bridge. Tests decide what each run returns. */
export function fakeApi(onRun: RunHandler) {
  const runListeners = new Set<(cellId: string, event: RunEvent) => void>()
  const requests: RunCellRequest[] = []
  const responses: [string, unknown][] = []
  const api: IliosApi = {
    platform: 'darwin',
    runCell: async (request) => {
      requests.push(request)
      return onRun(request, (event) => runListeners.forEach((l) => l(request.cellId, event)))
    },
    onRunEvent: (l) => {
      runListeners.add(l)
      return () => runListeners.delete(l)
    },
    respond: (id, answer) => responses.push([id, answer]),
    interrupt: async () => {},
    restartKernel: async () => {},
    kernelState: async () => ({ status: 'idle', python: '3.12.0', cwd: '/tmp', error: null }),
    listVariables: async () => [{ name: 'orders', type: 'DataFrame', shape: '10 × 2', detail: '' }],
    onKernelState: () => () => {},
    getSettings: async () => ({
      provider: 'gateway',
      model: 'anthropic/claude-opus-5',
      effort: 'medium',
      pythonPath: null,
      approvalMode: 'interactive',
      keySource: 'environment',
      hasKey: { gateway: true, anthropic: false },
    }),
    updateSettings: async () => {
      throw new Error('not used')
    },
    pythonState: async () => ({ python: '/usr/bin/python3', version: '3.12.0', source: 'system', managedEnvExists: false, missingPackages: [] }),
    setupPython: async () => {
      throw new Error('not used')
    },
    onPythonLog: () => () => {},
    openNotebook: async () => null,
    saveNotebook: async () => '/tmp/test.ipynb',
    confirmDiscard: async () => true,
    setDocumentState: () => {},
    onMenu: () => () => {},
  }
  return { api, requests, responses }
}

export function result(overrides: Partial<CellRunResult> = {}): CellRunResult {
  return {
    ok: true,
    code: 'x = 1\nx',
    outputs: [{ type: 'text', text: '1' }],
    executionCount: 1,
    durationMs: 12,
    generated: true,
    interpretation: null,
    answer: null,
    variables: [],
    activity: [],
    error: null,
    ...overrides,
  }
}
