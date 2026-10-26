import dotenv from 'dotenv'
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  Event,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from 'electron'
import contextMenu from 'electron-context-menu'
import { download } from 'electron-dl'
import log from 'electron-log'
import electronUpdater from 'electron-updater'
import windowStateKeeper from 'electron-window-state'
import fs from 'fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runAppleScript } from 'run-applescript'
import { buildMenu } from './electron-menu.js'
import i18n from './i18n/i18next.config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

if (process.env.NODE_ENV === 'development') dotenv.config({ path: `.env.development` })
else dotenv.config({ path: path.join(__dirname, './../.env') })
const { autoUpdater } = electronUpdater

// ---------------------------------------------------------
// !! needs to be before internal imports
if (process.env.NODE_ENV === 'development')
  app.setPath('userData', `${process.env.LOCAL_BASE_PATH}/capacities-electron-dev/`)
// ---------------------------------------------------------
import { lstatSync } from 'node:fs'
import { ElectronCommunicationRendererToMainRequest } from '../electron-shared/electron-communication.model.js'
import type { ActionQueueElementResponseWorkerDto } from '../shared-logic/models/api/actionQueue.api.js'
import { InAppState } from '../shared-logic/models/general.model.js'
import type { ThemeKey } from '../shared-logic/models/themeOptions.js'
import { getFileNameParts } from '../shared-logic/util/fileUploaderBackbone.js'
import { getUrlInformation } from '../shared-logic/util/mediaProcessing.js'
import { oklchToRgb } from '../shared-ui/styles/colors.js'
import { themes } from '../shared-ui/styles/themes.js'
import { embedAllowWindowRedirectTo } from '../shared-ui/utils/mediaConfig.js'
import { rendererRequest } from './electron-communication.js'
import { useExportHandling } from './electron-export.js'
import { hmr } from './electron-hmr.js'
import { useMediaHandling } from './electron-media.js'
import { settings, setZoomLevel } from './electron-settings.js'
import { setupWebResourceBrowserSecurity, setupWebResourceBrowserSession } from './electron-web-resource-browser.js'
import {
  getBaseUrl,
  getEnvironment,
  getFormattedFileSize,
  getWebAppPath,
  isInternalUrl,
  reportError,
  getPathFromFileURL,
  sanitizeFileName,
  setInAppState,
} from './electron-utils.js'
import { handleXCallback } from './electron-xcallback.js'
import { useStore } from '../composables/useStore.js'
import { NodeEncrypter } from './electron-encrypter.js'
import { ElectronStorage } from './electron-storage.js'
import { z } from 'zod'

const DIST_PATH = path.normalize(path.resolve(__dirname, '../../dist'))
const MAXIMUM_TITLE_DISPLAY_LENGTH = 50

// ---------------------------------------------------------
// LOGGER
if (getEnvironment() === 'staging') {
  // log.transports.remote.level = 'silly'
  // log.transports.remote.url = 'http://localhost:4001/admin/log'
  log.transports.file.level = 'silly'
  const logPath = path.join(app.getPath('userData'), '/main.logs') as string
  log.transports.file.resolvePath = () => logPath
}
if (getEnvironment() !== 'development') {
  log.transports.console.level = false
}

log.errorHandler.startCatching({
  showDialog: false,
  onError: (e) => {
    reportError(e.error)
  },
})

// globally overwrites console functions with log functions
Object.assign(console, log.functions)

if (getEnvironment() !== 'development') {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        allowServiceWorkers: true,
        corsEnabled: true,
        bypassCSP: true,
        stream: true,
      },
    },
  ])
}

// // ERROR HANDLING AND LOGGING
// Sentry.init({
//   dsn: 'https://040322195213467790fcd1a19dc481ca@o406520.ingest.sentry.io/4503897176670208',
//   environment: getElectronEnvironment() === 'development' ? 'development' : 'production',
//   ignoreErrors: errorFilters,
//   tracesSampleRate: 1.0,
// })

// ---------------------------------------------------------
// set download folder in dev otherwise would end up in root directory
if (getEnvironment() === 'development') app.setPath('downloads', `${process.env.LOCAL_BASE_PATH}/Downloads`)

process.env.ELECTRON_ENABLE_SECURITY_WARNINGS = getEnvironment() === 'development' ? 'true' : 'false'

/** Desktop menu row: `--el-h-sm` (1.75rem) + 0.25rem. Keep in sync with `--windows-menu-title-bar-height`. */
export const WINDOWS_TITLE_BAR_HEIGHT = 32

