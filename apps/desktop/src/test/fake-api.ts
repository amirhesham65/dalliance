import type { CellRunResult, DallianceApi, RunCellRequest, RunEvent, SettingsView } from '@dalliance/shared/ipc'

type RunHandler = (request: RunCellRequest, emit: (event: RunEvent) => void) => Promise<CellRunResult> | CellRunResult

/** A stand-in for the Electron bridge. Tests decide what each run returns. */
export function fakeApi(onRun: RunHandler) {
  const runListeners = new Set<(cellId: string, event: RunEvent) => void>()
  const requests: RunCellRequest[] = []
  const responses: [string, unknown][] = []
  const api: DallianceApi = {
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
    listPackages: async () => ({
      python: '/usr/bin/python3',
      version: '3.12.0',
      packages: [
        { name: 'numpy', version: '2.1.0' },
        { name: 'pandas', version: '2.2.3' },
      ],
      error: null,
    }),
    onKernelState: () => () => {},
    getSettings: async () => fakeSettings(),
    listModels: async () => ({
      provider: 'gateway',
      models: [
        { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', maker: 'Anthropic', price: '$5 / $25' },
        { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', maker: 'Anthropic', price: '$3 / $15' },
        { id: 'openai/gpt-5.2', name: 'GPT-5.2', maker: 'OpenAI', price: '$1.75 / $14' },
        { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro', maker: 'Google', price: '$2 / $12' },
      ],
      error: null,
    }),
    checkKey: async () => ({ status: 'ok', detail: '$5.00 in credits' }),
    updateSettings: async () => {
      throw new Error('not used')
    },
    pythonState: async () => ({ python: '/usr/bin/python3', version: '3.12.0', source: 'system', managedEnvExists: false, missingPackages: [] }),
    setupPython: async () => {
      throw new Error('not used')
    },
    onPythonLog: () => () => {},
    openNotebook: async () => null,
    openRecent: async () => null,
    recentNotebooks: async () => [],
    readBrief: async () => ({ path: '/tmp/AGENTS.md', text: null }),
    writeBrief: async (text) => ({ path: '/tmp/AGENTS.md', text }),
    listFiles: async () => [],
    saveNotebook: async () => '/tmp/test.ipynb',
    confirmDiscard: async () => true,
    restoreSession: async () => null,
    saveDraft: () => {},
    setDocumentState: () => {},
    onMenu: () => () => {},
  }
  return { api, requests, responses }
}

export function fakeSettings(): SettingsView {
  return {
    provider: 'gateway',
    model: 'anthropic/claude-opus-5',
    effort: 'medium',
    pythonPath: null,
    approvalMode: 'interactive',
    autoTitles: true,
    onboarded: true,
    keySource: 'environment',
    hasKey: { gateway: true, anthropic: false },
  }
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
    suggestions: [],
    variables: [],
    activity: [],
    error: null,
    ...overrides,
  }
}
