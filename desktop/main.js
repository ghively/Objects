'use strict'
// Object's desktop window (M33): a frameless Electron shell around the app that `objectapp`
// serves on 127.0.0.1. `objectapp` (Python) is the parent: it starts the server, starts this
// shell with its launch JSON in the environment (OBJECT_DESKTOP_LAUNCH, never on the command
// line), and stops the server when the shell exits. Nothing here knows how to start Python.
//
// Safety: the window only ever shows the launch origin; the page has no Node (sandbox, context
// isolation) and gets only the bridge in preload.js; the one-time links (the launch and the
// keep-on-top line) are never logged and never written to disk, and the launch variable is
// removed from this process's environment as soon as it is read.

const path = require('node:path')
const { app, BrowserWindow, Menu, ipcMain, nativeTheme, screen, session, shell } = require('electron')

const { takeLaunch } = require('./lib/launch')
const { controlsFor } = require('./lib/controls')
const { cleanTheme, overlayFor, windowOptions, focusWindowOptions, webPreferences } = require('./lib/windowOptions')
const { loadState, saveState, placeOnDisplays, isWayland } = require('./lib/windowState')
const { sameOrigin, navigation, windowOpen } = require('./lib/guard')
const { permissionAllowed } = require('./lib/permissions')
const { listenToParent } = require('./lib/stdinLines')
const { createCloseGate } = require('./lib/closeGate')
const { createPending } = require('./lib/pending')
const { applicationMenu, contextMenu } = require('./lib/menus')
const { spellCheckLanguagesFor } = require('./lib/spellcheck')

/** `objectapp` reads this line on the shell's stdout: the window exists. */
const READY_LINE = 'object-desktop: ready'
/** After the last window closed: how long requests still on their way (the page's last saves) are waited for. */
const DRAIN_MS = 2000
const SAVE_STATE_MS = 500
const BUTTONS = ['auto', 'show', 'hide']

let launch
try {
  // Read once and removed: nothing this process starts (the default browser, a helper) inherits it.
  launch = takeLaunch(process.env)
} catch (error) {
  console.error(`Object: ${error.message}`)
  app.exit(2)
}

if (launch) start(launch)

