'use strict'
// The desktop window, end to end: the real back end, started as a person starts it
// (`objectapp --window electron`) on a new empty space, with the real shell. Not part of
// `npm test`: it needs a display, the built front end (`frontend/dist`) and Python.
// How to run it: see desktop/README.md.

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const H = require('./harness')

const PORT = Number(process.env.OBJECT_E2E_PORT || 8891)
const SHOTS = process.env.OBJECT_E2E_SHOTS || null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

const mainWindow = 'electron.BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]'

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(full) : [full]
  })
}

function notes(space) {
  return filesUnder(space).filter((f) => f.endsWith('.md') && !f.includes(`${path.sep}.object`))
}

/** True once `selector` matches (polled in the page: Playwright's own waits stall after a refused navigation). */
function present(page, selector) {
  return H.until(selector, () => page.evaluate((sel) => document.querySelector(sel) !== null, selector))
}

/** Waits until the caret is in a new note's title. */
function caretInTitle(page) {
  return H.until('the caret in the title', () => page.evaluate(() =>
    document.activeElement !== null && document.activeElement.getAttribute('placeholder') === 'Untitled'))
}

/** Waits until the caret is in a note's text. */
function caretInText(page) {
  return H.until('the caret in the text', () => page.evaluate(() =>
    document.activeElement !== null && document.activeElement.classList.contains('ProseMirror')))
}

/**
 * Makes a note from Home's "New note" and leaves the caret in its text. Real mouse and key
 * events, so it also shows the page still works after the shell refused a navigation.
 */
async function newNote(page, title) {
  const spot = await H.until('the New note button', () => page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New note')
    if (!button) return null
    const r = button.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }))
  await page.mouse.click(spot.x, spot.y)
  await caretInTitle(page)
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
  await caretInText(page)
}

