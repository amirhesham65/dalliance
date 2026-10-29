import { AppWindow, ArrowLeft, Bot, type LucideIcon, SquareTerminal, Sparkles } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { Kbd } from '@/components/ui/kbd'
import { useEffect } from 'react'
import { SETTINGS_SECTIONS, type SettingsSection, actions, getApi, useNotebook } from '@/store/notebook-store'
import { AppsSettings } from './AppsSettings'
import { AgentSettings } from './AgentSettings'
import { ModelSettings } from './ModelSettings'
import { PythonSettings } from './PythonSettings'

const SECTIONS: Record<SettingsSection, { label: string; icon: LucideIcon }> = {
  models: { label: 'Models', icon: Sparkles },
  agent: { label: 'Agent', icon: Bot },
  python: { label: 'Python', icon: SquareTerminal },
  apps: { label: 'Apps', icon: AppWindow },
}

/**
 * Settings as its own screen: the sections down the left, the open one on the right. It covers the notebook or
 * the start page under the top bar without unmounting them, so their state is still there on the way back.
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
      if (target.closest('[role="listbox"], [role="menu"], [role="dialog"]')) return
      if (target.closest('input, textarea')) return target.blur()
      actions.closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!page || !settings || !api) return null
  return (
    <div className="absolute inset-0 z-10 flex bg-canvas px-2 pb-2">
      <Tabs.Root
        orientation="vertical"
        value={page}
        onValueChange={(v) => actions.openSettings(v as SettingsSection)}
        className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-pane"
      >
        <nav aria-label="Settings" className="flex w-56 shrink-0 flex-col gap-4 border-r p-3">
          <button
            type="button"
            onClick={() => actions.closeSettings()}
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground [&_svg]:size-3.5"
          >
            <ArrowLeft />
            Back
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
          <Tabs.Content value="models" className="mx-auto w-full max-w-[640px] px-10 py-10 outline-none">
            <ModelSettings api={api} settings={settings} />
          </Tabs.Content>
          <Tabs.Content value="agent" className="mx-auto w-full max-w-[640px] px-10 py-10 outline-none">
            <AgentSettings api={api} settings={settings} />
          </Tabs.Content>
          <Tabs.Content value="apps" className="mx-auto w-full max-w-[640px] px-10 py-10 outline-none">
            <AppsSettings api={api} settings={settings} />
          </Tabs.Content>
          <Tabs.Content value="python" className="mx-auto w-full max-w-[640px] px-10 py-10 outline-none">
            <PythonSettings api={api} settings={settings} />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  )
}