function start({ url, origin, stateDir, icon, frame }) {
  const platform = process.platform
  const hiddenFrame = frame !== 'system'
  const wayland = platform === 'linux' && isWayland(process.env, process.argv)
  const stateFile = path.join(stateDir, 'desktop', 'window.json')
  const preload = path.join(__dirname, 'preload.js')
  const saved = loadState(stateFile)
  const pending = createPending()
  const gates = new Map()

  let theme = cleanTheme(saved.theme)
  let windowButtons = BUTTONS.includes(saved.windowButtons) ? saved.windowButtons : 'auto'
  let mainWindow = null
  let focusWindow = null
  let saveTimer = null
  let quitting = false
  /** The ready line went out: from now on the end of stdin means `objectapp` is gone. */
  let toldParentReady = false
  /** The session's spell-check languages before the setting was applied: the system's (from its locale). */
  let systemSpellCheckLanguages = null

  app.setName('Object')
  if (platform === 'win32') app.setAppUserModelId('com.objectapp.Object')
  // Linux: the window class (X11 WM_CLASS, Wayland app_id), which the launcher entry
  // `object.desktop` (scripts/install-launcher.py, StartupWMClass=object) is matched by.
  if (platform === 'linux') app.setDesktopName('object.desktop')
  // Web storage (tabs, recents, view state) is kept between launches in the state folder.
  app.setPath('userData', path.join(stateDir, 'desktop'))

  const mainControls = () => controlsFor(platform, process.env, windowButtons, frame)

  // -- the window's state ---------------------------------------------------------------------

  function currentState() {
    const next = { ...saved, windowButtons }
    if (theme) next.theme = theme
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getNormalBounds()
      next.width = bounds.width
      next.height = bounds.height
      next.maximized = mainWindow.isMaximized()
      // Wayland does not tell a window where it is (and cannot put it anywhere).
      if (!wayland) {
        next.x = bounds.x
        next.y = bounds.y
      }
    }
    return next
  }

  function saveStateNow() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = null
    Object.assign(saved, currentState())
    saveState(stateFile, saved)
  }

  function saveStateSoon() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveStateNow, SAVE_STATE_MS)
  }

  // -- what a window may show -----------------------------------------------------------------

  function openExternal(target) {
    shell.openExternal(target).catch(() => {})
  }

  function guard(contents) {
    const onNavigate = (event) => {
      const decision = navigation(event.url, origin)
      if (decision.action === 'allow') return
      event.preventDefault()
      if (decision.action === 'external') openExternal(decision.url)
    }
    contents.on('will-navigate', onNavigate)
    contents.on('will-redirect', (event) => {
      if (event.isMainFrame) onNavigate(event)
    })
    contents.setWindowOpenHandler((details) => {
      const decision = windowOpen(details.url, origin)
      if (decision.action === 'external') openExternal(decision.url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  }

  // A right click where the page showed no menu of its own (Electron sends `context-menu` only
  // then): Cut / Copy / Paste / Select all, and spelling suggestions.
  function showContextMenu(contents, params) {
    const items = contextMenu(params)
    if (items.length === 0) return
    const template = items.map((item) => {
      if (item.replace !== undefined) return { label: item.label, click: () => contents.replaceMisspelling(item.replace) }
      if (item.addWord !== undefined) {
        return { label: item.label, click: () => contents.session.addWordToSpellCheckerDictionary(item.addWord) }
      }
      return item
    })
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(contents) || undefined })
  }

  // -- closing: the page saves first ----------------------------------------------------------

  function holdCloseUntilSaved(win) {
    const contents = win.webContents
    const id = contents.id
    let loaded = false
    contents.on('did-finish-load', () => { loaded = sameOrigin(contents.getURL(), origin) })
    contents.on('render-process-gone', () => { loaded = false })
    const gate = createCloseGate({
      ask: () => {
        if (!loaded || contents.isDestroyed() || contents.isCrashed()) return false
        contents.send('object-desktop:before-close')
        return true
      },
      proceed: () => { if (!win.isDestroyed()) win.close() },
    })
    gates.set(id, gate)
    // Windows shutting down or logging off closes no window first: the page is asked to save
    // now (its blur and `pagehide` keep-alive saves), and the shutdown is not held up.
    if (platform === 'win32') win.on('query-session-end', () => { gate.sessionEnding() })
    win.on('close', (event) => {
      if (!gate.onClose()) event.preventDefault()
      else if (win === mainWindow) saveStateNow()
    })
    win.on('closed', () => { gates.delete(id) })
  }

  async function quitWhenDone() {
    if (quitting || mainWindow !== null || BrowserWindow.getAllWindows().length > 0) return
    quitting = true
    // The page's last saves are keep-alive requests that outlive the window; `objectapp` stops
    // the server as soon as this process is gone, so they are waited for (up to DRAIN_MS).
    await pending.whenIdle(DRAIN_MS)
    app.quit()
  }

  // -- the windows ----------------------------------------------------------------------------

  function load(win, target) {
    const reveal = () => { if (!win.isDestroyed() && !win.isVisible()) win.show() }
    win.once('ready-to-show', reveal)
    // The link is a one-time secret: a failed load is reported without it.
    win.loadURL(target)
      .catch(() => { console.error('Object: the window could not load the app.') })
      .finally(reveal)
  }

  function sendWindowState(win) {
    if (win.isDestroyed()) return
    win.webContents.send('object-desktop:window-state', { maximized: win.isMaximized(), fullScreen: win.isFullScreen() })
  }

  function createMainWindow() {
    const workAreas = screen.getAllDisplays().map((display) => display.workArea)
    const place = placeOnDisplays(saved, workAreas, { wayland })
    const options = windowOptions(platform, theme, place, frame)
    if (icon) options.icon = icon
    options.webPreferences = webPreferences(preload)
    const win = new BrowserWindow(options)
    mainWindow = win
    if (place.maximized) win.maximize()
    for (const name of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen',
      'enter-html-full-screen', 'leave-html-full-screen']) {
      win.on(name, () => sendWindowState(win))
    }
    for (const name of ['resize', 'move', 'maximize', 'unmaximize']) win.on(name, saveStateSoon)
    holdCloseUntilSaved(win)
    win.on('closed', () => {
      mainWindow = null
      // One window per launch: the keep-on-top window goes with it (after its own save).
      for (const other of BrowserWindow.getAllWindows()) other.close()
      quitWhenDone()
    })
    load(win, url)
  }

  function openFocusWindow(target) {
    if (focusWindow && !focusWindow.isDestroyed()) {
      focusWindow.show()
      focusWindow.focus()
      return
    }
    const options = focusWindowOptions(platform, theme)
    if (icon) options.icon = icon
    options.webPreferences = webPreferences(preload)
    const win = new BrowserWindow(options)
    focusWindow = win
    // It keeps its own name ("Object focus"), whatever the page's title is.
    win.on('page-title-updated', (event) => event.preventDefault())
    holdCloseUntilSaved(win)
    win.on('closed', () => {
      if (focusWindow === win) focusWindow = null
      quitWhenDone()
    })
    load(win, target)
  }

  // -- the bridge (preload.js) ----------------------------------------------------------------

  /** The window a bridge call came from, when it came from the app's own page in its main frame. */
  function callerWindow(event) {
    const frame_ = event.senderFrame
    if (!frame_ || frame_ !== event.sender.mainFrame || !sameOrigin(frame_.url, origin)) return null
    return BrowserWindow.fromWebContents(event.sender)
  }

  function applyTheme(next) {
    theme = next
    nativeTheme.themeSource = next.mode
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(next.background)
    if (platform === 'win32' && hiddenFrame && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay(overlayFor(next))
    }
    saveStateSoon()
  }

  function registerBridge() {
    ipcMain.on('object-desktop:info', (event) => {
      const isMain = mainWindow !== null && event.sender === mainWindow.webContents
      event.returnValue = {
        platform,
        // The keep-on-top window always has the system's frame: nothing for the page to draw.
        controls: isMain ? mainControls() : 'none',
        framed: isMain ? !hiddenFrame : true,
      }
    })
    ipcMain.on('object-desktop:minimize', (event) => { callerWindow(event)?.minimize() })
    ipcMain.on('object-desktop:toggle-maximize', (event) => {
      const win = callerWindow(event)
      if (!win) return
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    })
    ipcMain.on('object-desktop:close', (event) => { callerWindow(event)?.close() })
    ipcMain.on('object-desktop:before-close-done', (event) => {
      if (callerWindow(event)) gates.get(event.sender.id)?.answered()
    })
    ipcMain.on('object-desktop:set-theme', (event, value) => {
      const next = cleanTheme(value)
      if (next && callerWindow(event)) applyTheme(next)
    })
    // "Spellcheck language": Windows and Linux pick the dictionary here; macOS uses the system's
    // own spellchecker, so nothing is done there. Chromium downloads a language's dictionary from
    // its vendor's server the first time it is used (said in Settings and the README).
    ipcMain.on('object-desktop:set-spell-check-language', (event, tag) => {
      if (platform === 'darwin' || !callerWindow(event) || (tag !== null && typeof tag !== 'string')) return
      const ses = event.sender.session
      if (systemSpellCheckLanguages === null) systemSpellCheckLanguages = ses.getSpellCheckerLanguages()
      try {
        ses.setSpellCheckerLanguages(spellCheckLanguagesFor(tag, ses.availableSpellCheckerLanguages, systemSpellCheckLanguages))
      } catch {
        // a language Chromium refuses: the dictionary stays as it was
      }
    })
    ipcMain.handle('object-desktop:is-maximized', (event) => callerWindow(event)?.isMaximized() === true)
    ipcMain.handle('object-desktop:is-full-screen', (event) => callerWindow(event)?.isFullScreen() === true)
    ipcMain.handle('object-desktop:set-window-buttons', (event, value) => {
      const win = callerWindow(event)
      if (win !== null && win === mainWindow && platform === 'linux' && BUTTONS.includes(value)) {
        windowButtons = value
        saveStateSoon()
      }
      return win === mainWindow ? mainControls() : 'none'
    })
  }

  // -- the session ----------------------------------------------------------------------------

  function prepareSession(ses) {
    ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(permissionAllowed(permission, details && details.requestingUrl, origin, details))
    })
    ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
      permissionAllowed(permission, requestingOrigin || (details && details.requestingUrl), origin, details))
    // Downloads (exports): with no save path set, Electron asks through the system's save dialog.
    ses.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) })
    })
    const own = { urls: [`${origin}/*`] }
    ses.webRequest.onSendHeaders(own, (details) => pending.start(details.id))
    ses.webRequest.onCompleted(own, (details) => pending.end(details.id))
    ses.webRequest.onErrorOccurred(own, (details) => pending.end(details.id))
  }

  // -- `objectapp` on stdin -------------------------------------------------------------------

  /**
   * `objectapp` is stopping (the quit line) or gone (stdin ended): every window closes the way a
   * person's close does, through its gate (the page saves first), and the shell quits once they
   * have, after the requests still on their way (`quitWhenDone`).
   */
  function closeEverything() {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) {
      quitWhenDone()
      return
    }
    for (const win of windows) win.close()
  }

  function watchParent() {
    try {
      listenToParent(process.stdin, origin, {
        open: (target) => { if (mainWindow !== null) openFocusWindow(target) },
        quit: closeEverything,
        started: () => toldParentReady,
      })
    } catch {
      // no stdin: there is no line to read
    }
  }

  function tellParentReady() {
    toldParentReady = true
    try {
      process.stdout.on('error', () => {})
      process.stdout.write(`${READY_LINE}\n`)
    } catch {
      // no stdout
    }
  }

  app.on('web-contents-created', (_event, contents) => {
    guard(contents)
    contents.on('context-menu', (_e, params) => showContextMenu(contents, params))
  })
  app.on('window-all-closed', quitWhenDone)

  app.whenReady().then(() => {
    const template = applicationMenu(platform)
    Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null)
    if (theme) nativeTheme.themeSource = theme.mode
    if (platform === 'darwin' && icon && app.dock) {
      try {
        app.dock.setIcon(icon)
      } catch {
        // the dock keeps its usual icon
      }
    }
    prepareSession(session.defaultSession)
    registerBridge()
    createMainWindow()
    watchParent()
    tellParentReady()
  })
}
