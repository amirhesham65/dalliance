import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

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

// In a plain browser, ?demo fills the app with sample data so the UI can be looked at without Electron
if (!window.ilios && new URLSearchParams(location.search).has('demo')) void import('./dev/demo').then((m) => (m.installDemo(), render()))
else render()