export let loadingPath: string | undefined = undefined
// let tray: Tray | undefined = undefined
export let mainWindow: BrowserWindow | undefined = undefined

export const { store } = useStore(
  'general',
  z
    .object({
      trustedFilePaths: z.set(z.string()).default(new Set()),
    })
    .default({
      trustedFilePaths: new Set(),
    }),
  {
    storage: new ElectronStorage(),
    // The encryption is only being used to obfuscate the data, not to secure it.
    encrypter: new NodeEncrypter('5d41402abc4b2a76b9719d911017c592'),
  },
  true
)

function getSystemAudioLoopbackFeatures(): string[] {
  if (process.platform === 'darwin') {
    return ['MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride']
  }

  if (process.platform === 'linux') {
    return ['PulseaudioLoopbackForScreenShare']
  }

  return []
}

function enableSystemAudioLoopbackFeatures() {
  const platformFeatures = getSystemAudioLoopbackFeatures()
  if (!platformFeatures.length) return

  const existingFeatures = app.commandLine
    .getSwitchValue('enable-features')
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean)

  const features = new Set([...existingFeatures, ...platformFeatures])
  if (app.commandLine.hasSwitch('enable-features')) app.commandLine.removeSwitch('enable-features')
  app.commandLine.appendSwitch('enable-features', [...features].join(','))
}

function enableLinuxCompatFlags() {
  if (process.platform !== 'linux') return

  if (!app.commandLine.hasSwitch('disable-dev-shm-usage')) {
    app.commandLine.appendSwitch('disable-dev-shm-usage')
  }
}

enableSystemAudioLoopbackFeatures()
enableLinuxCompatFlags()

// electron reload for dev
if (getEnvironment() === 'development') {
  hmr(
    {
      paths: ['./src/**/*'],
      ignore: ['./src/electron/**/*'],
    },
    {
      paths: ['./src/electron/**/*'],
    }
  )
}

// helper
export function showAndFocusWindow(window: BrowserWindow | undefined) {
  if (!window) return
  window.show()
  adjustZoomLevel(window)
  setTimeout(() => {
    if (window) window.focus()
  }, 200)
}

// ---------------------------------------------------------
// SECURITY
// enable full sandbox globally for all processes
app.enableSandbox()

// Windows toast notifications require a stable AppUserModelID matching electron-builder appId.
if (process.platform === 'win32') {
  app.setAppUserModelId('io.capacities.app')
}

// PREVENT SECOND INSTANCE (ALSO REQUIRED FOR DEEP LINKING ON WINDOWS!)
if (!app.requestSingleInstanceLock()) {
  reportError(new Error('requested second instance log'))
  app.exit()
} else {
  app.on('second-instance', (_, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else createWindow()

    if (argv.length > 1 && (process.platform === 'win32' || process.platform === 'linux')) {
      try {
        const url = argv[argv.length - 1]
        if (url.startsWith(`${CAPACITIES_PROTOCOL}:/`)) {
          const path = url.replace(`${CAPACITIES_PROTOCOL}:/`, '')
          if (!mainWindow) {
            loadingPath = path
          } else {
            if (!handleXCallback(url)) {
              rendererRequest(mainWindow, 'redirectToPath', { path })
              showAndFocusWindow(mainWindow)
            }
          }
        }
      } catch (e) {
        console.error(e)
      }
    }
  })
}

setupWebResourceBrowserSecurity(() => mainWindow)
// ---------------------------------------------------------

function adjustZoomLevel(mainWindow: BrowserWindow) {
  try {
    const current = mainWindow.webContents.getZoomFactor()
    if (Math.abs(settings.value.zoom - current) <= 0.001) return
    mainWindow.webContents.setZoomFactor(settings.value.zoom)
  } catch (e) {}
}

// handle redirects
function handleRedirect(event: Event | undefined, url: string) {
  try {
    if (!isInternalUrl(url)) {
      event?.preventDefault()

      const path = getWebAppPath(url)
      if (path) {
        // handle internal redirect via ipc

        if (mainWindow) rendererRequest(mainWindow, 'redirectToPath', { path })
        else loadingPath = path

        return 'deny'
      } else {
        const info = getUrlInformation(
          url,
          'spaceId',
          'userPersonalId',
          process.env.VITE_FRONTEND_URL?.length ? process.env.VITE_FRONTEND_URL : 'https://app.capacities.io'
        )

        if (info?.type === 'http' || info?.type === 'special' || info?.type === 'deepLink') {
          setImmediate(() => {
            shell.openExternal(url, { activate: true })
          })
        } else reportError(new Error('prevented opening of invalid url'), { url: url })

        return 'deny'
      }
    } else {
      return 'allow'
    }
  } catch (e) {
    if (e instanceof Error) reportError(e)
    return 'deny'
  }
}

