/**
 * A pretend desktop bridge for looking at the UI in a plain browser: open the renderer with ?demo.
 * Nothing here runs inside Electron, where window.dalliance is the real bridge.
 */
import { KEYS_ADDED, NO_KEYS, fakeApi, fakeSettings, provenance, result } from '@/test/fake-api'
import type { PythonState, RunEvent } from '@dalliance/shared/ipc'
import { type Notebook, type Output, newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import { DEFAULT_MODELS, MODELS, normalizeModel, providerOf } from '@dalliance/shared/models'
import { actions, setApi, useNotebook } from '@/store/notebook-store'
// Rendered by the real kernel from heroNotebook()'s first cell, at 2x like every figure
import heroChart from './hero-chart.png?inline'

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
    steps: [1, 2, 3, 4, 5].map((step) => ({ step, model: 'anthropic/claude-sonnet-5-5' })),
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
    steps: [1, 2].map((step) => ({ step, model: 'anthropic/claude-sonnet-5-5' })),
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

/**
 * The website's hero capture: survival curves and an adjusted hazard ratio. Every number, the chart and
 * both tables came from running these cells on the kernel against a generated patients.csv.
 */
function heroNotebook(): Notebook {
  const now = Date.now()
  const curves = {
    ...newPromptCell(
      'Survival by treatment arm from patients.csv, with a log-rank test',
      "import matplotlib.pyplot as plt\nimport pandas as pd\nfrom lifelines import KaplanMeierFitter\nfrom lifelines.statistics import logrank_test\n\npatients = pd.read_csv('patients.csv')\nfig, ax = plt.subplots(figsize=(7.4, 3.4))\nfor arm, g in patients.groupby('arm'):\n    km = KaplanMeierFitter(label=arm).fit(g.months, g.died)\n    km.plot_survival_function(ax=ax, lw=1.8, ci_alpha=0.12, show_censors=True, censor_styles={'marker': '|', 'ms': 4, 'mew': 1})\nax.axhline(0.5, ls=':', lw=1, color='#555')\nax.set(title='Overall survival by arm', xlabel='Months since randomisation', ylabel='Survival probability', xlim=(0, 48), ylim=(0, 1.02))\nax.set_xticks(range(0, 49, 12))\n\nnew, std = (patients[patients.arm == a] for a in ('New regimen', 'Standard care'))\nlogrank_test(new.months, std.months, new.died, std.died).summary",
    ),
    state: 'done' as const,
    executionCount: 1,
    durationMs: 5_870,
    interpretation: 'Survival is [[time to death, censored at last visit]], measured from [[randomisation]], compared with a [[log-rank test]].',
    answer: 'Median survival was **31.1 months** on the new regimen and **21.6** on standard care. The gap is significant, log-rank **p = .004**.',
    outputs: [
      { type: 'image', mime: 'image/png', data: heroChart.slice(heroChart.indexOf(',') + 1), width: 720, height: 380 },
      { type: 'table', columns: ['test_statistic', 'p', '-log2(p)'], index: ['0'], rows: [[8.482, 0.0036, 8.123]], totalRows: 1 },
    ] as Output[],
    suggestions: ['Survival curves by stage', 'Restricted mean survival at 36 months', 'Same curves for patients over 65'],
    variables: [{ name: 'patients', type: 'DataFrame', shape: '412 × 6' }],
  }
  const hazards = {
    ...newPromptCell(
      'Hazard ratio for the new regimen, adjusted for age and stage',
      "from lifelines import CoxPHFitter\n\nmodel = patients.assign(\n    new_regimen=(patients.arm == 'New regimen').astype(int),\n    stage_II=(patients.stage == 'II').astype(int),\n    stage_III=(patients.stage == 'III').astype(int),\n)[['months', 'died', 'new_regimen', 'age', 'stage_II', 'stage_III']]\ncph = CoxPHFitter().fit(model, 'months', 'died')\nhazards = cph.summary[['exp(coef)', 'exp(coef) lower 95%', 'exp(coef) upper 95%', 'p']]\nhazards.columns = ['hazard_ratio', 'ci_lower', 'ci_upper', 'p']\nhazards.round(3)",
    ),
    state: 'done' as const,
    executionCount: 2,
    durationMs: 4_120,
    interpretation: 'A [[Cox proportional hazards]] model, with [[standard care]] and [[stage I]] as the reference groups.',
    answer: 'After adjusting for age and stage, the new regimen cut the hazard of death by **28%** (HR **0.72**, 95% CI 0.56 to 0.93).',
    outputs: [
      {
        type: 'table',
        columns: ['hazard_ratio', 'ci_lower', 'ci_upper', 'p'],
        index: ['new_regimen', 'age', 'stage_II', 'stage_III'],
        rows: [
          [0.72, 0.557, 0.931, 0.012],
          [1.024, 1.01, 1.039, 0.001],
          [1.492, 1.055, 2.109, 0.024],
          [2.373, 1.646, 3.42, 0.0],
        ],
        totalRows: 4,
      },
    ] as Output[],
    showTables: true,
    variables: [
      { name: 'cph', type: 'CoxPHFitter', shape: '' },
      { name: 'hazards', type: 'DataFrame', shape: '4 × 4' },
    ],
  }
  for (const [cell, minutes] of [[curves, 6], [hazards, 2]] as const) {
    cell.provenance = provenance({
      prompt: cell.prompt,
      madeAt: new Date(now - minutes * 60_000).toISOString(),
      steps: [1, 2, 3].map((step) => ({ step, model: 'anthropic/claude-opus-5' })),
      rationale: { from: 'interpretation', text: [cell.answer] },
      attemptCount: 1,
      attempts: [{ code: cell.code, error: null, changed: null }],
      filesRead: [{ path: 'patients.csv', by: 'code' }],
      approvals: [],
      codeHash: 'sha256:3b6e1f0c9a2d47e58c1f0a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7',
      outputsHash: 'sha256:c41d9e2a7f3b60581f2e3d4c5b6a79880f1e2d3c4b5a69788796a5b4c3d2e1f0',
    })
  }
  return {
    cells: [
      newNoteCell('# Overall survival\nDoes the **new regimen** extend survival over standard care once age and stage are accounted for?'),
      curves,
      hazards,
      newPromptCell('Check the proportional hazards assumption'),
    ],
  }
}

/** `welcome` opens on the start page. `setup` is a first launch: no key, no Python, nothing recent. `hero` is the website's hero notebook. */
export function installDemo(mode: 'notebook' | 'welcome' | 'setup' | 'hero' = 'notebook', update = false) {
  // Questions the agent is waiting on, answered from the card in the cell
  const pending = new Map<string, (answer: string | boolean | null) => void>()
  const sample = mode === 'hero' ? heroNotebook() : sampleNotebook()
  const folder = mode === 'hero' ? '/Users/demo/Research/REGIMEN-2 Trial' : '/Users/demo/REGIMEN-2'
  const file = `${folder}/${mode === 'hero' ? 'Survival analysis' : 'readout'}.ipynb`
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
  const brief = { path: `${folder}/AGENTS.md`, text: null as string | null }
  api.platform = 'darwin'
  api.readBrief = async () => ({ ...brief })
  api.writeBrief = async (text) => {
    brief.text = text
    return { ...brief }
  }
  api.listFiles = async (directory = '.') => directory === 'protocol' ? [
    { path: 'protocol/statistical_analysis_plan.pdf', size: '812.0 KB', kind: 'file' },
  ] : [
    { path: 'patients.csv', size: '61.3 KB', kind: 'file' },
    { path: 'adverse_events.csv', size: '144.8 KB', kind: 'file' },
    { path: 'protocol', size: '', kind: 'directory' },
  ]
  api.recentNotebooks = async () => [
    { path: file, name: file.slice(folder.length + 1, -'.ipynb'.length), folder: folder.split('/').at(-1)!, openedAt: Date.now() - 60_000 },
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
  api.openProject = async (notebook) => ({ path: '/Users/demo/Trials/Untitled.ipynb', notebook })
  api.projectsFolder = async () => '/Users/demo/Documents/Dalliance Notebooks'
  api.createProject = async (name, notebook) => ({ path: `/Users/demo/Documents/Dalliance Notebooks/${name}/${name}.ipynb`, notebook })
  api.listVariables = async () =>
    mode === 'hero'
      ? [
          { name: 'patients', type: 'DataFrame', shape: '412 × 6', detail: 'id, arm, age, stage, months, died' },
          { name: 'hazards', type: 'DataFrame', shape: '4 × 4', detail: 'hazard_ratio, ci_lower, ci_upper, p' },
        ]
      : [
          { name: 'patients', type: 'DataFrame', shape: '412 × 9', detail: 'id, arm, age, stage, months, died, stopped_early, reason, switched' },
          { name: 'summary', type: 'DataFrame', shape: '2 × 5', detail: 'arm, patients, deaths, median_months, survival_24m' },
        ]
  // A newer release, for the banner over both screens
  if (update) api.getUpdate = async () => ({ version: '0.4.0' })
  let settings = fakeSettings()
  if (mode === 'setup') settings = { ...settings, onboarded: false }
  api.getSettings = async () => settings
  api.updateSettings = async (update) => {
    const model = update.model !== undefined ? normalizeModel(update.model || DEFAULT_MODELS[providerOf(settings.model) ?? 'anthropic']) : settings.model
    const provider = providerOf(model)!
    settings = { ...settings, ...update, model, providerModels: { ...settings.providerModels, [provider]: model } }
    return settings
  }
  let providerKeys = structuredClone(mode === 'setup' ? NO_KEYS : KEYS_ADDED)
  api.getProviderKeys = async () => providerKeys
  api.setProviderKey = async (provider, key) => {
    providerKeys = { ...providerKeys, configured: { ...providerKeys.configured, [provider]: Boolean(key.trim()) } }
    return providerKeys
  }
  api.listModels = async () => ({ models: MODELS.filter((model) => providerKeys.configured[providerOf(model.id)!]), error: null })
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
  setApi(api)
  actions.load(sample, file)
  useNotebook.setState({ kernel: { status: 'idle', python: '3.12.4', cwd: folder, error: null } })
  const cells = useNotebook.getState().notebook.cells
  const selected = cells[mode === 'hero' ? 1 : 2]
  useNotebook.setState({ selectedId: selected.id, lastFinishedId: selected.id })
  // The hero's log is clean: a capture for the website shows no failed run
  if (mode === 'hero') {
    const wrote = (i: number, minutes: number) => ({ kind: 'wrote' as const, text: `Wrote “${cells[i].kind === 'prompt' ? cells[i].prompt : ''}”`, cellId: cells[i].id, at: Date.now() - minutes * 60_000 })
    useNotebook.setState({ log: [wrote(2, 2), wrote(1, 6)].map((e, i) => ({ ...e, id: -i - 1 })) })
    void actions.refreshVariables()
    return
  }
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
