export interface AppCheck {
  widget: 'checkbox' | 'toggle' | 'selectbox' | 'radio' | 'slider' | 'number_input' | 'text_input' | 'text_area' | 'multiselect' | 'date_input' | 'button'
  label: string
  value?: string | number | boolean | (string | number)[]
  expectText: string
}
export interface AppEnvironment {
  pythonVersion: string
  packages: { name: string; version: string }[]
}
export interface AppSnapshot {
  variable: string
  file: string
  exportedAt: string
  hash?: string
  sourceHash?: string
}
/** Portable app metadata. Addresses, memory and process state are never saved here. */
export interface ProjectApp {
  version: 1
  id: string
  title: string
  description: string
  entry: 'app.py'
  sourceCellId: string
  sourceNotebook: string | null
  requirements: string[]
  snapshots: AppSnapshot[]
  updatedAt: string
  verifiedAt?: string
  environment?: AppEnvironment
  checks?: AppCheck[]
  design?: 'dalliance' | 'custom'
}
export interface AppView extends ProjectApp {
  status: 'stopped' | 'starting' | 'running' | 'error'
  url: string | null
  error: string | null
  logs: string
  busy?: boolean | null
  memoryMb?: number | null
  keepRunning?: boolean
  idleStopAt?: number | null
  stoppedReason?: 'idle' | 'manual' | 'capacity' | null
  dataState?: 'current' | 'changed' | 'unavailable'
  historyCount?: number
  buildError?: string | null
}
export interface AppDraft {
  id?: string
  title: string
  description: string
  code: string
  requirements: string[]
  snapshots: { variable: string; file: string }[]
  checks?: AppCheck[]
  design?: 'dalliance' | 'custom'
}
export interface AppVerification {
  ok: boolean
  text: string
  screenshot?: Uint8Array
}
export interface AppPolicy {
  idleMinutes: number
  maxRunning: number
  historyLimit: number
}
export const DEFAULT_APP_POLICY: AppPolicy = { idleMinutes: 15, maxRunning: 3, historyLimit: 5 }

export function appCellCode(id: string): string {
  return `# dalliance-app: ${id}\n# This app lives in apps/${id}/app.py. Open it from Apps.\n`
}
export function appIdFromCode(code: string): string | null {
  const id = /^# dalliance-app: ([a-z0-9][a-z0-9-]{0,63})\n/.exec(code)?.[1]
  return id && code === appCellCode(id) ? id : null
}
export const appCellText = (id: string) => `App saved in apps/${id}/app.py. Open it from Apps. Use Refresh data to update its saved notebook inputs.`