app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const action = handleRedirect(undefined, url)
    return { action }
  })
})
// ---------------------------------------------------------

// DEEP LINKING
export const CAPACITIES_PROTOCOL = 'capacities' // only works in production

function extractDeepLinkUrl(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${CAPACITIES_PROTOCOL}://`))
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(CAPACITIES_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(CAPACITIES_PROTOCOL)
}

app.on('will-finish-launching', () => {
  // Protocol handler
  app.on('open-url', (e, url) => {
    e.preventDefault()
    if (!url.startsWith(`${CAPACITIES_PROTOCOL}://`)) {
      console.warn('cannot open other urls')
      return
    }
    const path = url.replace(`${CAPACITIES_PROTOCOL}:/`, '')
    if (!mainWindow) {
      loadingPath = path
    } else {
      if (!handleXCallback(url)) {
        rendererRequest(mainWindow, 'redirectToPath', { path })
        showAndFocusWindow(mainWindow)
      }
    }
  })
})

export function getLoadingPath() {
  const cachedPath = loadingPath
  loadingPath = undefined
  return cachedPath
}

if (process.platform === 'win32') {
  try {
    const appFolder = path.dirname(process.execPath)
    const updateExe = path.resolve(appFolder, '..', 'Update.exe')
    const exeName = path.basename(process.execPath)

    const current = app.getLoginItemSettings()

    settings.value.isOpeningAtLogin = current.openAtLogin
    settings.value.isOpeningAsHidden = current.openAsHidden

    app.setLoginItemSettings({
      openAtLogin: settings.value.isOpeningAtLogin,
      openAsHidden: settings.value.isOpeningAsHidden,
      path: updateExe,
      args: settings.value.isOpeningAsHidden
        ? ['--openAsHidden', '--processStart', `"${exeName}"`, '--process-start-args', `"--hidden"`]
        : [],
    })
  } catch (e: any) {
    reportError(e)
  }
}

const darkBackgroundColor = '#1a1e23' // gray-850
const lightBackgroundColor = '#fcfcfc' // coolGray-25
const darkSymbolColor = '#9ca3af'
const lightSymbolColor = '#c0c0c0'

const TRAFFIC_LIGHT_POSITION = {
  x: 12,
  y: 14,
}

function scheduleMainWindowShow(window: BrowserWindow) {
  let mainWindowShown = false

  const showMainWindowWhenReady = (reason: string) => {
    if (mainWindowShown || !mainWindow) return
    mainWindowShown = true
    console.info(`[MainWindow] showing (${reason})`)
    showAndFocusWindow(mainWindow)
  }

  window.once('ready-to-show', () => showMainWindowWhenReady('ready-to-show'))
  window.webContents.once('dom-ready', () => showMainWindowWhenReady('dom-ready'))
  window.webContents.once('did-finish-load', () => showMainWindowWhenReady('did-finish-load'))

  window.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[MainWindow] did-fail-load', { errorCode, errorDescription, validatedURL })
    showMainWindowWhenReady('did-fail-load')
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[MainWindow] render-process-gone', details)
  })

  setTimeout(() => showMainWindowWhenReady('timeout'), 3000)
}

