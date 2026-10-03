import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { actions, useNotebook } from './store/notebook-store'

// Follow the system's light or dark appearance
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches)
applyTheme()
dark.addEventListener('change', applyTheme)

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

/** Pick up the notebook that was open before a reload or the last quit, then keep the main process up to date. */
async function restore(api: NonNullable<typeof window.dalliance>) {
  const session = await api.restoreSession().catch(() => null)
  if (session && 'notebook' in session) {
    actions.load(session.notebook, session.path, session.dirty)
    // The kernel outlived the reload, so its variables are still there to list
    if (session.kernelKept) void actions.refreshVariables().catch(() => {})
  } else {
    actions.showWelcome(false)
    // The last notebook is there but won't open, say from a newer version of the app. Say so rather than drop it.
    if (session) actions.notify(session.error, { tone: 'error' })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const send = () => {
    clearTimeout(timer)
    const { notebook, path, dirty } = useNotebook.getState()
    api.saveDraft({ notebook, path, dirty })
  }
  useNotebook.subscribe((s, prev) => {
    if (s.notebook === prev.notebook && s.path === prev.path && s.dirty === prev.dirty) return
    clearTimeout(timer)
    timer = setTimeout(send, 400)
  })
  // A refresh right after an edit still keeps it
  window.addEventListener('beforeunload', send)
}

// In a plain browser, ?demo fills the app with sample data so the UI can be looked at without Electron.
// ?demo&welcome opens on the start page, ?demo&setup on the first-run setup, ?demo&hero on the website's hero notebook.
const params = new URLSearchParams(location.search)
if (window.dalliance) void restore(window.dalliance).finally(render)
else if (params.has('demo'))
  void import('./dev/demo').then((m) => (m.installDemo(params.has('setup') ? 'setup' : params.has('welcome') ? 'welcome' : params.has('hero') ? 'hero' : 'notebook'), render()))
else render()
