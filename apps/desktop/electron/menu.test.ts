// @vitest-environment node
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

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

describe('the View menu', () => {
  it('names each pane the way the overview does, with the key the renderer handles', () => {
    buildMenu(() => {})
    const view = built.at(-1)!.find((m) => m.label === 'View')!
    const panes = (view.submenu as MenuItemConstructorOptions[])
      .filter((i) => typeof i.accelerator === 'string' && /CmdOrCtrl\+\d/.test(i.accelerator))
      .map((i) => [i.label, i.accelerator, i.registerAccelerator])
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

describe('the Kernel menu', () => {
  it('offers Verify, which the renderer confirms before it restarts anything', () => {
    const sent: string[] = []
    buildMenu((action) => sent.push(action))
    const kernel = built.at(-1)!.find((m) => m.label === 'Kernel')!
    const verify = (kernel.submenu as MenuItemConstructorOptions[]).find((i) => i.label === 'Verify Notebook…')!
    ;(verify.click as () => void)()
    expect(sent).toEqual(['verify'])
  })
})