export function createWindow() {
  try {
    if (mainWindow) return

    const mainWindowState = windowStateKeeper({
      defaultWidth: 1200,
      defaultHeight: 800,
    })

    // Create the browser window.
    mainWindow = new BrowserWindow({
      backgroundColor: nativeTheme.shouldUseDarkColors ? darkBackgroundColor : lightBackgroundColor,
      ...(process.platform !== 'linux'
        ? {
            titleBarStyle: 'hidden',
            trafficLightPosition: TRAFFIC_LIGHT_POSITION,
            titleBarOverlay:
              process.platform === 'win32'
                ? {
                    height: WINDOWS_TITLE_BAR_HEIGHT,
                    color: nativeTheme.shouldUseDarkColors ? darkBackgroundColor : lightBackgroundColor,
                    symbolColor: nativeTheme.shouldUseDarkColors ? darkSymbolColor : lightSymbolColor,
                  }
                : undefined,
            show: false,
            paintWhenInitiallyHidden: true,
          }
        : {
            show: true,
          }),
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      useContentSize: false, // required to be false for windowStateHandler
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        spellcheck: true,
        enableBlinkFeatures: undefined,
        webviewTag: true,
      },
    })

    if (process.platform === 'linux') {
      mainWindow.center()
    }

    adjustZoomLevel(mainWindow)

    nativeTheme.on('updated', () => {
      if (!mainWindow) return
      mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? darkBackgroundColor : lightBackgroundColor)
    })

    mainWindowState.manage(mainWindow)
    scheduleMainWindowShow(mainWindow)

    if (process.platform === 'darwin') app.dock?.show()

    mainWindow.on('closed', () => {
      // if (process.platform === 'darwin') app.dock?.hide()
      mainWindow = undefined
    })

    mainWindow.loadURL(getBaseUrl() + '/index.html')

    if (getEnvironment() === 'development') mainWindow.webContents.openDevTools()

    buildMenu(app, mainWindow, i18n)

    // redirect all opens
    mainWindow.webContents.setWindowOpenHandler((details) => {
      if (embedAllowWindowRedirectTo(details.referrer.url, details.url)) {
        return { action: 'allow' }
      } else {
        handleRedirect(undefined, details.url)
        return { action: 'deny' }
      }
    })

    mainWindow.webContents.on('will-navigate', handleRedirect)

    mainWindow.on('app-command', (event, command) => {
      const direction = command === 'browser-backward' ? 'back' : command === 'browser-forward' ? 'forward' : undefined
      if (!direction || !mainWindow) return
      event.preventDefault()
      void rendererRequest(mainWindow, 'navigateHistory', { direction })
    })

    // Handle permission requests - allow media/microphone/screen/notifications for internal URLs
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const isInternal = isInternalUrl(webContents.getURL())
      // Always allow media permissions for internal URLs (audio recording, screen capture)
      if (isInternal && ['media', 'microphone', 'screen', 'notifications'].includes(permission)) {
        callback(true)
        return
      }
      callback(isInternal)
    })

    // Handle permission checks - required for some Electron versions
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      if (!webContents) return false
      const isInternal = isInternalUrl(webContents.getURL())
      // Always allow media/notification permission checks for internal URLs
      if (isInternal && ['media', 'microphone', 'screen', 'notifications'].includes(permission)) {
        return true
      }
      return isInternal
    })

    // System audio recording uses Electron's app-owned display media loopback on supported desktop platforms.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
        callback({})
        return
      }

      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        const screenSource = sources[0]
        if (!screenSource) {
          callback({})
          return
        }

        callback({ video: screenSource, audio: 'loopback' })
      } catch (error) {
        console.error('[SystemAudio] Failed to resolve display media loopback source:', error)
        callback({})
      }
    })

    // detect fullscreen
    mainWindow.on('resize', () => {
      if (!mainWindow) return
      rendererRequest(mainWindow, 'afterWindowResize', { isFullscreen: mainWindow.isFullScreen() })

      // traffic light blocking fix
      if (process.platform === 'darwin') {
        if (mainWindow?.isFullScreen()) {
          mainWindow?.setWindowButtonPosition({ x: -30, y: TRAFFIC_LIGHT_POSITION.y })
        } else {
          mainWindow?.setWindowButtonPosition(TRAFFIC_LIGHT_POSITION)
        }
      }
    })

    // traffic light blocking fix
    if (mainWindow.isFullScreen() && process.platform === 'darwin') {
      mainWindow?.setWindowButtonPosition({ x: -30, y: TRAFFIC_LIGHT_POSITION.y })
    }

    // TEST
    if (getEnvironment() === 'development') {
      setTimeout(() => {
        runTest()
      }, 1000)
    }
  } catch (e: any) {
    reportError(e)
  }
}

export function closeWindow() {
  mainWindow?.close()
}

// function buildTrayMenu(tray: Tray) {
//   const contextMenu = Menu.buildFromTemplate([
//     {
//       label:
//         i18n.t('Electron.TrayMenu.open.main') +
//         (getElectronEnvironment() !== 'production' ? ` (${getElectronEnvironment()})` : ''),
//       type: 'normal',
//       click: () => {
//         if (mainWindow) showAndFocusWindow(mainWindow)
//         else createWindow()
//       },
//     },
//     {
//       label: i18n.t('Electron.TrayMenu.open.quitCompletely'),
//       type: 'normal',
//       click: () => {
//         quitCompletely()
//       },
//     },
//   ])
//   // tray.setToolTip('capacities')
//   tray.setContextMenu(contextMenu)
// }

