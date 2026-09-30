/**
 * A pretend desktop bridge for looking at the UI in a plain browser: open the renderer with ?demo.
 * Nothing here runs inside Electron, where window.dalliance is the real bridge.
 */
import { fakeApi, fakeSettings, fakeTabs, provenance, result } from '@/test/fake-api'
import type { PythonState, RunEvent } from '@dalliance/shared/ipc'
import { type Notebook, type Output, newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import { actions, setApi, useNotebook } from '@/store/notebook-store'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A phase II trial readout: does a new regimen extend survival over standard care?
const survivalTable: Output = {
  type: 'table',
  columns: ['arm', 'patients', 'deaths', 'median_months', 'survival_24m'],
  index: ['0', '1'],
  rows: [
    ['New regimen', 206, 88, 31.2, 0.68],
    ['Standard care', 206, 121, 22.4, 0.5],
  ],
  totalRows: 2,
}

function sampleNotebook(): Notebook {
  const now = Date.now()
  const load = {
    ...newPromptCell('Load patients.csv', "patients = pd.read_csv('patients.csv')\npatients"),
    state: 'done' as const,
    executionCount: 1,
    durationMs: 388,
    answer: 'Loaded **412 patients**, 206 per arm, followed for up to 48 months.',
    outputs: [{ type: 'text', text: '<DataFrame 412 rows × 9 columns>' } as Output],
    variables: [{ name: 'patients', type: 'DataFrame', shape: '412 × 9' }],
  }
  const survival = {
    ...newPromptCell(
      'Median survival and 2-year survival by arm',
      "km = KaplanMeierFitter()\nrows = []\nfor arm, g in patients.groupby('arm'):\n    km.fit(g.months, g.died)\n    rows.append((arm, len(g), g.died.sum(), km.median_survival_time_, km.predict(24)))\nsummary = pd.DataFrame(rows, columns=['arm', 'patients', 'deaths', 'median_months', 'survival_24m'])\nsummary",
    ),
    state: 'done' as const,
    executionCount: 2,
    durationMs: 6_240,
    interpretation: 'Survival is [[time to death, censored at last visit]], measured from [[randomisation]].',
    answer: 'Median survival was **31.2 months** on the new regimen and **22.4** on standard care. At 2 years, **68%** and **50%** were alive.',
    outputs: [survivalTable],
    showTables: true,
    suggestions: ['Plot Kaplan-Meier curves by arm', 'Is the difference significant? Run a log-rank test', 'Hazard ratio adjusted for age and stage'],
    variables: [{ name: 'summary', type: 'DataFrame', shape: '2 × 5' }],
  }
  // How the agent made the survival cell: the first try used the wrong column name
  const firstTry = survival.code.replaceAll('g.died', 'g.death')
  survival.provenance = provenance({
    prompt: survival.prompt,
    madeAt: new Date(now - 3 * 60_000).toISOString(),
    steps: [1, 2, 3, 4, 5].map((step) => ({ step, model: 'anthropic/claude-sonnet-5.5', fallback: false })),
    rationale: {
      from: 'summaries',
      text: [
        'Patients still alive at their last visit are censored, so a plain median of follow-up would understate survival. A Kaplan-Meier fit per arm handles the censoring.',
        'The death flag is called died, not death. Fix the column and run again.',
      ],
    },
    attemptCount: 2,
    attempts: [
      { code: firstTry, error: "AttributeError: 'DataFrame' object has no attribute 'death'", changed: null },
      {
        code: survival.code,
        error: null,
        changed: [
          '-     km.fit(g.months, g.death)',
          "-     rows.append((arm, len(g), g.death.sum(), km.median_survival_time_, km.predict(24)))",
          '+     km.fit(g.months, g.died)',
          "+     rows.append((arm, len(g), g.died.sum(), km.median_survival_time_, km.predict(24)))",
        ].join('\n'),
      },
    ],
    filesRead: [{ path: 'protocol/statistical_analysis_plan.md', by: 'agent' }],
    approvals: [{ kind: 'packages', detail: 'pip install lifelines', outcome: 'approved' }],
    codeHash: 'sha256:5f2c0a9e1d7b43c68e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7',
    outputsHash: 'sha256:9a8b7c6d5e4f30211f2e3d4c5b6a79880f1e2d3c4b5a69788796a5b4c3d2e1f0',
  })
  load.provenance = provenance({
    prompt: load.prompt,
    madeAt: new Date(now - 24 * 60_000).toISOString(),
    steps: [1, 2].map((step) => ({ step, model: 'anthropic/claude-sonnet-5.5', fallback: false })),
    rationale: { from: 'interpretation', text: [load.answer] },
    attemptCount: 1,
    attempts: [{ code: load.code, error: null, changed: null }],
    filesRead: [{ path: 'patients.csv', by: 'code' }],
    approvals: [],
    codeHash: 'sha256:0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a',
    outputsHash: 'sha256:7e6d5c4b3a2918f7e6d5c4b3a2918f7e6d5c4b3a2918f7e6d5c4b3a2918f7e6',
  })
  // The first version took a plain median of follow-up time, which ignores patients still alive at their last visit
  survival.history = [
    { at: now - 3 * 60_000, prompt: survival.prompt, code: survival.code, interpretation: survival.interpretation, answer: survival.answer, edited: false },
    {
      at: now - 21 * 60_000,
      prompt: 'Survival by arm',
      code: "patients.groupby('arm').months.median()",
      interpretation: null,
      answer: 'The new regimen arm had a longer median follow-up.',
      edited: false,
    },
  ]
  const older = {
    ...newPromptCell('Same comparison for patients over 65', "older = patients[patients.age > 65]\nolder.groupby('arm').months.median()"),
    state: 'stale' as const,
    executionCount: 3,
    outputs: [{ type: 'text', text: 'arm\nNew regimen      27.9\nStandard care    21.0' } as Output],
  }
  // A question answered in words, with its steps run into a sentence the way models often write them
  const question = {
    ...newPromptCell('What else should I check before reporting this?', ''),
    state: 'done' as const,
    durationMs: 7_310,
    answer:
      'Check **proportional hazards** first: follow-up in `patients` runs to 48 months and the curves could cross late. A good path: 1) fit a Cox model and test its Schoenfeld residuals, 2) compare dropout rates by arm, 3) look at the 17 patients with missing `stage`, 4) report the hazard ratio with a 95% CI.\nIf proportional hazards do not hold, restricted mean survival time is the usual alternative.',
    suggestions: ['Compare dropout rates by arm', 'Fit a Cox model and test proportional hazards'],
  }
  return {
    cells: [
      newNoteCell(
        '# REGIMEN-2 trial readout\nDoes the **new regimen** extend survival over standard care, and for whom?\n\n## Questions\n- Is the survival gain *significant*?\n- Does it hold for patients over 65?\n- Were dropouts balanced between arms? Start from @patients.',
      ),
      load,
      survival,
      older,
      question,
      newPromptCell('Which patients stopped treatment early, and why?'),
    ],
  }
}

/** `welcome` opens on the start page. `setup` is a first launch: no key, no Python, nothing recent. */
export function installDemo(mode: 'notebook' | 'welcome' | 'setup' = 'notebook') {
  // Questions the agent is waiting on, answered from the card in the cell
  const pending = new Map<string, (answer: string | boolean | null) => void>()
  const sample = sampleNotebook()
  const rerunOutputs = new Map<string, Output[]>(sample.cells.flatMap((c) => (c.kind === 'prompt' && c.code ? [[c.code, c.outputs] as [string, Output[]]] : [])))
  const older = sample.cells.find((c) => c.kind === 'prompt' && c.code.startsWith('older'))
  if (older?.kind === 'prompt') rerunOutputs.set(older.code, [{ type: 'text', text: 'arm\nNew regimen      28.4\nStandard care    21.0' }])
  let rerunCount = 0
  const { api } = fakeApi(async (request, emit: (e: RunEvent) => void) => {
    if (!request.generate) {
      await wait(500)
      // Saved code reruns to what the sample saved, except the over-65 cell, which Verify then reports as changed
      const outputs = rerunOutputs.get(request.code) ?? [survivalTable]
      return result({ code: request.code, outputs, generated: false, executionCount: ++rerunCount })
    }
    if (request.nameIt) setTimeout(() => emit({ type: 'title', title: 'Early stops by reason', prompt: request.prompt }), 900)
    // The sample's last cell is ambiguous on purpose: patients who switched arms change the counts, so the agent asks
    if (/stopped treatment early/.test(request.prompt)) {
      const look = { id: 'q1', label: 'Checking who switched arms', code: 'patients.switched.value_counts()' }
      emit({ type: 'activity', item: { id: 'q0', label: 'Checked variables', status: 'done' } })
      emit({ type: 'activity', item: { ...look, status: 'running' } })
      await wait(600)
      emit({ type: 'activity', item: { ...look, status: 'done', detail: '38 switched' } })
      emit({ type: 'status', text: 'Waiting for your answer' })
      const answer = await new Promise<string | boolean | null>((resolve) => {
        pending.set('switched', resolve)
        emit({
          type: 'question',
          requestId: 'switched',
          question: '38 patients switched arms after progression. Count them in the arm they were randomised to?',
          options: ['Yes, intention to treat', 'No, per protocol'],
        })
      })
      const itt = answer !== 'No, per protocol'
      return result({
        code: `stopped = patients${itt ? '' : '[~patients.switched]'}.query('stopped_early')\nstopped.groupby('arm').reason.value_counts()`,
        outputs: [{ type: 'text', text: 'reason\ntoxicity       19\nprogression    14\nwithdrew        8' }],
        answer: `**41 patients** (10%) stopped early, most often for **toxicity** (19) and **progression** (14). Counted ${itt ? 'by intention to treat' : 'per protocol'}.`,
        activity: [
          { id: 'q0', label: 'Checked variables', status: 'done' },
          { ...look, status: 'done', detail: '312 returned' },
        ],
        durationMs: 3_100,
      })
    }
    const stageCode = "patients.groupby('stage').died.mean().sort_values(ascending=False)"
    const steps = [
      { id: 'a', label: 'Checked variables' },
      { id: 'b', label: 'Counting patients per stage', code: 'patients.stage.value_counts()' },
      { id: 'c', label: 'Comparing death rates by stage', detail: 'Ran in 84 ms', code: stageCode },
    ]
    for (const s of steps) {
      emit({ type: 'status', text: s.label })
      emit({ type: 'activity', item: { ...s, status: 'running' } })
      await wait(700)
      emit({ type: 'activity', item: { ...s, status: 'done' } })
    }
    return result({
      code: stageCode,
      outputs: [{ type: 'text', text: 'stage\nIII    0.58\nII     0.41\nI      0.27' }],
      answer: 'Stage **III** patients had the highest death rate, **58%**.',
      suggestions: ['Survival curves by stage', 'Adjust the arm comparison for stage'],
      activity: steps.map((s) => ({ ...s, status: 'done' as const })),
      durationMs: 2_300,
    })
  })
  api.respond = (id, answer) => {
    pending.get(id)?.(answer)
    pending.delete(id)
  }
  // A few notebooks open in tabs. The demo has one page, so switching only moves the highlight.
  const tabs = fakeTabs([
    { id: 'tab-1', title: 'readout', path: '/Users/demo/REGIMEN-2/readout.ipynb', dirty: false, running: false },
    { id: 'tab-2', title: 'cohorts', path: '/Users/demo/Registry/cohorts.ipynb', dirty: true, running: false },
    {
      id: 'tab-3',
      title: 'Adverse events by grade and arm, first 24 months',
      path: '/Users/demo/REGIMEN-2/Adverse events by grade and arm, first 24 months.ipynb',
      dirty: false,
      running: true,
    },
  ])
  Object.assign(api, tabs.api)
  // The first tab is this page, so it follows the notebook as the real one does
  api.setDocumentState = ({ path, dirty, running = false }) => {
    const title = path ? (path.split('/').pop() ?? path).replace(/\.ipynb$/, '') : 'Untitled'
    tabs.set({ tabs: tabs.get().tabs.map((t) => (t.id === 'tab-1' ? { ...t, title, path, dirty, running } : t)) })
  }
  const brief = { path: '/Users/demo/REGIMEN-2/AGENTS.md', text: null as string | null }
  api.platform = 'darwin'
  api.readBrief = async () => ({ ...brief })
  api.writeBrief = async (text) => {
    brief.text = text
    return { ...brief }
  }
  api.listFiles = async () => [
    { path: 'patients.csv', size: '61.3 KB' },
    { path: 'adverse_events.csv', size: '144.8 KB' },
    { path: 'protocol/statistical_analysis_plan.pdf', size: '812.0 KB' },
  ]
  api.recentNotebooks = async () => [
    { path: '/Users/demo/REGIMEN-2/readout.ipynb', name: 'readout', folder: 'REGIMEN-2', openedAt: Date.now() - 60_000 },
    { path: '/Users/demo/Registry/cohorts.ipynb', name: 'cohorts', folder: 'Registry', openedAt: Date.now() - 3 * 3600_000 },
  ]
  api.listPackages = async () => {
    await wait(300)
    return {
      python: '/usr/bin/python3',
      version: '3.12.4',
      packages: [
        ['matplotlib', '3.9.2'],
        ['numpy', '2.1.1'],
        ['pandas', '2.2.3'],
        ['scipy', '1.14.1'],
        ['statsmodels', '0.14.3'],
      ].map(([name, version]) => ({ name, version })),
      error: null,
    }
  }
  api.openFolder = async (notebook) => ({ path: '/Users/demo/Trials/Untitled.ipynb', notebook })
  api.listVariables = async () => [
    { name: 'patients', type: 'DataFrame', shape: '412 × 9', detail: 'id, arm, age, stage, months, died, stopped_early, reason, switched' },
    { name: 'summary', type: 'DataFrame', shape: '2 × 5', detail: 'arm, patients, deaths, median_months, survival_24m' },
  ]
  let settings = fakeSettings()
  if (mode === 'setup') settings = { ...settings, onboarded: false, keySource: null, hasKey: { gateway: false, anthropic: false } }
  api.getSettings = async () => settings
  // Any key works in the demo, except one with "bad" in it
  api.checkKey = async (provider, key) => {
    await wait(500)
    if (key.includes('bad')) return { status: 'rejected', detail: 'The provider turned this key down. Check that you copied all of it.' }
    return { status: 'ok', detail: provider === 'gateway' ? '$5.00 in credits' : null }
  }
  // Like the real store, switching provider swaps a default model name for the other provider's
  const defaults = { gateway: 'anthropic/claude-sonnet-5.5', anthropic: 'claude-sonnet-5-5', cloud: 'anthropic/claude-sonnet-5.5' }
  api.updateSettings = async ({ apiKey, ...rest }) => {
    const model = rest.provider && rest.provider !== settings.provider && settings.model === defaults[settings.provider] ? defaults[rest.provider] : settings.model
    settings = { ...settings, model, ...rest }
    if (apiKey) settings.hasKey = { ...settings.hasKey, [apiKey.provider]: apiKey.key.trim() !== '' }
    settings.keySource = settings.provider !== 'cloud' && settings.hasKey[settings.provider] ? 'settings' : null
    return settings
  }
  // A first launch finds no Python; setting one up streams a few lines and succeeds
  let python: PythonState = mode === 'setup' ? { python: null, version: null, source: null, managedEnvExists: false, missingPackages: [] } : { python: '/usr/bin/python3', version: '3.12.4', source: 'system', managedEnvExists: false, missingPackages: [] }
  const pythonLogs = new Set<(line: string) => void>()
  api.pythonState = async () => python
  api.onPythonLog = (l) => {
    pythonLogs.add(l)
    return () => pythonLogs.delete(l)
  }
  api.setupPython = async () => {
    for (const line of ['Creating a virtual environment…', 'Installing pandas', 'Installing numpy', 'Installing matplotlib', 'Done.']) {
      pythonLogs.forEach((l) => l(line))
      await wait(450)
    }
    python = { python: '~/Library/Application Support/Dalliance/python/bin/python', version: '3.12.4', source: 'managed', managedEnvExists: true, missingPackages: [] }
    return python
  }
  if (mode === 'setup') api.recentNotebooks = async () => []
  // A spread of makers like the gateway's, one of them without a logo
  api.listModels = async () => ({
    provider: 'gateway',
    error: null,
    models: [
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', maker: 'Anthropic', price: '$2 / $10' },
      { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', maker: 'Anthropic', price: '$5 / $25' },
      { id: 'openai/gpt-6', name: 'GPT-6', maker: 'OpenAI', price: '$2.50 / $15' },
      { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', maker: 'OpenAI', price: '$0.20 / $1.20' },
      { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro', maker: 'Google', price: '$2 / $12' },
      { id: 'spacexai/grok-4.20-non-reasoning', name: 'Grok 4.20', maker: 'xAI', price: '$3 / $15' },
      { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4', maker: 'DeepSeek', price: '$0.28 / $0.42' },
      { id: 'mistral/mistral-large-3', name: 'Mistral Large 3', maker: 'Mistral', price: '$0.50 / $1.50' },
      { id: 'moonshotai/kimi-k3', name: 'Kimi K3', maker: 'Moonshot AI', price: '$0.60 / $2.50' },
      { id: 'zai/glm-5', name: 'GLM 5', maker: 'Z.ai', price: '$0.60 / $2.20' },
      { id: 'thinkingmachines/inkling', name: 'Inkling', maker: 'Thinking Machines', price: '$1 / $4' },
    ],
  })
  setApi(api)
  actions.load(sample, '/Users/demo/REGIMEN-2/readout.ipynb')
  useNotebook.setState({ kernel: { status: 'idle', python: '3.12.4', cwd: '/Users/demo/REGIMEN-2', error: null } })
  const cells = useNotebook.getState().notebook.cells
  useNotebook.setState({ selectedId: cells[2].id, lastFinishedId: cells[2].id })
  // A little history for the run log
  const log = [
    { kind: 'wrote' as const, text: 'Wrote “Median survival and 2-year survival by arm”', cellId: cells[2].id, at: Date.now() - 3 * 60_000 },
    { kind: 'failed' as const, text: '“Median survival and 2-year survival by arm” failed: ModuleNotFoundError', cellId: cells[2].id, at: Date.now() - 5 * 60_000 },
    { kind: 'ran' as const, text: 'Ran “Load patients.csv”', cellId: cells[1].id, at: Date.now() - 12 * 60_000 },
    { kind: 'restarted' as const, text: 'Restarted Python', at: Date.now() - 14 * 60_000 },
    { kind: 'wrote' as const, text: 'Wrote “Load patients.csv”', cellId: cells[1].id, at: Date.now() - 30 * 60_000 },
  ]
  useNotebook.setState({ log: log.map((e, i) => ({ ...e, id: -i - 1 })) })
  void actions.refreshVariables()
  if (mode !== 'notebook') {
    useNotebook.setState({ settings, python })
    actions.showWelcome(false)
  }
}
