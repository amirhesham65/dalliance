import { ChevronRight, File, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry } from '@dalliance/shared/ipc'
import { cn } from '@/lib/utils'
import { actions, getApi } from '@/store/notebook-store'

type Directory = { entries: FileEntry[]; error?: false } | { error: true }
interface Row {
  entry: FileEntry
  depth: number
  parent: string | null
  position: number
  siblings: number
}
const ROW_HEIGHT = 32
const OVERSCAN = 6
const EMPTY_DIRECTORIES = new Map<string, Directory>()

/** Load children on expansion and mount only the visible rows of a large tree. */
export function FileTree({ files }: { files: FileEntry[] }) {
  const [expanded, setExpanded] = useState(() => new Set<string>())
  const [loaded, setLoaded] = useState(() => ({ source: files, directories: new Map<string, Directory>() }))
  const directories = loaded.source === files ? loaded.directories : EMPTY_DIRECTORIES
  const [active, setActive] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)
  const requests = useRef({ live: true, pending: new Set<string>() })
  const viewport = useRef<HTMLDivElement>(null)
  const tree = useRef<HTMLUListElement>(null)
  const id = useId()

  // Refresh loaded children too, discarding replies from the previous listing.
  useEffect(() => {
    const request = { live: true, pending: new Set<string>() }
    requests.current = request
    return () => { request.live = false }
  }, [files])

  useEffect(() => {
    const request = requests.current
    const entries = [...files]
    for (const entry of entries) {
      const directory = entry.path
      if (entry.kind !== 'directory' || !expanded.has(directory)) continue
      const cached = directories.get(directory)
      if (cached) {
        if (!cached.error) entries.push(...cached.entries)
        continue
      }
      if (request.pending.has(directory)) continue
      request.pending.add(directory)
      const remember = (value: Directory) => {
        if (request.live) setLoaded((current) => ({
          source: files,
          directories: new Map(current.source === files ? current.directories : EMPTY_DIRECTORIES).set(directory, value),
        }))
      }
      void (getApi()?.listFiles(directory) ?? Promise.resolve([]))
        .then((entries) => remember({ entries }))
        .catch(() => remember({ error: true }))
        .finally(() => request.pending.delete(directory))
    }
  }, [expanded, directories, files])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => setHeight(element.clientHeight || 480)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const rows = useMemo(() => {
    const rows: Row[] = []
    const append = (entries: FileEntry[], depth: number, parent: string | null) => {
      const sorted = [...entries].sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.path.localeCompare(b.path))
      sorted.forEach((entry, index) => {
        rows.push({ entry, depth, parent, position: index + 1, siblings: sorted.length })
        const children = directories.get(entry.path)
        if (entry.kind === 'directory' && expanded.has(entry.path) && children && !children.error) append(children.entries, depth + 1, entry.path)
      })
    }
    append(files, 0, null)
    return rows
  }, [files, expanded, directories])
  const activeIndex = Math.max(0, rows.findIndex((row) => row.entry.path === active))
  const virtual = rows.length > 100
  const offset = Math.min(scrollTop, Math.max(0, rows.length * ROW_HEIGHT - height))
  const start = virtual ? Math.max(0, Math.floor(offset / ROW_HEIGHT) - OVERSCAN) : 0
  const end = virtual ? Math.min(rows.length, Math.ceil((offset + height) / ROW_HEIGHT) + OVERSCAN) : rows.length
  const visible = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index)
  // The active descendant must stay mounted when the user scrolls it out of view.
  if (rows.length && (activeIndex < start || activeIndex >= end)) visible.push(activeIndex)

  const select = (index: number) => {
    const row = rows[index]
    const element = viewport.current
    if (!row || !element) return
    setActive(row.entry.path)
    const top = index * ROW_HEIGHT
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_HEIGHT > element.scrollTop + height) element.scrollTop = top + ROW_HEIGHT - height
    setScrollTop(element.scrollTop)
  }
  const toggle = (entry: FileEntry) => {
    if (entry.kind !== 'directory') {
      void getApi()?.revealFile(entry.path).catch((error: unknown) => actions.notifyFailure("Couldn't show the file", error))
      return
    }
    if (expanded.has(entry.path) && directories.get(entry.path)?.error) {
      setLoaded((current) => {
        const next = new Map(current.source === files ? current.directories : EMPTY_DIRECTORIES)
        next.delete(entry.path)
        return { source: files, directories: next }
      })
      return
    }
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const row = rows[activeIndex]
    if (!row) return
    switch (event.key) {
      case 'ArrowDown': select(Math.min(rows.length - 1, activeIndex + 1)); break
      case 'ArrowUp': select(Math.max(0, activeIndex - 1)); break
      case 'Home': select(0); break
      case 'End': select(rows.length - 1); break
      case 'ArrowRight':
        if (row.entry.kind !== 'directory') return
        if (!expanded.has(row.entry.path)) toggle(row.entry)
        else if (rows[activeIndex + 1]?.parent === row.entry.path) select(activeIndex + 1)
        break
      case 'ArrowLeft':
        if (expanded.has(row.entry.path)) setExpanded((current) => { const next = new Set(current); next.delete(row.entry.path); return next })
        else if (row.parent) select(rows.findIndex((item) => item.entry.path === row.parent))
        break
      case 'Enter': toggle(row.entry); break
      case ' ': if (row.entry.kind === 'directory') toggle(row.entry); break
      default: return
    }
    event.preventDefault()
  }

  return (
    <div ref={viewport} className="scrollbar-thin h-full overflow-y-auto px-2 pb-3" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <ul ref={tree} role="tree" aria-label="Workspace files" tabIndex={0} aria-activedescendant={rows.length ? `${id}-${activeIndex}` : undefined} onKeyDown={onKeyDown} className="group/tree relative outline-none" style={{ height: rows.length * ROW_HEIGHT }}>
        {visible.map((index) => {
          const { entry, depth, position, siblings } = rows[index]
          const folder = entry.kind === 'directory'
          const open = expanded.has(entry.path)
          const children = directories.get(entry.path)
          const Icon = folder ? open ? FolderOpen : Folder : File
          const name = entry.path.split('/').at(-1) ?? entry.path
          const fileManager = getApi()?.platform === 'darwin' ? 'Finder' : getApi()?.platform === 'win32' ? 'File Explorer' : 'file manager'
          const loading = folder && open && !children
          const status = folder && open && children ? children.error ? "Couldn't read folder. Click to retry." : !children.entries.length ? 'Empty' : null : null
          return (
            <li key={entry.path} id={`${id}-${index}`} role="treeitem" aria-level={depth + 1} aria-posinset={position} aria-setsize={siblings} aria-expanded={folder ? open : undefined} aria-selected={active === entry.path} aria-busy={folder && open && !children || undefined} aria-label={name} className="absolute right-0 left-0" style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}>
              <button type="button" tabIndex={-1} aria-label={name} aria-expanded={folder ? open : undefined} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { select(index); tree.current?.focus({ preventScroll: true }); if (folder && event.detail < 2) toggle(entry) }} onDoubleClick={() => { if (!folder) toggle(entry) }} title={folder ? entry.path : `${entry.path}\nDouble-click to show in ${fileManager}`} className={cn('flex h-8 w-full items-center gap-2 rounded-lg pr-2 text-left text-[13px] hover:bg-hover', active === entry.path && 'bg-hover', activeIndex === index && 'group-focus-visible/tree:bg-hover group-focus-visible/tree:ring-1 group-focus-visible/tree:ring-inset group-focus-visible/tree:ring-ring')} style={{ paddingLeft: 8 + depth * 16 + (folder ? 0 : 20) }}>
                {folder && <ChevronRight className={cn('size-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />}
                <Icon className="size-3.5 shrink-0 text-faint" />
                <span className="truncate">{name}</span>
                <span className="ml-auto truncate text-[11.5px] text-faint tabular-nums" title={status ?? undefined}>{loading ? <FolderLoading /> : status ?? entry.size}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Fast local reads should not flash a loading control. */
function FolderLoading() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 200)
    return () => window.clearTimeout(timer)
  }, [])
  return visible ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3 shrink-0 animate-spin" />Loading…</span> : null
}
