import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { FileEntry } from '@dalliance/shared/ipc'
import { cn } from '@/lib/utils'

interface FolderNode {
  name: string
  path: string
  folders: Map<string, FolderNode>
  files: FileEntry[]
}

/** Keep full paths for loading, and show each folder and filename once. */
export function FileTree({ files, onLoad }: { files: FileEntry[]; onLoad: (path: string) => void }) {
  const root = useMemo(() => {
    const root: FolderNode = { name: '', path: '', folders: new Map(), files: [] }
    for (const file of files) {
      const parts = file.path.split(/[\\/]/)
      let parent = root
      for (const name of parts.slice(0, -1)) {
        if (!parent.folders.has(name)) {
          parent.folders.set(name, { name, path: `${parent.path}${name}/`, folders: new Map(), files: [] })
        }
        parent = parent.folders.get(name)!
      }
      parent.files.push(file)
    }
    return root
  }, [files])
  return <ul aria-label="Workspace files" className="px-2 pb-3"><FolderContents folder={root} onLoad={onLoad} /></ul>
}

function FolderContents({ folder, onLoad }: { folder: FolderNode; onLoad: (path: string) => void }) {
  return (
    <>
      {[...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => (
        <FolderBranch key={child.path} folder={child} onLoad={onLoad} />
      ))}
      {[...folder.files].sort((a, b) => a.path.localeCompare(b.path)).map((file) => (
        <li key={file.path}>
          <button type="button" onClick={() => onLoad(file.path)} title={`Start a cell that loads ${file.path}`} className="flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 pl-7 text-left text-[13px] hover:bg-hover">
            <File className="size-3.5 shrink-0 text-faint" />
            <span className="truncate">{file.path.split(/[\\/]/).at(-1)}</span>
            <span className="ml-auto shrink-0 text-[11.5px] text-faint tabular-nums">{file.size}</span>
          </button>
        </li>
      ))}
    </>
  )
}

function FolderBranch({ folder, onLoad }: { folder: FolderNode; onLoad: (path: string) => void }) {
  const [open, setOpen] = useState(true)
  const id = useId()
  const Icon = open ? FolderOpen : Folder
  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)} title={folder.path} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover">
        <ChevronRight className={cn('size-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        <Icon className="size-3.5 shrink-0 text-faint" />
        <span className="truncate">{folder.name}</span>
      </button>
      <ul id={id} hidden={!open} className="ml-[15px] border-l border-border pl-1">
        <FolderContents folder={folder} onLoad={onLoad} />
      </ul>
    </li>
  )
}
