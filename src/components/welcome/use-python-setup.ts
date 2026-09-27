import { useEffect, useState } from 'react'
import type { IliosApi } from '@/shared/ipc'
import { useNotebook } from '@/store/notebook-store'

/** Creates the app's own Python environment, streaming the installer's output. Settings and the first-run setup share it. */
export function usePythonSetup(api: IliosApi) {
  const [log, setLog] = useState<string[]>([])
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => api.onPythonLog((line) => setLog((l) => [...l.slice(-200), line])), [api])

  const setup = async () => {
    setInstalling(true)
    setError(null)
    setLog([])
    try {
      useNotebook.setState({ python: await api.setupPython() })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setInstalling(false)
    }
  }

  return { log, installing, error, setup }
}
