// @vitest-environment node
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { MenuAction } from '@dalliance/shared/ipc'

const built: MenuItemConstructorOptions[][] = []
vi.mock('electron', () => ({
  app: { name: 'Dalliance' },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.push(template)
      return template
    },
    setApplicationMenu: () => {},
  },
}))

const { buildMenu } = await import('./menu')

function menu(recent: { path: string; name: string }[] = []) {
  const sent: MenuAction[] = []
  const commands: string[] = []
  const opened: string[] = []
  buildMenu({ send: (a) => sent.push(a), tab: (c) => commands.push(c), openRecent: (p) => opened.push(p), recent })
  const top = (label: string) => built.at(-1)!.find((m) => m.label === label)!.submenu as MenuItemConstructorOptions[]
  const click = (i: MenuItemConstructorOptions) => (i.click as () => void)()
  return { top, click, sent, commands, opened }
}

const keys = (items: MenuItemConstructorOptions[]) => items.filter((i) => i.accelerator).map((i) => [i.label, i.accelerator, i.visible ?? true])

describe('the View menu', () => {
  it('names each pane the way the overview does, with the key the renderer handles', () => {
    const view = menu().top('View')
    const panes = view.filter((i) => typeof i.accelerator === 'string' && /CmdOrCtrl\+\d/.test(i.accelerator)).map((i) => [i.label, i.accelerator, i.registerAccelerator])
    expect(panes).toEqual([
      ['Brief', 'CmdOrCtrl+1', false],
      ['Variables & Environment', 'CmdOrCtrl+2', false],
      ['History', 'CmdOrCtrl+3', false],
      ['Files', 'CmdOrCtrl+4', false],
      ['Pinned', 'CmdOrCtrl+5', false],
      ['Activity', 'CmdOrCtrl+6', false],
    ])
  })
})

describe('tabs in the menu', () => {
  it('opens and closes tabs from the File menu, in the main process', () => {
    const { top, click, commands, sent } = menu()
    const file = top('File')
    expect(keys(file)).toEqual(
      expect.arrayContaining([
        ['New Tab', 'CmdOrCtrl+T', true],
        ['New Notebook', 'CmdOrCtrl+N', true],
        ['Close Tab', 'CmdOrCtrl+W', true],
        ['Close Window', 'Shift+CmdOrCtrl+W', true],
      ]),
    )
    click(file.find((i) => i.label === 'New Tab')!)
    click(file.find((i) => i.label === 'Close Tab')!)
    click(file.find((i) => i.label === 'New Notebook')!)
    expect(commands).toEqual(['new-tab', 'close-tab'])
    expect(sent).toEqual(['new'])
  })

  it('moves between tabs with Ctrl+Tab and with Cmd+Shift+[ and ], never with number keys', () => {
    const { top, click, commands } = menu()
    const window = top('Window')
    expect(keys(window)).toEqual([
      ['Show Previous Tab', 'Ctrl+Shift+Tab', true],
      ['Show Next Tab', 'Ctrl+Tab', true],
      ['Show Previous Tab', 'Shift+CmdOrCtrl+[', false],
      ['Show Next Tab', 'Shift+CmdOrCtrl+]', false],
    ])
    expect(window.filter((i) => i.visible === false).every((i) => i.acceleratorWorksWhenHidden)).toBe(true)
    for (const i of window.filter((i) => i.accelerator)) click(i)
    expect(commands).toEqual(['previous-tab', 'next-tab', 'previous-tab', 'next-tab'])
  })

  it('lists recent notebooks under Open Recent', () => {
    const { top, click, opened } = menu([
      { path: '/work/sales.ipynb', name: 'sales' },
      { path: '/work/trial.ipynb', name: 'trial' },
    ])
    const recent = top('File').find((i) => i.label === 'Open Recent')!.submenu as MenuItemConstructorOptions[]
    expect(recent.map((i) => i.label)).toEqual(['sales', 'trial'])
    click(recent[1])
    expect(opened).toEqual(['/work/trial.ipynb'])

    const empty = menu().top('File').find((i) => i.label === 'Open Recent')!.submenu as MenuItemConstructorOptions[]
    expect(empty).toEqual([{ label: 'No recent notebooks', enabled: false }])
  })

  it('leaves no accelerator used twice', () => {
    const { top } = menu()
    const all = ['File', 'Edit', 'Cell', 'Kernel', 'View', 'Window'].flatMap((m) => top(m)).map((i) => i.accelerator).filter(Boolean)
    expect(new Set(all).size).toBe(all.length)
  })
})