// context menu config
contextMenu({
  showSelectAll: true,
  showLookUpSelection: true,
  showSaveImage: false,
  showSaveImageAs: true,
  showSaveLinkAs: false,
})

app.whenReady().then(() => {
  setupWebResourceBrowserSession()

  if (getEnvironment() !== 'development') {
    protocol.handle('app', async (request) => {
      if (!request.url) return new Response(null, { status: 400 })

      try {
        let pathname

        try {
          pathname = decodeURIComponent(new URL(request.url).pathname)
        } catch {
          return new Response(null, { status: 400 })
        }

        const location = path.normalize(path.resolve(DIST_PATH, pathname.replace(/^\.?\//, './')))
        const relative = path.relative(DIST_PATH, location)

        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          return new Response(null, { status: 403 })
        }

        try {
          const stats = await fs.promises.lstat(location)
          if (!stats.isFile()) {
            return new Response(null, { status: 404 })
          }
        } catch {
          return new Response(null, { status: 404 })
        }

        const name = sanitizeFileName(path.basename(location))
        if (!name) return new Response(null, { status: 400 })

        return net.fetch(pathToFileURL(location).href)
      } catch {
        return new Response(null, {
          status: 500,
        })
      }
    })
  }

  // YouTube API Client Identity: Set Referer header for YouTube embed requests
  // Per YouTube API Terms (https://developers.google.com/youtube/terms/required-minimum-functionality):
  // "API Clients that use the YouTube embedded player must provide identification through the HTTP Referer request header."
  // In Electron WebViews, the Referer header is empty by default, so we must inject it.
  // Format: https://<app-id> where app-id is from electron-builder.yml (io.capacities.app)
  // This fixes YouTube Error 153 which occurs when YouTube cannot identify the API client.
  // Set this handler early in app.whenReady() to ensure it's active before any windows are created.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://www.youtube.com/embed/*',
        'https://www.youtube-nocookie.com/embed/*',
        'https://www.youtube.com/api/stats/*',
        'https://www.youtube.com/get_video_info*',
        'https://www.youtube.com/youtubei/v1/*',
        'https://*.googlevideo.com/*',
      ],
    },
    (details, callback) => {
      // Set Referer header to identify the Electron app as the API client
      // This must match the format: https://<app-id> per YouTube's requirements
      details.requestHeaders['Referer'] = 'https://io.capacities.app'
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  useMediaHandling()
  useExportHandling()

  // setTray()
  const isOpenedAsHidden = app.getLoginItemSettings().wasOpenedAsHidden && process.argv.includes('--hidden')

  // On Linux, deep links arrive via process.argv on cold start (no open-url event fires).
  if (process.platform === 'linux') {
    try {
      const deepLinkUrl = extractDeepLinkUrl(process.argv)
      if (deepLinkUrl) {
        const deepLinkPath = deepLinkUrl.replace(`${CAPACITIES_PROTOCOL}:/`, '')
        if (!handleXCallback(deepLinkUrl)) {
          loadingPath = deepLinkPath
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  if (!isOpenedAsHidden) createWindow()
  else if (process.platform === 'darwin') app.dock?.hide()

  // setInterval(() => {
  // new Notification({ title: 'url', body: mainWindow?.webContents.getURL(), silent: true }).show()
  // }, 10000)
})

// i18n logic
i18n.on('loaded', () => {
  i18n.changeLanguage('en')
  i18n.off('loaded')
})

i18n.on('languageChanged', () => {
  if (mainWindow) buildMenu(app, mainWindow, i18n)
})

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    adjustZoomLevel(mainWindow)
  } else {
    createWindow()
  }
})

// RESETTING
export function executeHardReset() {
  if (!mainWindow) return
  rendererRequest(mainWindow, 'runHardReset', undefined)
}

// AUTO UPDATER
autoUpdater.logger = { info: console.info, warn: console.warn, error: console.error, debug: console.debug }
// autoUpdater.disableWebInstaller = true
autoUpdater.autoInstallOnAppQuit = true
// autoUpdater.autoDownload = false

let inDownload = false

async function checkForUpdates() {
  inDownload = false
  await new Promise((resolve) => setTimeout(resolve, 30 * 1000)) // 30 sec
  if (!inDownload) autoUpdater.checkForUpdates()
}

if (getEnvironment() !== 'staging' && getEnvironment() !== 'development') {
  checkForUpdates()
  setInterval(
    async () => {
      checkForUpdates()
    },
    10 * 60 * 1000
  )
}

autoUpdater.on('checking-for-update', () => {})

autoUpdater.on('update-available', () => {})

autoUpdater.on('download-progress', () => {
  inDownload = true
})

autoUpdater.on('update-downloaded', async (event) => {
  if (!mainWindow) return
  rendererRequest(mainWindow, 'setNewAppVersion', { version: event.version })
  await new Promise((resolve) => setTimeout(resolve, 1000 * 10))
  rendererRequest(mainWindow, 'setNewAppVersion', { version: event.version })
})

export function handleMenuCommand({ key }: ElectronCommunicationRendererToMainRequest['runMenuCommand']['inData']) {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  switch (key) {
    case 'app-quit':
      closeWindow()
      break
    case 'app-settings':
      if (focusedWindow) rendererRequest(focusedWindow, 'openSettings', undefined)
      break
    case 'app-about':
      if (focusedWindow) app.showAboutPanel()
      break
    case 'edit-undo':
      if (focusedWindow) focusedWindow.webContents.undo()
      break
    case 'edit-redo':
      if (focusedWindow) focusedWindow.webContents.redo()
      break
    case 'edit-cut':
      if (focusedWindow) focusedWindow.webContents.cut()
      break
    case 'edit-copy':
      if (focusedWindow) focusedWindow.webContents.copy()
      break
    case 'edit-paste':
      if (focusedWindow) focusedWindow.webContents.paste()
      break
    case 'edit-selectAll':
      if (focusedWindow) focusedWindow.webContents.selectAll()
      break
    case 'view-reload':
      if (focusedWindow) focusedWindow.reload()
      break
    case 'view-minimize':
      if (focusedWindow) focusedWindow.minimize()
      break
    case 'view-resetZoom':
      if (focusedWindow) setZoomLevel(focusedWindow, 'reset')
      break
    case 'view-zoomIn':
      if (focusedWindow) setZoomLevel(focusedWindow, 'in')
      break
    case 'view-zoomOut':
      if (focusedWindow) setZoomLevel(focusedWindow, 'out')
      break
    case 'help-learn':
      shell.openExternal('https://docs.capacities.io')
      break
    case 'view-devTools':
      if (focusedWindow) focusedWindow.webContents.toggleDevTools()
      break
  }
}

export function runVersionUpdate() {
  autoUpdater.quitAndInstall(true, true) // for windows silent update
}

// DEVICE INFO
export function updateInAppState(value: InAppState) {
  setInAppState(value)

  // functions that need to rerun on change
  if (mainWindow) buildMenu(app, mainWindow, i18n)
}

export async function clearStorageData() {
  try {
    await session.defaultSession.clearStorageData()
  } catch (e: any) {
    reportError(e)
  }
}

// download handler
export async function downloadFromUrl({
  url,
  fileName,
  isSilent,
}: ElectronCommunicationRendererToMainRequest['downloadFromUrl']['inData']) {
  try {
    if (!mainWindow) return
    let downloadInfo
    if (fileName) {
      const array = fileName.split('.')
      const ending = array.pop()
      const name = array.join('.')
      let counter = 0
      do {
        fileName = `${name}${counter ? ` (${counter})` : ''}.${ending}`
        counter++
      } while (fs.existsSync(app.getPath('downloads') + '/' + fileName))
    }
    downloadInfo = await download(mainWindow, url, { filename: fileName, showBadge: false, overwrite: false })
    if (downloadInfo && mainWindow && !isSilent) {
      rendererRequest(mainWindow, 'setDownloadDone', {
        success: downloadInfo.getState() === 'completed',
        savePath: downloadInfo.getSavePath(),
        fileName: fileName || downloadInfo.getFilename(),
      })
    }
  } catch (e: any) {
    reportError(e)
  }
}

export async function openFilePathOnDevice({
  fileURL,
}: ElectronCommunicationRendererToMainRequest['openFilePathOnDevice']['inData']) {
  try {
    const location = getPathFromFileURL(fileURL)
    if (!location) return false

    flow: {
      const stat = lstatSync(location, { throwIfNoEntry: false })
      if (!stat) break flow

      const isFile = stat.isFile()
      const isDirectory = stat.isDirectory()

      if (!isFile && !isDirectory) break flow

      const basename = path.basename(location)
      const { name, extension } = getFileNameParts(basename)

      const displayName = name || basename
      if (!displayName) break flow

      if (!store.value.trustedFilePaths.has(location)) {
        const { response } = await dialog.showMessageBox({
          title: i18n.t('Electron.OpenBufferRequest.title'),
          message: i18n.t('Electron.OpenBufferRequest.message'),
          detail: i18n.t('Electron.OpenBufferRequest.details', {
            name: `${displayName.slice(0, MAXIMUM_TITLE_DISPLAY_LENGTH)}${displayName.length > MAXIMUM_TITLE_DISPLAY_LENGTH ? '[...]' : ''}${extension ? `.${extension}` : ''}`,
            size: getFormattedFileSize(stat.size),
          }),
          buttons: [i18n.t('general.allowOnce'), i18n.t('general.alwaysAllow'), i18n.t('general.cancel')],
          type: 'info',
          defaultId: 0,
          cancelId: 2,
        })

        if (response < 0 || response > 2) break flow
        if (response === 2) break flow
        if (response === 1) store.value.trustedFilePaths.add(location)
      }

      shell.openPath(location)
      return true
    }

    if (store.value.trustedFilePaths.has(location)) {
      store.value.trustedFilePaths.delete(location)
    }
  } catch (error) {
    if (error instanceof Error) reportError(error)
  }

  return false
}

// window resize
export function getWindowSize() {
  return { isFullscreen: mainWindow?.isFullScreen() ?? true }
}

/** Brings the main window to the foreground — used when the user clicks an OS notification. */
export function focusMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

export function copyToClipboard({
  plainText,
  html,
  internalClipboardEntryId,
}: ElectronCommunicationRendererToMainRequest['copyToClipboard']['inData']) {
  if (html && plainText) {
    clipboard.write({
      text: plainText,
      html: `<span id="${internalClipboardEntryId}">${html}</span>`,
    })
  } else if (plainText) {
    clipboard.writeText(plainText)
  }
}

export async function readTextFromClipboard() {
  return clipboard.readText()
}

// TEST
async function runTest() {}

export async function handleActionQueueElement(
  data: ElectronCommunicationRendererToMainRequest['handleActionQueueElement']['inData']
): Promise<ElectronCommunicationRendererToMainRequest['handleActionQueueElement']['outData']> {
  const responseObject: ActionQueueElementResponseWorkerDto = {
    ...data,
    responseData: {
      success: false,
      error: 'Code 2389',
    },
  }

  if (data.type === 'task-action') {
    const { payload, taskAction } = data.data
    const labels =
      'labels' in taskAction && taskAction.labels?.length ? taskAction.labels.split(',').map((el) => el.trim()) : []
    if (payload.tags?.length) {
      labels.push(...payload.tags)
    }
    let body
    if (taskAction.hideOriginLink || payload.context.type !== 'todo-block') {
      body = payload.contentMarkdown.replace('\n\n', '\n')
    } else {
      body = `${payload.context.createdInDesktopPlain}\n\n${payload.contentMarkdown.replace('\n\n', '\n')}`
    }

    if (data.data.taskAction.service === 'culturecode-things') {
      const payload = data.data.payload
      const taskAction = data.data.taskAction

      const params: string[] = []
      params.push(`title=${encodeURIComponent(payload.titlePlain)}`)

      params.push('reveal=true')

      if (payload.done) {
        params.push('completed=true')
      }

      if (payload.dueDate) {
        params.push(`deadline=${encodeURIComponent(payload.dueDate.split('T')[0])}`)
      }

      if (body?.length) {
        const reducedContent = body.length > 10000 ? body.slice(0, 9995) + '...' : body
        params.push(`notes=${encodeURIComponent(reducedContent)}`)
      }

      if (labels?.length) {
        params.push(`tags=${encodeURIComponent(labels.join(','))}`)
      }

      if (taskAction.projectName?.length) {
        params.push(`list=${encodeURIComponent(taskAction.projectName)}`)
      }

      try {
        await shell.openExternal(`things:///add?${params.join('&')}`)
        delete responseObject.responseData.error
        responseObject.responseData.success = true
        return responseObject
      } catch (e) {
        responseObject.responseData.error = `Code 4931 (${e})`
        return responseObject
      }
    } else if (data.data.taskAction.service === 'apple-reminders') {
      const payload = data.data.payload
      const taskAction = data.data.taskAction

      function escapeSpecialCharacters(string: string) {
        return string.replace(/["\\]/g, '\\$&')
      }

      let dateCreationString: string | undefined = undefined
      if (payload.dueDateTime) {
        const date = new Date(payload.dueDateTime)
        const year = date.getFullYear()
        const month = date.toLocaleString('en', { month: 'long' })
        const day = date.getDate()
        const hours = date.getHours()
        const minutes = date.getMinutes()
        const seconds = date.getSeconds()

        dateCreationString = `
-- Specifying a date explicitly
set theYear to ${year}
set theMonth to ${date.getMonth() + 1}
set theDay to ${day}
set theHour to ${payload.dueDate ? '0' : hours}
set theMinute to ${payload.dueDate ? '0' : minutes}
set theSecond to ${payload.dueDate ? '0' : seconds}

-- Create the date
set myDueDate to current date
tell myDueDate
    set its year to theYear
    set its month to theMonth
    set its day to theDay
    set its hours to theHour
    set its minutes to theMinute
    set its seconds to theSecond
end tell`
      }

      const script = `use AppleScript version "2.4" -- Yosemite (10.10) or later
use scripting additions

on makeReminder(reminderName, reminderBody, reminderListName, reminderCompleted, reminderDueDate)
    tell application "Reminders"
        if reminderListName is not "" then
            if not (exists list reminderListName) then
                make new list with properties {name:reminderListName}
            end if
            
            set newReminder to make new reminder ¬
                with properties {name:reminderName, body:reminderBody, completed:reminderCompleted} ¬
                at list reminderListName
            
            if reminderDueDate is not missing value then
                tell newReminder to set ${payload.dueDate ? 'allday ' : ''}due date to reminderDueDate
            end if
            
            return newReminder
        else
            set newReminder to make new reminder ¬
                with properties {name:reminderName, body:reminderBody, completed:reminderCompleted}
            
            if reminderDueDate is not missing value then
                tell newReminder to set ${payload.dueDate ? 'allday ' : ''}due date to reminderDueDate
            end if
            
            return newReminder
        end if
    end tell
end makeReminder

${dateCreationString || ''}

makeReminder("${escapeSpecialCharacters(payload.titlePlain)}", "${escapeSpecialCharacters(
        body
      )}", "${escapeSpecialCharacters(taskAction.projectName || '')}", ${payload.done}, ${
        dateCreationString?.length ? `myDueDate` : 'missing value'
      })`

      try {
        const rtn = await runAppleScript(script)
        if (responseObject.type !== 'task-action') {
          throw new Error('not a task-action')
        }

        const id = rtn.match(/x-apple-reminder:\/\/([A-Z0-9\-]*)/)?.[1]
        delete responseObject.responseData.error
        responseObject.responseData.success = true
        responseObject.responseData.appleReminderId = id
        return responseObject
      } catch (e) {
        console.error(e)
        responseObject.responseData.error = `Code 5982 (${e})`
        return responseObject
      }
    } else {
      responseObject.responseData.error = 'Code 5983'
      return responseObject
    }
  } else {
    responseObject.responseData.error = 'Code 2390'
    return responseObject
  }
}

export async function getAppleRemindersAccess() {
  try {
    await runAppleScript(`
      use AppleScript version "2.4" -- Yosemite (10.10) or later
      use scripting additions

      tell application "Reminders"
        return exists
      end tell
    `)

    return true
  } catch (e: any) {
    console.error(e)
    return false
  }
}

// theme updates
export function setThemeKey(input: { themeKey: ThemeKey; inFocusMode?: boolean }) {
  if (!mainWindow) return

  const theme = themes[input.themeKey] ?? themes['light']
  mainWindow.setBackgroundColor(oklchToRgb(theme.ui['bg-back']))

  if (process.platform === 'win32') {
    // Alpha is dropped on Windows, so a transparent overlay paints black and hides the top row.
    // Focus mode paints the shell `bg-base`, including the menu strip when that strip stays visible.
    mainWindow.setTitleBarOverlay({
      height: WINDOWS_TITLE_BAR_HEIGHT,
      color: oklchToRgb(theme.ui[input.inFocusMode ? 'bg-base' : 'bg-back']),
      symbolColor: oklchToRgb(theme.ui['text-primary']),
    })
  }
}

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  app.quit()
})

process.on('SIGINT', () => {
  app.quit()
})

process.on('SIGTERM', () => {
  app.quit()
})
