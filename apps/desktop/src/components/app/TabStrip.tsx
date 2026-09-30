import { Plus, X } from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'
import type { TabInfo } from '@dalliance/shared/ipc'
import { cn } from '@/lib/utils'
import { getApi, useNotebook } from '@/store/notebook-store'
import { IconButton } from './IconButton'

/**
 * The window's notebooks, one tab each. The main process owns the list and every tab's page draws the same strip
 * from it. A click shows a tab, a middle click or its cross closes it, and + opens a new one on the start page.
 * Arrow keys move focus along the strip, and Enter or Space shows the focused tab.
 */
export function TabStrip({ mod }: { mod: string }) {
  const state = useNotebook((s) => s.tabs)
  const onboarding = useNotebook((s) => s.settings?.onboarded === false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const refs = useRef(new Map<string, HTMLDivElement>())
  const api = getApi()
  if (!state?.tabs.length || onboarding || !api) return null
  const { tabs, activeId } = state
  // One tab takes Tab focus at a time: the one the arrow keys last moved to, or the one showing
  const current = tabs.some((t) => t.id === focusedId) ? focusedId : activeId

  const move = (from: string, step: number | 'first' | 'last') => {
    const i = tabs.findIndex((t) => t.id === from)
    const next = step === 'first' ? tabs[0] : step === 'last' ? tabs[tabs.length - 1] : tabs[(i + step + tabs.length) % tabs.length]
    setFocusedId(next.id)
    refs.current.get(next.id)?.focus()
  }

  const onKey = (e: KeyboardEvent, tab: TabInfo) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(tab.id, 1),
      ArrowLeft: () => move(tab.id, -1),
      Home: () => move(tab.id, 'first'),
      End: () => move(tab.id, 'last'),
      Enter: () => void api.switchTab(tab.id),
      ' ': () => void api.switchTab(tab.id),
      Delete: () => void api.closeTab(tab.id),
    }
    const act = keys[e.key]
    if (!act) return
    e.preventDefault()
    act()
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div role="tablist" aria-label="Notebooks" className="app-no-drag flex min-w-0 items-center gap-1 overflow-x-auto p-0.5 [scrollbar-width:none]">
        {tabs.map((tab) => {
          const active = tab.id === activeId
          return (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el)
                else refs.current.delete(tab.id)
              }}
              role="tab"
              aria-selected={active}
              // Named here, so the close button inside doesn't join the name. The dots say the same on screen.
              aria-label={`${tab.title}${tab.dirty ? ', unsaved changes' : ''}${tab.running ? ', running' : ''}`}
              tabIndex={tab.id === current ? 0 : -1}
              title={tab.path ?? tab.title}
              onClick={() => {
                if (!active) void api.switchTab(tab.id)
              }}
              // A middle click closes, as in a browser. Holding the button down would start autoscroll.
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault()
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                void api.closeTab(tab.id)
              }}
              onKeyDown={(e) => onKey(e, tab)}
              onFocus={() => setFocusedId(tab.id)}
              className={cn(
                'group relative flex h-8 min-w-[88px] max-w-[220px] cursor-default items-center gap-1.5 rounded-lg border pr-1 pl-3 outline-none select-none',
                'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                active ? 'bg-background text-foreground shadow-pane' : 'border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
            >
              {tab.running && <span className="size-1.5 shrink-0 rounded-full bg-go pulse" data-testid="tab-running" aria-hidden="true" />}
              <span className={cn('min-w-0 flex-1 truncate', active && 'font-medium')}>{tab.title}</span>
              {tab.dirty && <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" data-testid="tab-dirty" aria-hidden="true" />}
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Close ${tab.title}`}
                title={`Close ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void api.closeTab(tab.id)
                }}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-foreground [&_svg]:size-3',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                )}
              >
                <X />
              </button>
            </div>
          )
        })}
      </div>
      <IconButton label="New tab" shortcut={`${mod}T`} className="app-no-drag" onClick={() => void api.newTab()}>
        <Plus />
      </IconButton>
    </div>
  )
}
