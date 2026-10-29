/** Opt-in integration check against a real Python, Streamlit, Electron and the packaged renderer. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow, nativeTheme, type WebFrameMain } from 'electron'
import { appCellCode, appCellText } from '@dalliance/shared/apps'
import { newPromptCell } from '@dalliance/shared/notebook'
import { toIpynb } from '@dalliance/shared/ipynb'
import { DraftStore } from '../draft'
import { PythonKernel } from '../kernel/python-kernel'
import { AppEnvironments } from './environment'
import { ProjectApps } from './project-apps'
import { verifyAppPage } from './verify-app'
import { killGroup } from './process'
import { pythonEnv } from '../secrets'
import supervisorSource from './supervisor.py?raw'

const root = process.env.DALLIANCE_APPS_TEST_ROOT!
const desktop = process.env.DALLIANCE_APPS_TEST_DESKTOP!
const python = process.env.DALLIANCE_TEST_PYTHON!
const workspace = path.join(root, 'project')
const userData = path.join(root, 'user-data')
const missingNotebookPython = path.join(root, 'unavailable-notebook-python')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
async function run() {
  await mkdir(workspace, { recursive: true })
  let manager: ProjectApps | null = null
  let kernel: PythonKernel | null = null
  const timeout = setTimeout(() => { console.error('Apps integration check timed out.'); app.exit(1) }, 300_000)

  async function waitFor<T>(read: () => Promise<T | null | false>, message: string): Promise<T> {
    const start = Date.now()
    while (Date.now() - start < 15_000) {
      const value = await read().catch(() => null)
      if (value) return value
      await delay(150)
    }
    throw new Error(message)
  }
  const click = (window: BrowserWindow, label: string) => window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent?.trim() === ${JSON.stringify(label)}); if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)}); button.click(); })()`)

  try {
    // Seed an isolated session before loading the production main process.
    await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true, pythonPath: missingNotebookPython, workspaceDir: workspace }))
    const source = newPromptCell('Create an app that filters sales by plan')
    const signal = new AbortController().signal
    kernel = new PythonKernel({ python, cwd: workspace, scratchDir: path.join(root, 'kernel') })
    await kernel.start()
    const data = await kernel.execute('import pandas as pd\norders = pd.DataFrame({"plan": ["Pro", "Starter"], "total": [42, 18]})', { store: true })
    assert.equal(data.ok, true)
    const environments = new AppEnvironments(userData, workspace, async () => missingNotebookPython, async () => python)
    manager = new ProjectApps({ workspace, python: async () => python, changed: () => {}, verify: verifyAppPage, environment: environments })
    const saved = await manager.save({ title: 'Sales explorer', description: 'Filter saved orders by plan.', requirements: ['streamlit', 'pandas'], checks: [{ widget: 'checkbox', label: 'Pro plans only', value: true, expectText: '42' }], snapshots: [{ variable: 'orders', file: 'orders.csv' }], code: `import streamlit as st
import pandas as pd
st.title("Sales explorer")
orders = pd.read_csv("data/orders.csv")
pro_only = st.checkbox("Pro plans only")
shown = orders[orders.plan == "Pro"] if pro_only else orders
st.metric("Revenue", int(shown.total.sum()))
st.dataframe(shown)
st.download_button("Download filtered sales", shown.to_csv(index=False), "sales.csv")
` }, { cellId: source.id, notebook: 'Sales.ipynb' }, kernel, signal)
    await kernel.shutdown()
    kernel = null
    // The app must work after the notebook kernel, and its variables, are gone.
    source.code = appCellCode(saved.id)
    source.generatedFrom = source.prompt
    source.state = 'done'
    source.outputs = [{ type: 'text', text: appCellText(saved.id) }]
    const notebook = { cells: [source] }
    const file = path.join(workspace, 'Sales.ipynb')
    await writeFile(file, JSON.stringify(toIpynb(notebook)))
    const drafts = new DraftStore(userData)
    drafts.update({ path: file, notebook, dirty: false })
    drafts.flush()

    console.log('Apps check: saved data snapshot; loading production shell.')
    await import(pathToFileURL(path.join(desktop, 'dist-electron/main.js')).href)
    await app.whenReady()
    nativeTheme.themeSource = 'light'
    console.log('Apps check: verifying the real Streamlit page.')
    const check = await manager.verify(saved.id, signal, async () => true)
    assert.equal(check.ok, true, check.text)
    assert.ok(check.screenshot?.length)
    await writeFile(path.join(root, 'verified-page.png'), check.screenshot!)

    // Close only the parent's ownership pipe to simulate a parent crash, without a normal stop signal.
    const recorded = await manager.manifest(saved.id)
    const environment = await environments.resolve(recorded.requirements, recorded.environment, async () => true, signal)
    const orphan = path.join(root, 'ownership-check')
    await mkdir(orphan)
    const reserve = createServer()
    await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', resolve))
    const address = reserve.address()
    assert.ok(address && typeof address !== 'string')
    const port = address.port
    await new Promise<void>((resolve) => reserve.close(() => resolve()))
    await writeFile(path.join(orphan, 'supervisor.py'), supervisorSource)
    await writeFile(path.join(orphan, 'entry.py'), 'from _dalliance_runtime import run_app\nrun_app()\n')
    await writeFile(path.join(orphan, 'options.json'), JSON.stringify({ 'server.address': '127.0.0.1', 'server.port': port, 'server.headless': true, 'browser.gatherUsageStats': false }))
    const child = spawn(environment.python, ['-I', path.join(orphan, 'supervisor.py'), path.join(workspace, 'apps', saved.id, 'app.py'), path.join(orphan, 'entry.py'), path.join(orphan, 'options.json')], { cwd: orphan, env: pythonEnv(process.env), stdio: ['pipe', 'ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' })
    child.stdio[3]?.on('data', () => {})
    const exited = new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject) })
    try {
      await waitFor(async () => fetch(`http://127.0.0.1:${port}/_stcore/health`).then((r) => r.ok).catch(() => false), 'Ownership-check server did not start')
      child.stdin!.end()
      await Promise.race([exited, delay(4000).then(() => { throw new Error('Server survived closure of its parent ownership pipe') })])
      assert.equal(await fetch(`http://127.0.0.1:${port}/_stcore/health`).then(() => true).catch(() => false), false)
    } finally { killGroup(child, 'SIGKILL') }

    await manager.shutdown()
    manager = null

    console.log('Apps check: page verified; opening through the production bridge.')
    const window = await waitFor(async () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')) ?? null, 'Main window did not open')
    window.webContents.on('console-message', (event) => { if (event.level === 'error') console.error('Renderer:', event.message) })
    await waitFor(async () => window.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="Run cell 1"]')`), 'Notebook did not restore')
    await click(window, 'Apps')
    await click(window, 'Refresh apps')
    await waitFor(async () => window.webContents.executeJavaScript(`document.body.innerText.includes('Filter saved orders by plan.')`), 'Apps sidebar did not discover the project app')
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Project apps"] button').click()`)
    const frame: WebFrameMain = await waitFor(async () => window.webContents.mainFrame.frames.find((f) => f.url.startsWith('http://127.0.0.1:')) ?? null, 'App frame did not load')
    await waitFor(async () => frame.executeJavaScript(`document.querySelector('[data-testid="stMetricValue"]')?.textContent === '60'`), 'App did not render its data snapshot')
    await waitFor(async () => window.webContents.executeJavaScript(`window.dalliance.listApps().then(apps => apps.some(a => a.id === ${JSON.stringify(saved.id)} && a.busy === false && a.memoryMb > 0))`), 'Server telemetry did not report a known idle state')
    assert.equal(await frame.executeJavaScript('typeof window.dalliance'), 'undefined', 'App received the privileged bridge')
    await frame.executeJavaScript(`document.querySelector('input[type="checkbox"]').click()`)
    await waitFor(async () => frame.executeJavaScript(`document.querySelector('[data-testid="stMetricValue"]')?.textContent === '42'`), 'Widget interaction did not update the app')
    await waitFor(async () => frame.executeJavaScript(`getComputedStyle(document.querySelector('[data-testid="stApp"]')).backgroundColor === 'rgb(255, 255, 255)'`), 'Light appearance does not match Dalliance')
    await delay(400)
    await writeFile(path.join(root, 'app-shell-light.png'), (await window.webContents.capturePage()).toPNG())
    nativeTheme.themeSource = 'dark'
    await delay(1000)
    await waitFor(async () => frame.executeJavaScript(`getComputedStyle(document.querySelector('[data-testid="stApp"]')).backgroundColor === 'rgb(26, 26, 25)'`), 'Dark appearance did not follow Dalliance')
    assert.equal(await frame.executeJavaScript(`document.querySelector('[data-testid="stMetricValue"]')?.textContent`), '42', 'Appearance change reset widget state')
    assert.ok(await frame.executeJavaScript(`getComputedStyle(document.body).fontFamily.includes('Inter')`), 'App typography does not use Inter')
    await delay(400)
    await writeFile(path.join(root, 'app-shell.png'), (await window.webContents.capturePage()).toPNG())
    const identity = frame.frameTreeNodeId
    await click(window, 'Back to notebook')
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Project apps"] button').click()`)
    assert.equal(window.webContents.mainFrame.frames.find((f) => f.url.startsWith('http://127.0.0.1:'))?.frameTreeNodeId, identity, 'Switching views recreated the app session')
    assert.equal(await frame.executeJavaScript(`document.querySelector('[data-testid="stMetricValue"]')?.textContent`), '42')
    await click(window, 'Stop app')
    await waitFor(async () => window.webContents.executeJavaScript(`document.querySelector('[aria-label="App viewer"]')?.textContent?.includes('This app is stopped.')`), 'Stop did not update the shell')
    console.log(`Apps integration passed: isolated locked environment, interaction checks, parent-crash cleanup, telemetry, live light/dark themes, bridge isolation, preserved session and explicit stop. Screenshots: ${root}`)
    clearTimeout(timeout)
    // This disposable test session must not wait on normal window-close or save interactions.
    app.exit(0)
  } catch (err) {
    console.error(err instanceof Error ? err.stack : String(err))
    clearTimeout(timeout)
    await manager?.shutdown()
    await kernel?.shutdown()
    app.exit(1)
  }

}
void run()
