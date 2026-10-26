import { App, BrowserWindow, Menu } from 'electron'
import { i18n } from 'i18next'
import { rendererRequest } from './electron-communication.js'
import { getEnvironment } from './electron-utils.js'
import { closeWindow, executeHardReset, handleMenuCommand } from './electron.js'

function generateMenu(app: App, mainWindow: BrowserWindow, i18n: i18n) {
  const viewElements: Electron.MenuItemConstructorOptions['submenu'] = [
    {
      label: i18n.t('Electron.Menu.view.reload'),
      accelerator: 'CmdOrCtrl+R',
      click: () => {
        handleMenuCommand({ key: 'view-reload' })
      },
    },
  ]

  if (getEnvironment() === 'development' || getEnvironment() === 'staging') {
    viewElements.push({
      label: 'Reload (hard)',
      accelerator: 'Alt+CmdOrCtrl+R',
      click: () => {
        executeHardReset()
      },
    })
  }

  viewElements.push(
    { role: 'togglefullscreen' },
    {
      role: 'minimize',
    },
    { type: 'separator' },

    // { role: 'zoomIn' },
    // { role: 'zoomOut' },
    // { role: 'resetZoom' }
    {
      label: i18n.t('Electron.Menu.view.resetZoom'),
      accelerator: 'CmdOrCtrl+O',
      click: () => {
        handleMenuCommand({ key: 'view-resetZoom' })
      },
    },
    {
      label: i18n.t('Electron.Menu.view.zoomOut'),
      accelerator: 'CmdOrCtrl+-',
      click: () => {
        handleMenuCommand({ key: 'view-zoomOut' })
      },
    },
    {
      label: i18n.t('Electron.Menu.view.zoomIn'),
      accelerator: 'CmdOrCtrl+Plus',
      click: () => {
        handleMenuCommand({ key: 'view-zoomIn' })
      },
    }
  )

  viewElements.push(
    {
      type: 'separator',
    },
    {
      label: i18n.t('Electron.Menu.view.devTools'),
      accelerator: 'Alt+CmdOrCtrl+I',
      click: () => {
        mainWindow?.webContents.toggleDevTools()
      },
    }
  )

  const appMenu: Electron.MenuItemConstructorOptions =
    process.platform === 'darwin'
      ? {
          label: app.name,
          submenu: [
            {
              role: 'about',
            },
            {
              type: 'separator',
            },
            {
              label: i18n.t('Electron.Menu.capacities.preferences'),
              accelerator: 'CmdOrCtrl+,',
              click: () => {
                rendererRequest(mainWindow, 'openSettings', undefined)
              },
            },
            {
              type: 'separator',
            },
            { role: 'services' },
            {
              type: 'separator',
            },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            {
              type: 'separator',
            },
            {
              role: 'quit',
              click: () => {
                closeWindow()
              },
            },
          ],
        }
      : {
          label: i18n.t('Electron.Menu.capacities.name'),
          submenu: [
            {
              role: 'about',
            },
            {
              type: 'separator',
            },
            {
              label: i18n.t('Electron.Menu.capacities.settings'),
              accelerator: 'CmdOrCtrl+,',
              click: () => {
                handleMenuCommand({ key: 'app-settings' })
              },
            },
            { role: 'hide' },
            {
              type: 'separator',
            },
            {
              role: 'quit',
              click: () => {
                handleMenuCommand({ key: 'app-quit' })
              },
            },
          ],
        }

  const menu: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [
    appMenu,
    {
      label: i18n.t('Electron.Menu.edit.main'),
      submenu: [
        {
          label: i18n.t('Electron.Menu.edit.undo'),
          accelerator: 'CmdOrCtrl+Z',
          click: () => {
            handleMenuCommand({ key: 'edit-undo' })
          },
        },
        {
          label: i18n.t('Electron.Menu.edit.redo'),
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => {
            handleMenuCommand({ key: 'edit-redo' })
          },
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        // { role: 'selectAll' },
      ],
    },
    {
      label: i18n.t('Electron.Menu.view.main'),
      submenu: viewElements,
    },
    {
      label: i18n.t('Electron.Menu.help.main'),
      submenu: [
        {
          label: i18n.t('Electron.Menu.help.learn'),
          click: () => {
            handleMenuCommand({ key: 'help-learn' })
          },
        },
      ],
    },
  ]
  return menu
}

export function buildMenu(app: App, mainWindow: BrowserWindow, i18n: i18n) {
  const menu = Menu.buildFromTemplate(
    generateMenu(app, mainWindow, i18n) as (Electron.MenuItemConstructorOptions | Electron.MenuItem)[]
  )
  if (process.platform === 'darwin') Menu.setApplicationMenu(menu)
  else if (process.platform === 'win32' || process.platform === 'linux') mainWindow.removeMenu()
  else mainWindow.setMenu(menu)
}
