import { Folder } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { actions, getApi, useNotebook, welcomeNotebook } from '@/store/notebook-store'

/** New project: a name and a place. The main process makes the folder and the first notebook in it, and opens it. */
export function NewProjectDialog() {
  const open = useNotebook((s) => s.newProject)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && actions.closeNewProject()}>
      {/* minmax(0, 1fr): a long name in the one-line path below would otherwise widen the column past the dialog */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md">
        {/* Only mounted while open, so each time starts from an empty name */}
        <NewProjectForm />
      </DialogContent>
    </Dialog>
  )
}

function NewProjectForm() {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const api = getApi()

  useEffect(() => {
    void api?.projectsFolder().then(setFolder)
  }, [api])

  const choose = async () => {
    const chosen = await api?.chooseProjectsFolder()
    if (chosen) {
      setFolder(chosen)
      setError(null)
    }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!api || creating || !name.trim()) return
    // Ask about unsaved changes before anything is made on disk
    if (!(await api.confirmDiscard())) return
    setCreating(true)
    try {
      const result = await api.createProject(name, welcomeNotebook())
      if ('error' in result) return setError(result.error)
      actions.closeNewProject()
      actions.load(result.notebook, result.path)
    } catch (err) {
      setError(`Couldn't create the project: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCreating(false)
    }
  }

  const where = folder ? homeRelative(folder) : ''
  const sep = folder?.includes('\\') ? '\\' : '/'
  return (
    <form onSubmit={(e) => void create(e)} className="contents">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>A folder of its own for the notebooks, the data and the brief. The agent works inside it.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-name" className="text-[13px] font-medium">
          Name
        </label>
        <Input
          id="project-name"
          autoFocus
          placeholder="Diabetes readmissions"
          value={name}
          readOnly={creating}
          aria-invalid={error != null}
          aria-describedby={error ? 'project-error' : undefined}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
        {error && (
          <p id="project-error" role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Location</span>
        <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
          <Folder className="size-3.5 shrink-0 text-faint" />
          {/* The parent folder gives way first, so the name being typed stays in view */}
          <span className="flex min-w-0 flex-1 text-[13px] text-muted-foreground" title={folder ?? undefined}>
            <span className="min-w-0 truncate">{where}</span>
            {name.trim() && (
              <span className="min-w-0 max-w-[70%] shrink-0 truncate text-foreground">
                {sep}
                {name.trim()}
              </span>
            )}
          </span>
          <Button type="button" size="xs" variant="ghost" onClick={() => void choose()} disabled={creating}>
            Change…
          </Button>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => actions.closeNewProject()}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || creating}>
          {creating ? 'Creating…' : 'Create project'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** A path with the home folder written as ~, for showing. The renderer doesn't know the home folder, so it's guessed. */
const homeRelative = (dir: string) => dir.replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, '~').replace(/^[A-Z]:\\Users\\[^\\]+(?=\\|$)/i, '~')