async function run() {
  const wm = H.ensureWindowManager()
  const work = H.tmpdir('object-e2e-')
  const space = path.join(work, 'space')
  fs.mkdirSync(space)
  const stateDir = path.join(work, 'state')
  const browser = H.fakeBrowser(path.join(work, 'bin'))
  const base = { space, stateDir, port: PORT, work }
  const env = (extra) => ({ PATH: `${browser.dir}${path.delimiter}${process.env.PATH}`, ...extra })
  console.log(`space ${space}\nwindow manager: ${wm.name || 'none (maximise and minimise are not checked)'}`)

  // -- 1. a tiling compositor: no buttons ---------------------------------------------------
  let app = await H.launch({ ...base, env: env({ XDG_CURRENT_DESKTOP: 'Hyprland' }) })
  let { page, main } = app
  await page.getByRole('heading', { name: 'Home' }).waitFor()
  check('the window shows the app (Home)', true)
  let bridge = await page.evaluate(() => ({
    platform: window.objectDesktop.platform, controls: window.objectDesktop.controls, framed: window.objectDesktop.framed,
  }))
  check('window.objectDesktop is there, platform linux', bridge.platform === 'linux', bridge)
  check('XDG_CURRENT_DESKTOP=Hyprland: controls is none', bridge.controls === 'none' && bridge.framed === false, bridge)
  // The page sending itself elsewhere stays put too. (Last in this launch: Playwright then
  // waits for a navigation that the shell refused.)
  await page.evaluate(() => { window.location.href = 'https://example.com/from-location' })
  await H.until('location handed to the browser', () => browser.opened().includes('https://example.com/from-location'))
  check('the page cannot send the window to another site', page.url() === `http://127.0.0.1:${PORT}/`, page.url())
  let closed = await app.closeWith(() => page.evaluate(() => { window.objectDesktop.close() }))
  check('close() from the page ends objectapp', closed.code === 0, closed)
  check('the port is free after the window closed', !(await H.listening(PORT)))

  // -- 2. an ordinary desktop: the page draws the buttons -------------------------------------
  app = await H.launch({ ...base, env: env({ XDG_CURRENT_DESKTOP: 'GNOME' }) })
  ;({ page, main } = app)
  await page.getByRole('heading', { name: 'Home' }).waitFor()
  bridge = await page.evaluate(() => ({ platform: window.objectDesktop.platform, controls: window.objectDesktop.controls }))
  check('XDG_CURRENT_DESKTOP=GNOME: controls is custom', bridge.controls === 'custom', bridge)
  const keys = await page.evaluate(() => Object.keys(window.objectDesktop).sort())
  check('the bridge has exactly the Contract members', JSON.stringify(keys) === JSON.stringify([
    'close', 'controls', 'framed', 'isFullScreen', 'isMaximized', 'minimize', 'onBeforeClose', 'onWindowState',
    'platform', 'setTheme', 'setWindowButtons', 'toggleMaximize']), keys)
  check('the page has no Node', await page.evaluate(() =>
    typeof window.require === 'undefined' && typeof window.process === 'undefined' && typeof window.module === 'undefined'))

  let shape = await main.evaluate(`(() => { const w = ${mainWindow}; return { bounds: w.getBounds(), content: w.getContentBounds() } })()`)
  check('the window is frameless (its content fills its bounds)',
    JSON.stringify(shape.bounds) === JSON.stringify(shape.content), shape)
  const ids = (H.xprop('-root', '_NET_CLIENT_LIST') || '').match(/0x[0-9a-f]+/g) || []
  if (ids.length > 0) {
    const props = ids.map((id) => H.xprop('-id', id, 'WM_CLASS', '_MOTIF_WM_HINTS', '_NET_FRAME_EXTENTS')).join('\n')
    check('X11: no decorations asked for (_MOTIF_WM_HINTS)', /_MOTIF_WM_HINTS\(_MOTIF_WM_HINTS\) = 0x2, 0x0, 0x0/.test(props), props.trim())
    check('X11: the window class is "object" (what the launcher entry names)', /WM_CLASS\(STRING\) = "object", "object"/.test(props))
  }

  if (wm.name) {
    await page.evaluate(() => {
      window.__states = []
      window.objectDesktop.onWindowState((s) => window.__states.push(s))
      window.objectDesktop.toggleMaximize()
    })
    await H.until('maximised', () => page.evaluate(() => window.objectDesktop.isMaximized()))
    const big = await main.evaluate(`${mainWindow}.getBounds()`)
    check('toggleMaximize maximises the window', big.width > shape.bounds.width && big.height > shape.bounds.height, big)
    await H.until('the window-state callback', () => page.evaluate(() => window.__states.some((s) => s.maximized === true)))
    check('onWindowState told the page', true)
    await page.evaluate(() => window.objectDesktop.toggleMaximize())
    await H.until('restored', async () => !(await page.evaluate(() => window.objectDesktop.isMaximized())))
    // The window manager applies the size a moment after the state.
    await H.until('the size it had', async () =>
      JSON.stringify(await main.evaluate(`${mainWindow}.getBounds()`)) === JSON.stringify(shape.bounds))
    check('toggleMaximize again restores it', true, shape.bounds)
    await page.evaluate(() => window.objectDesktop.minimize())
    await H.until('minimised', () => main.evaluate(`${mainWindow}.isMinimized()`))
    check('minimize minimises the window', true)
    await main.evaluate(`${mainWindow}.restore()`)
    await H.until('shown again', async () => !(await main.evaluate(`${mainWindow}.isMinimized()`)))
  }
  check('isFullScreen answers', (await page.evaluate(() => window.objectDesktop.isFullScreen())) === false)

  // Real pointer events (X11 with xdotool): the frameless window's edges resize it, and the
  // shell's own right-click menu is asked for only where the page did not handle the click.
  if (wm.name && spawnSync('which', ['xdotool']).status === 0) {
    const pointer = (...args) => spawnSync('xdotool', args.map(String))
    const b = shape.bounds
    for (const [edge, x, y, dx, dy, grown] of [
      ['right', b.x + b.width - 2, b.y + 400, 80, 0, { ...b, width: b.width + 80 }],
      ['bottom', b.x + 500, b.y + b.height - 2, 0, 60, { ...b, height: b.height + 60 }],
      ['left', b.x + 1, b.y + 400, -50, 0, { ...b, x: b.x - 50, width: b.width + 50 }],
      ['top', b.x + 700, b.y + 1, 0, -30, { ...b, y: b.y - 30, height: b.height + 30 }],
    ]) {
      pointer('mousemove', x, y)
      await sleep(200)
      pointer('mousedown', 1)
      await sleep(150)
      pointer('mousemove_relative', '--', dx / 2, dy / 2)
      await sleep(150)
      pointer('mousemove_relative', '--', dx / 2, dy / 2)
      await sleep(150)
      pointer('mouseup', 1)
      const got = await H.until(`a resize from the ${edge} edge`, async () => {
        const now = await main.evaluate(`${mainWindow}.getBounds()`)
        return JSON.stringify(now) === JSON.stringify(grown) ? now : null
      }, { timeout: 5000 }).catch(() => null)
      check(`dragging the ${edge} edge resizes the frameless window`, got !== null, grown)
      await main.evaluate(`${mainWindow}.setBounds(${JSON.stringify(b)})`)
      await H.until('the size it had', async () =>
        JSON.stringify(await main.evaluate(`${mainWindow}.getBounds()`)) === JSON.stringify(b))
    }
    await main.evaluate(`(globalThis.__menus = 0, ${mainWindow}.webContents.on('context-menu', () => { globalThis.__menus += 1 }), 1)`)
    pointer('mousemove', b.x + 1000, b.y + 600)
    await sleep(200)
    pointer('click', 3)
    await H.until('the right click', async () => (await main.evaluate('globalThis.__menus')) === 1)
    await page.evaluate(() => {
      window.__handled = 0
      window.__handle = (event) => { window.__handled += 1; event.preventDefault() }
      document.addEventListener('contextmenu', window.__handle, true)
    })
    pointer('click', 3)
    await H.until('the handled right click', () => page.evaluate(() => window.__handled === 1))
    await sleep(300)
    check('the shell\'s right-click menu is asked for only where the page showed none',
      (await main.evaluate('globalThis.__menus')) === 1)
    await page.evaluate(() => document.removeEventListener('contextmenu', window.__handle, true))
  }

  check('setWindowButtons("hide") gives none', (await page.evaluate(() => window.objectDesktop.setWindowButtons('hide'))) === 'none')
  check('setWindowButtons("auto") gives custom on GNOME', (await page.evaluate(() => window.objectDesktop.setWindowButtons('auto'))) === 'custom')
  await page.evaluate(() => window.objectDesktop.setTheme({ mode: 'light', background: '#fafaf9', foreground: '#1c1917' }))
  await H.until('the theme', async () => (await main.evaluate('electron.nativeTheme.themeSource')) === 'light')
  check('setTheme sets the system side to the app\'s theme', true)

  // Links to other sites never load in the window.
  await page.evaluate(() => {
    const a = document.createElement('a')
    a.href = 'https://example.com/from-a-link'
    a.textContent = 'elsewhere'
    document.body.appendChild(a)
    a.click()
    a.remove()
  })
  await H.until('the link handed to the browser', () => browser.opened().includes('https://example.com/from-a-link'))
  check('a link to another site does not load in the window', page.url() === `http://127.0.0.1:${PORT}/`, page.url())
  check('window.open gives no second window', await page.evaluate(() => window.open('https://example.com/from-window-open') === null))
  await H.until('window.open handed to the browser', () => browser.opened().includes('https://example.com/from-window-open'))
  await page.evaluate(() => { window.open('file:///etc/passwd'); window.open(`${window.location.origin}/`) })
  await sleep(300)
  check('the window still shows the app, alone', page.url() === `http://127.0.0.1:${PORT}/` &&
    (await main.evaluate('electron.BrowserWindow.getAllWindows().length')) === 1, browser.opened())
  check('only web links went to the default browser', browser.opened().length === 3, browser.opened())

  // Keep on top: `objectapp` writes the stdin line, the shell opens the small window.
  const status = await page.evaluate(async () => (await fetch('/api/work/keep-on-top', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).status)
  check('POST /api/work/keep-on-top answers 204', status === 204, status)
  const focus = await H.until('the keep-on-top window', async () => {
    const all = await main.evaluate(`electron.BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).map((w) => ({
      title: w.getTitle(), size: w.getContentSize(), top: w.isAlwaysOnTop(), url: w.webContents.getURL(), loading: w.webContents.isLoading() }))`)
    return all.length === 2 && !all[1].loading && all[1].url.includes('mini=work') ? all[1] : null
  })
  check('the keep-on-top window: 360x470, always on top, "Object focus"',
    focus.size[0] === 360 && focus.size[1] === 470 && focus.top === true && focus.title === 'Object focus' &&
    focus.url === `http://127.0.0.1:${PORT}/?mini=work`, focus)
  await sleep(1500)
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true })
    await app.capture(path.join(SHOTS, 'main-window.png'), 0)
    // The whole screen, with the keep-on-top window over the frameless one (X11, ImageMagick).
    spawnSync('import', ['-window', 'root', path.join(SHOTS, 'screen-with-keep-on-top.png')])
  }
  await main.evaluate('electron.BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].close()')
  await H.until('the small window closed', async () => (await main.evaluate('electron.BrowserWindow.getAllWindows().length')) === 1)

  // Typing, then closing at once: the shell asks the page first and waits for its handler.
  await newNote(page, 'Closing')
  await main.evaluate(`${mainWindow}.setBounds({ x: 150, y: 110, width: 1100, height: 720 })`)
  await page.evaluate(() => {
    window.objectDesktop.onBeforeClose(() => new Promise((resolve) => {
      document.title = 'asked'
      setTimeout(resolve, 1500)
    }))
  })
  await page.keyboard.type('typed just before closing')
  closed = await app.closeWith(() => page.evaluate(() => { window.objectDesktop.close() }))
  const text = notes(space).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  check('text typed just before closing is in the file', text.includes('typed just before closing'), notes(space))
  check('the shell waited for the page\'s before-close handler', closed.ms >= 1500 && closed.ms < 3000, closed)
  check('objectapp exited and the port is free', closed.code === 0 && !(await H.listening(PORT)), closed)
  check('nothing was printed that holds a one-time link', !/_open|code=/.test(app.output.join('')))

  // -- 3. the next launch: the same place and size --------------------------------------------
  app = await H.launch({ ...base, env: env({ XDG_CURRENT_DESKTOP: 'GNOME' }) })
  ;({ page, main } = app)
  await present(page, '#root header')
  const restored = await main.evaluate(`${mainWindow}.getBounds()`)
  check('the size and position are restored on the next launch',
    JSON.stringify(restored) === JSON.stringify({ x: 150, y: 110, width: 1100, height: 720 }), restored)
  check('the theme told last time is remembered', (await main.evaluate('electron.nativeTheme.themeSource')) === 'light')
  if (wm.name) {
    await page.evaluate(() => window.objectDesktop.toggleMaximize())
    await H.until('maximised', () => page.evaluate(() => window.objectDesktop.isMaximized()))
  }
  // No handler this time: the page's own saves (pagehide, keep-alive requests) still land,
  // because the shell waits for requests on their way before it exits.
  // Choice 12: the shell has no menu bar on Linux and Windows, so Ctrl+N and Ctrl+U reach the app.
  await page.keyboard.press('Control+u')
  const overlay = await H.until('Add new content (Ctrl+U)', () => page.evaluate(() => {
    const el = document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')
    return el ? (el.getAttribute('aria-label') || el.textContent.trim().slice(0, 60) || el.getAttribute('role')) : null
  }))
  check('Ctrl+U reaches the app (Add new content)', true, overlay)
  await page.keyboard.press('Escape')
  await H.until('the overlay closed', () => page.evaluate(() =>
    document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') === null))
  await page.keyboard.press('Control+n')
  await caretInTitle(page)
  check('Ctrl+N reaches the app (New note)', true)
  await page.keyboard.type('Unhandled')
  await page.keyboard.press('Enter')
  await caretInText(page)
  await page.keyboard.type('typed with no handler')
  closed = await app.closeWith(() => page.evaluate(() => { window.objectDesktop.close() }))
  const unhandled = notes(space).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  check('with no handler the page\'s own last save still lands', unhandled.includes('typed with no handler'), closed)

  // -- 4. maximised comes back maximised; a handler that never answers is cut off at 3 s -------
  app = await H.launch({ ...base, env: env({ XDG_CURRENT_DESKTOP: 'GNOME' }) })
  ;({ page, main } = app)
  await present(page, '#root header')
  if (wm.name) {
    await H.until('maximised again', () => page.evaluate(() => window.objectDesktop.isMaximized()))
    check('a maximised window comes back maximised', true)
    await page.evaluate(() => window.objectDesktop.toggleMaximize())
    await H.until('restored', async () => !(await page.evaluate(() => window.objectDesktop.isMaximized())))
    const normal = await H.until('the size it had before', async () => {
      const b = await main.evaluate(`${mainWindow}.getBounds()`)
      return b.width === 1100 && b.height === 720 ? b : null
    })
    check('and restores to the size it had before', true, normal)
  }
  await page.evaluate(() => { window.objectDesktop.onBeforeClose(() => new Promise(() => {})) })
  closed = await app.closeWith(() => page.evaluate(() => { window.objectDesktop.close() }))
  check('a handler that never answers holds the window 3 seconds, no longer', closed.ms >= 3000 && closed.ms < 6000, closed)

  // -- 5. --frame system: the ordinary frame, nothing for the page to draw --------------------
  app = await H.launch({ ...base, env: env({ XDG_CURRENT_DESKTOP: 'GNOME' }), args: ['--frame', 'system'] })
  ;({ page, main } = app)
  await present(page, '#root header')
  bridge = await page.evaluate(() => ({ controls: window.objectDesktop.controls, framed: window.objectDesktop.framed }))
  check('--frame system: controls none, framed true', bridge.controls === 'none' && bridge.framed === true, bridge)
  const framedIds = (H.xprop('-root', '_NET_CLIENT_LIST') || '').match(/0x[0-9a-f]+/g) || []
  if (framedIds.length > 0 && wm.name) {
    const props = framedIds.map((id) => H.xprop('-id', id, '_MOTIF_WM_HINTS', '_NET_FRAME_EXTENTS')).join('\n')
    check('--frame system: the window manager draws its frame',
      !/_MOTIF_WM_HINTS\(_MOTIF_WM_HINTS\) = 0x2, 0x0, 0x0/.test(props) && !/_NET_FRAME_EXTENTS\(CARDINAL\) = 0, 0, 0, 0/.test(props), props.trim())
  }
  closed = await app.closeWith(() => page.evaluate(() => { window.objectDesktop.close() }))
  check('the framed window closes the same way', closed.code === 0, closed)

  // -- the state folder ------------------------------------------------------------------------
  const kept = filesUnder(path.join(stateDir, 'desktop'))
  check('window.json is in <state>/desktop', kept.includes(path.join(stateDir, 'desktop', 'window.json')))
  check('web storage is kept in <state>/desktop', kept.some((f) => f.includes('Local Storage')))
  const leaked = kept.filter((f) => {
    const data = fs.readFileSync(f).toString('latin1')
    return data.includes('_open?code=') || data.includes(`object-ui-${PORT}`)
  })
  check('no one-time link and no launch-key cookie was written to disk', leaked.length === 0, leaked)

  wm.stop()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length === 0) fs.rmSync(work, { recursive: true, force: true })
  process.exit(failed.length === 0 ? 0 : 1)
}

run().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
