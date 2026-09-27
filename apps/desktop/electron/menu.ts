import { Menu, type MenuItemConstructorOptions, app } from 'electron'
import type { MenuAction } from '@dalliance/shared/ipc'

export function buildMenu(send: (action: MenuAction) => void) {
  const isMac = process.platform === 'darwin'
  const item = (label: string, action: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(action),
  })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              item('Settings…', 'settings', 'CmdOrCtrl+,'),
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('New Notebook', 'new', 'CmdOrCtrl+N'),
        item('Open…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'save-as', 'Shift+CmdOrCtrl+S'),
        ...(isMac ? [] : [{ type: 'separator' } as const, item('Settings…', 'settings', 'Ctrl+,'), { role: 'quit' } as const]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Cell',
      submenu: [
        item('Run Cell', 'run-cell'),
        item('Run All', 'run-all', 'Shift+CmdOrCtrl+Enter'),
        { type: 'separator' },
        item('Add Prompt Cell', 'add-prompt'),
        item('Add Note Cell', 'add-note'),
      ],
    },
    {
      label: 'Kernel',
      submenu: [item('Interrupt', 'interrupt', 'CmdOrCtrl+.'), item('Restart', 'restart')],
    },
    {
      label: 'View',
      submenu: [
        // The renderer handles these keys itself, so the menu only shows them
        { ...item('Toggle Overview', 'toggle-sidebar', 'CmdOrCtrl+B'), registerAccelerator: false },
        { type: 'separator' },
        { ...item('Brief', 'pane-brief', 'CmdOrCtrl+1'), registerAccelerator: false },
        { ...item('Variables', 'pane-variables', 'CmdOrCtrl+2'), registerAccelerator: false },
        { ...item('History', 'pane-history', 'CmdOrCtrl+3'), registerAccelerator: false },
        { ...item('Files', 'pane-files', 'CmdOrCtrl+4'), registerAccelerator: false },
        { ...item('Pinned', 'pane-pinned', 'CmdOrCtrl+5'), registerAccelerator: false },
        { ...item('Activity', 'pane-activity', 'CmdOrCtrl+6'), registerAccelerator: false },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [item('Welcome to Dalliance', 'welcome')] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
