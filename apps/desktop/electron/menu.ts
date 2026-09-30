import { Menu, type MenuItemConstructorOptions, app } from 'electron'
import type { MenuAction } from '@dalliance/shared/ipc'

/** Menu items the main process handles itself, since they act on the window's tabs rather than one page. */
export type TabCommand = 'new-tab' | 'close-tab' | 'next-tab' | 'previous-tab' | 'close-window'

export interface MenuHandlers {
  /** Sends a menu action to the page of the tab that is showing. */
  send: (action: MenuAction) => void
  tab: (command: TabCommand) => void
  openRecent: (path: string) => void
  /** Open Recent's items, newest first. */
  recent: { path: string; name: string }[]
}

export function buildMenu({ send, tab, openRecent, recent }: MenuHandlers) {
  const isMac = process.platform === 'darwin'
  const item = (label: string, action: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(action),
  })
  const tabItem = (label: string, command: TabCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => tab(command),
  })
  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? recent.map((r) => ({ label: r.name, toolTip: r.path, click: () => openRecent(r.path) }))
    : [{ label: 'No recent notebooks', enabled: false }]

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
        tabItem('New Tab', 'new-tab', 'CmdOrCtrl+T'),
        item('New Notebook', 'new', 'CmdOrCtrl+N'),
        item('Open…', 'open', 'CmdOrCtrl+O'),
        item('Open Folder…', 'open-folder', 'Shift+CmdOrCtrl+O'),
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'save-as', 'Shift+CmdOrCtrl+S'),
        { type: 'separator' },
        tabItem('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
        tabItem('Close Window', 'close-window', 'Shift+CmdOrCtrl+W'),
        ...(isMac ? [] : [{ type: 'separator' } as const, item('Settings…', 'settings', 'Ctrl+,'), { role: 'quit' } as const]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // Not the built-in roles: the renderer decides. A focused text field gets its own undo, anything else
        // undoes the last notebook edit
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', 'Shift+CmdOrCtrl+Z'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' } as const, { role: 'delete' } as const] : [{ role: 'delete' } as const, { type: 'separator' } as const]),
        { role: 'selectAll' },
      ],
    },
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
        { ...item('Variables & Environment', 'pane-variables', 'CmdOrCtrl+2'), registerAccelerator: false },
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
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' } as const] : []),
        { type: 'separator' },
        tabItem('Show Previous Tab', 'previous-tab', 'Ctrl+Shift+Tab'),
        tabItem('Show Next Tab', 'next-tab', 'Ctrl+Tab'),
        // The same with the keys Safari and Chrome also take. Hidden, but their keys still work
        { ...tabItem('Show Previous Tab', 'previous-tab', 'Shift+CmdOrCtrl+['), visible: false, acceleratorWorksWhenHidden: true },
        { ...tabItem('Show Next Tab', 'next-tab', 'Shift+CmdOrCtrl+]'), visible: false, acceleratorWorksWhenHidden: true },
        ...(isMac ? [{ type: 'separator' } as const, { role: 'front' } as const] : []),
      ],
    },
    { role: 'help', submenu: [item('Welcome to Dalliance', 'welcome')] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
