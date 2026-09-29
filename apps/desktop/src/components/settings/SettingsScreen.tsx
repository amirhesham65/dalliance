import { Bot, type LucideIcon, SquareTerminal, Sparkles, UserRound, X } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { Kbd } from '@/components/ui/kbd'
import { useEffect } from 'react'
import { SETTINGS_SECTIONS, type SettingsSection, actions, getApi, useNotebook } from '@/store/notebook-store'
import { AccountSettings } from './AccountSettings'
import { AgentSettings } from './AgentSettings'
import { ModelSettings } from './ModelSettings'
import { PythonSettings } from './PythonSettings'

const SECTIONS: Record<SettingsSection, { label: string; icon: LucideIcon }> = {
  account: { label: 'Account', icon: UserRound },
  models: { label: 'Models', icon: Sparkles },
  agent: { label: 'Agent', icon: Bot },
  python: { label: 'Python', icon: SquareTerminal },
}

/**
 * Settings as a dialog over the window: the sections down the left, the open one on the right. The window behind
 * is blurred but stays mounted, so the notebook or the start page is as it was on the way back. The dialog is
 * always 3.3 parts in 4 of the window, and it doesn't move.
 */
export function SettingsScreen() {
  const page = useNotebook((s) => s.settingsPage)
  const settings = useNotebook((s) => s.settings)
  const api = getApi()

  useEffect(() => {
    // Land on the open section's tab, so the arrow keys move between sections straight away
    document.querySelector<HTMLElement>('[data-settings-tab][data-state="active"]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target as HTMLElement
      // Menus and selects close themselves first
      if (target.closest('[role="listbox"], [role="menu"], [role="dialog"]:not([data-settings-dialog])')) return
      if (target.closest('input, textarea')) return target.blur()
      actions.closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!page || !settings || !api) return null
  return (
    // Over the whole window, top bar included, which is why it opts out of the bar's drag region
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      data-settings-dialog
      className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[6px] animate-in duration-150 fade-in-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) actions.closeSettings()
      }}
    >
      <Tabs.Root
        orientation="vertical"
        value={page}
        onValueChange={(v) => actions.openSettings(v as SettingsSection)}
        className="flex h-[82.5%] w-[82.5%] overflow-hidden rounded-xl border bg-background shadow-2xl"
      >
        <nav aria-label="Settings" className="flex w-56 shrink-0 flex-col gap-4 border-r p-3">
          <button
            type="button"
            onClick={() => actions.closeSettings()}
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground [&_svg]:size-3.5"
          >
            <X />
            Close
            <Kbd className="ml-auto">Esc</Kbd>
          </button>
          <div className="flex flex-col gap-1">
            <h1 className="eyebrow px-2 pb-1">Settings</h1>
            <Tabs.List aria-label="Settings sections" className="flex flex-col gap-0.5">
              {SETTINGS_SECTIONS.map((id) => {
                const { label, icon: Icon } = SECTIONS[id]
                return (
                  <Tabs.Trigger
                    key={id}
                    value={id}
                    data-settings-tab
                    className="flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[13px] text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=active]:bg-hover data-[state=active]:font-medium data-[state=active]:text-foreground [&_svg]:size-3.5"
                  >
                    <Icon />
                    {label}
                  </Tabs.Trigger>
                )
              })}
            </Tabs.List>
          </div>
        </nav>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <Tabs.Content value="account" className="mx-auto w-full max-w-[640px] px-10 py-10 outline-none">
            <AccountSettings api={api} />
          </Tabs.Content>
          <Tabs.Content value="models" className="mx-auto w-full max-w-[640px] px-10 py-10 outline-none">
            <ModelSettings api={api} settings={settings} />
          </Tabs.Content>
          <Tabs.Content value="agent" className="mx-auto w-full max-w-[640px] px-10 py-10 outline-none">
            <AgentSettings api={api} settings={settings} />
          </Tabs.Content>
          <Tabs.Content value="python" className="mx-auto w-full max-w-[640px] px-10 py-10 outline-none">
            <PythonSettings api={api} settings={settings} />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  )
}
