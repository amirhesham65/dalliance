import { useState } from 'react'
import { actions, getApi, useNotebook } from '@/store/notebook-store'

/**
 * The notebook's name at the top of the overview, which is a button until it is clicked and a text field after, as
 * in Jupyter. Enter or leaving the field renames the file, Esc keeps the old name. A name that can't be used stays
 * in the field with the reason under it.
 */
export function NotebookName({ name, path }: { name: string; path: string | null }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const api = getApi()

  const cancel = () => {
    setDraft(null)
    setError(null)
  }
  const commit = async () => {
    if (draft == null || saving) return
    const next = draft.trim().replace(/\.ipynb$/i, '').trim()
    if (!api || !next || next === name) return cancel()
    setSaving(true)
    try {
      const { notebook } = useNotebook.getState()
      const result = await api.renameNotebook(path, next, notebook)
      if ('error' in result) return setError(result.error)
      actions.renamed(result.path, result.saved, result.pins)
      cancel()
    } catch (err) {
      setError(`Couldn't rename the notebook: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const look = 'min-w-0 rounded-md text-[17px] font-semibold tracking-[-0.01em]'
  if (draft == null) {
    return (
      <h1 className="min-w-0">
        <button
          type="button"
          onClick={() => setDraft(name)}
          title={path ? `${path}\nClick to rename` : 'Click to name this notebook'}
          aria-label={`Notebook name: ${name}. Click to rename`}
          // Only as wide as the name, so the hover highlight doesn't run on into the empty space to its right
          className={`${look} -mx-1 inline-block max-w-full truncate px-1 align-top outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50`}
        >
          {name}
        </button>
      </h1>
    )
  }
  return (
    <div className="min-w-0">
      <input
        aria-label="Notebook name"
        aria-invalid={error != null}
        aria-describedby={error ? 'notebook-name-error' : undefined}
        autoFocus
        value={draft}
        // readOnly, not disabled: a disabled field loses focus, and a refused name would then ignore Enter and Esc
        readOnly={saving}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(null)
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') {
            e.stopPropagation()
            cancel()
          }
        }}
        // No box while typing: the text keeps its place and only the caret shows, and a refused name turns red
        className={`${look} -mx-1 w-full border-0 bg-transparent px-1 outline-none aria-invalid:text-destructive`}
      />
      {error && (
        <p id="notebook-name-error" role="alert" className="mt-1 text-xs leading-[1.4] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
