import type { DallianceApi, SettingsUpdate } from '@dalliance/shared/ipc'
import { useNotebook } from '@/store/notebook-store'

/** Saves a change through the bridge and puts the new settings in the store. */
export async function saveSettings(api: DallianceApi, update: SettingsUpdate) {
  const view = await api.updateSettings(update)
  useNotebook.setState({ settings: view })
  return view
}
