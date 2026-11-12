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

/** Real pointer and key events through xdotool (X11). */
const hasXdotool = () => spawnSync('which', ['xdotool']).status === 0
const xdo = (...args) => spawnSync('xdotool', args.map(String))

/** The middle of the first element matching `selector`, in screen coordinates (`bounds`: the window's). */
async function screenPoint(page, bounds, selector) {
  const r = await H.until(selector, () => page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const q = el.getBoundingClientRect()
    return q.width > 0 ? { x: q.x + q.width / 2, y: q.y + q.height / 2 } : null
  }, selector))
  return { x: Math.round(bounds.x + r.x), y: Math.round(bounds.y + r.y) }
}

/**
 * The middle of the top bar's widest free stretch (no button, tab, tab strip or field under it),
 * in the page's coordinates; null when there is none.
 */
function freeBarPoint(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.app-titlebar')
    const r = bar.getBoundingClientRect()
    const y = r.y + r.height / 2
    const free = (x) => {
      const el = document.elementFromPoint(x, y)
      return !!el && bar.contains(el) && getComputedStyle(el).webkitAppRegion === 'drag' &&
        !el.closest('button, [role=tab], [role=tablist], input, a, .app-no-drag')
    }
    let best = null
    let from = null
    for (let x = Math.ceil(r.x) + 1; x <= r.right; x += 2) {
      const ok = x < r.right && free(x)
      if (ok && from === null) from = x
      if (!ok && from !== null) {
        if (best === null || x - from > best[1] - best[0]) best = [from, x - 2]
        from = null
      }
    }
    return best === null ? null : { x: Math.round((best[0] + best[1]) / 2), y: Math.round(y), width: best[1] - best[0] }
  })
}

/** Press at (x, y) on the screen, move by (dx, dy) in steps, let go. */
async function pressAndMove(x, y, dx, dy) {
  xdo('mousemove', x, y)
  await sleep(200)
  xdo('mousedown', 1)
  await sleep(150)
  for (let i = 0; i < 4; i++) {
    xdo('mousemove_relative', '--', dx / 4, dy / 4)
    await sleep(80)
  }
  await sleep(150)
  xdo('mouseup', 1)
  await sleep(500)
}

/** Clicks the Settings > Appearance > "Window buttons" choice `name` with the pointer. */
async function pickWindowButtons(page, bounds, name) {
  const r = await H.until('the Window buttons choice', () => page.evaluate((n) => {
    const group = document.querySelector('[aria-label="Window buttons"]')
    if (!group) return null
    group.scrollIntoView({ block: 'center' })
    const el = [...group.querySelectorAll('[role=radio], button')].find((e) => e.textContent.trim() === n)
    const q = el.getBoundingClientRect()
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 }
  }, name))
  await sleep(200)
  const again = await page.evaluate((n) => {
    const el = [...document.querySelectorAll('[aria-label="Window buttons"] [role=radio], [aria-label="Window buttons"] button')].find((e) => e.textContent.trim() === n)
    const q = el.getBoundingClientRect()
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 }
  }, name) || r
  xdo('mousemove', Math.round(bounds.x + again.x), Math.round(bounds.y + again.y))
  await sleep(150)
  xdo('click', 1)
}

/**
 * Opens Settings at `section` (the sidebar's "Settings" button, then the section). Clicked in the
 * page: Playwright's own waits stall after the shell refused a navigation.
 */
async function openSettings(page, section) {
  await H.until('the Settings button', () => page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Settings"]')
    if (b) b.click()
    return !!b
  }))
  await H.until(`Settings > ${section}`, () => page.evaluate((name) => {
    const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === name)
    if (b) b.click()
    return !!b
  }, section))
  await sleep(400)
}

/**
 * On the note the window opens on: clicks into its Description field with the pointer (adding
 * it when the note has none), selects what is there and types `text` with real keys. The caret
 * stays in the field.
 */
async function typeDescription(page, main, text) {
  await present(page, '#root header')
  const show = page.getByRole('button', { name: 'Show properties' })
  if (await H.until('the note page', () => page.evaluate(() =>
    [...document.querySelectorAll('button')].some((x) => /^(Show|Hide) properties$/.test(x.getAttribute('aria-label') || ''))))) {
    if (await show.count()) await show.click()
  }
  const desc = page.getByRole('button', { name: 'Add description' })
  const field = await H.until('the Description field', () => page.evaluate(() => {
    const el = [...document.querySelectorAll('textarea, input, [contenteditable="true"]')].find((e) => /short summary/i.test(e.getAttribute('placeholder') || ''))
    if (!el) return null
    const q = el.getBoundingClientRect()
    return { x: q.x + 20, y: q.y + q.height / 2 }
  }), { timeout: 5000 }).catch(() => null)
  if (field === null && (await desc.count())) await desc.first().click()
  const at = field || await H.until('the Description field', () => page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const q = el.getBoundingClientRect()
    return { x: q.x + 20, y: q.y + q.height / 2 }
  }))
  const win = await main.evaluate(`${mainWindow}.getBounds()`)
  xdo('mousemove', Math.round(win.x + at.x), Math.round(win.y + at.y))
  await sleep(200)
  xdo('click', 1)
  await sleep(300)
  xdo('key', 'ctrl+a')
  xdo('type', '--delay', 15, text)
  await sleep(100)
}

/** The shell's main process under `objectapp` (`pid`), or null. */
function shellProcess(pid) {
  const found = H.commandLines(pid).find((l) => l.pid !== pid && /electron$/.test(l.argv[0] || '') &&
    !l.argv.some((a) => a.startsWith('--type=')))
  return found ? found.pid : null
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Presses Escape until no dialog is open (Settings, menus). */
async function closeDialogs(page) {
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate(() => document.querySelector('[role=dialog]') === null)) return
    await page.keyboard.press('Escape')
    await sleep(300)
  }
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
    'platform', 'setSpellCheckLanguage', 'setTheme', 'setWindowButtons', 'toggleMaximize']), keys)
  // The launch (the one-time link) is never on a command line, where other local users can read
  // it; the shell took it out of its own environment as it read it.
  const lines = H.commandLines(app.python.pid)
  check('no command line of objectapp or the shell holds the launch or its link',
    lines.length > 1 && lines.every((l) => !l.argv.some((a) => /_open|code=|object-launch|OBJECT_DESKTOP_LAUNCH/.test(a))),
    lines.length)
  const shellEnv = await main.evaluate('({ argv: process.argv, kept: "OBJECT_DESKTOP_LAUNCH" in process.env })')
  check('the shell\'s argv holds nothing of the link, and its environment no longer has the launch',
    !shellEnv.argv.some((a) => /_open|code=|object-launch/.test(a)) && shellEnv.kept === false, shellEnv.argv)
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

    // The top bar is the title bar: a press on its free part moves the window ...
    const free = await freeBarPoint(page)
    check('the top bar has a free part', free !== null, free)
    await pressAndMove(b.x + free.x, b.y + free.y, 120, 60)
    const moved = await main.evaluate(`${mainWindow}.getBounds()`)
    check('a press on the top bar\'s free part drags the window',
      moved.x > b.x + 40 && moved.y > b.y + 20 && moved.width === b.width && moved.height === b.height, moved)
    // ... a press on a bar button or the space switcher does not.
    for (const [what, selector] of [['a bar button (Back)', '.app-titlebar button[aria-label="Back"]'],
      ['the space switcher', '.app-titlebar button[aria-label^="Change space"]']]) {
      const before = await main.evaluate(`${mainWindow}.getBounds()`)
      const at = await screenPoint(page, before, selector)
      await pressAndMove(at.x, at.y, 120, 60)
      await page.keyboard.press('Escape')
      const after = await main.evaluate(`${mainWindow}.getBounds()`)
      check(`a press on ${what} does not drag the window`, JSON.stringify(after) === JSON.stringify(before), after)
    }
    await main.evaluate(`${mainWindow}.setBounds(${JSON.stringify(b)})`)
    await H.until('the size it had', async () =>
      JSON.stringify(await main.evaluate(`${mainWindow}.getBounds()`)) === JSON.stringify(b))

    // A double click on the free part maximises, and again restores; the Maximize button
    // follows (onWindowState).
    const label = () => page.evaluate(() =>
      [...document.querySelectorAll('[data-window-controls] button')].map((x) => x.getAttribute('aria-label')).join(' '))
    xdo('mousemove', b.x + free.x, b.y + free.y)
    await sleep(250)
    xdo('click', '--repeat', 2, '--delay', 80, 1)
    await H.until('maximised by a double click', () => main.evaluate(`${mainWindow}.isMaximized()`), { timeout: 5000 }).catch(() => null)
    check('a double click on the top bar maximises the window', await main.evaluate(`${mainWindow}.isMaximized()`))
    await H.until('the Restore button', async () => (await label()) === 'Minimize Restore Close', { timeout: 5000 }).catch(() => null)
    check('the maximised window shows Restore', (await label()) === 'Minimize Restore Close', await label())
    const big = await main.evaluate(`${mainWindow}.getBounds()`)
    const freeBig = (await freeBarPoint(page)) || free
    xdo('mousemove', big.x + freeBig.x, big.y + freeBig.y)
    await sleep(250)
    xdo('click', '--repeat', 2, '--delay', 80, 1)
    await H.until('restored by a double click', async () => !(await main.evaluate(`${mainWindow}.isMaximized()`)), { timeout: 5000 }).catch(() => null)
    await H.until('the size it had', async () =>
      JSON.stringify(await main.evaluate(`${mainWindow}.getBounds()`)) === JSON.stringify(b), { timeout: 5000 }).catch(() => null)
    check('a double click again restores it', JSON.stringify(await main.evaluate(`${mainWindow}.getBounds()`)) === JSON.stringify(b))
    check('the restored window shows Maximize', (await label()) === 'Minimize Maximize Close', await label())

    // The Linux buttons, by real clicks.
    const clickButton = async (name) => {
      const at = await screenPoint(page, await main.evaluate(`${mainWindow}.getBounds()`), `[data-window-controls] button[aria-label="${name}"]`)
      xdo('mousemove', at.x, at.y)
      await sleep(200)
      xdo('click', 1)
    }
    await clickButton('Maximize')
    await H.until('maximised by its button', () => main.evaluate(`${mainWindow}.isMaximized()`), { timeout: 5000 }).catch(() => null)
    check('a click on Maximize maximises the window', await main.evaluate(`${mainWindow}.isMaximized()`))
    check('the corner pixel of the maximised window is Close', await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth - 1, 0)
      return !!el && el.closest('button') !== null && el.closest('button').getAttribute('aria-label') === 'Close'
    }))
    await sleep(300)
    await clickButton('Restore')
    await H.until('restored by its button', async () => !(await main.evaluate(`${mainWindow}.isMaximized()`)), { timeout: 5000 }).catch(() => null)
    check('a click on Restore restores it', !(await main.evaluate(`${mainWindow}.isMaximized()`)))
    await H.until('the size it had', async () =>
      JSON.stringify(await main.evaluate(`${mainWindow}.getBounds()`)) === JSON.stringify(b), { timeout: 5000 }).catch(() => null)
    await clickButton('Minimize')
    await H.until('minimised by its button', () => main.evaluate(`${mainWindow}.isMinimized()`), { timeout: 5000 }).catch(() => null)
    check('a click on Minimize minimises it', await main.evaluate(`${mainWindow}.isMinimized()`))
    await main.evaluate(`${mainWindow}.restore()`)
    await H.until('shown again', async () => !(await main.evaluate(`${mainWindow}.isMinimized()`)))
    await main.evaluate(`${mainWindow}.setBounds(${JSON.stringify(b)})`)
    await H.until('the size it had', async () =>
      JSON.stringify(await main.evaluate(`${mainWindow}.getBounds()`)) === JSON.stringify(b))
  }

  check('setWindowButtons("hide") gives none', (await page.evaluate(() => window.objectDesktop.setWindowButtons('hide'))) === 'none')
  check('setWindowButtons("auto") gives custom on GNOME', (await page.evaluate(() => window.objectDesktop.setWindowButtons('auto'))) === 'custom')

  // The page tells the shell its theme on load and whenever it changes (the app's own toggle).
  const shellTheme = async () => ({
    mode: await main.evaluate('electron.nativeTheme.themeSource'),
    background: (await main.evaluate(`${mainWindow}.getBackgroundColor()`)).toLowerCase(),
  })
  const pageTheme = () => page.evaluate(() => {
    const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.querySelector('.app-titlebar')).backgroundColor)
    const hex = '#' + m.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    return { mode: document.documentElement.classList.contains('dark') ? 'dark' : 'light', background: hex }
  })
  let seen = await H.until('the theme told on load', async () => {
    const [a, p] = [await shellTheme(), await pageTheme()]
    return JSON.stringify(a) === JSON.stringify(p) ? a : null
  }, { timeout: 5000 }).catch(() => null)
  check('the page told the shell its theme on load', seen !== null && seen.mode === 'dark', seen || (await shellTheme()))
  await page.getByRole('button', { name: 'Light mode' }).click()
  seen = await H.until('the light theme', async () => {
    const [a, p] = [await shellTheme(), await pageTheme()]
    return a.mode === 'light' && JSON.stringify(a) === JSON.stringify(p) ? a : null
  }, { timeout: 5000 }).catch(() => null)
  check('switching the app to light tells the shell (mode and colour)', seen !== null, seen || (await shellTheme()))

  // "Spellcheck language" reaches the shell's spellchecker (never fetching a dictionary here).
  await main.evaluate("(electron.session.defaultSession.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/'), 1)")
  const spell = () => main.evaluate('electron.session.defaultSession.getSpellCheckerLanguages()')
  const systemLanguages = await spell()
  await openSettings(page, 'Editor')
  const field = page.getByRole('textbox', { name: 'Spellcheck language' })
  const setLanguage = async (tag) => {
    await field.scrollIntoViewIfNeeded()
    await field.click()
    await field.press('Control+a')
    await page.keyboard.type(tag)
    await field.press('Enter')
  }
  await setLanguage('fr-CA')
  const fr = await H.until('the French dictionary', async () => {
    const l = await spell()
    return l.length === 1 && l[0] === 'fr' ? l : null
  }, { timeout: 5000 }).catch(spell)
  check('Spellcheck language "fr-CA" gives the shell French (the same language)', JSON.stringify(fr) === '["fr"]', fr)
  await setLanguage('')
  await field.press('Backspace')
  await field.press('Enter')
  const back = await H.until('the system\'s languages', async () => {
    const l = await spell()
    return JSON.stringify(l) === JSON.stringify(systemLanguages) ? l : null
  }, { timeout: 5000 }).catch(spell)
  check('an empty Spellcheck language gives the system\'s languages again', back !== null && JSON.stringify(back) === JSON.stringify(systemLanguages), back)
  await closeDialogs(page)

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
  check('the default browser did not inherit the launch variable', !browser.inherited())

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

  // Settings > Appearance > "Window buttons": each choice takes effect at once and is saved.
  if (hasXdotool()) {
    await openSettings(page, 'Appearance')
    const now = await main.evaluate(`${mainWindow}.getBounds()`)
    const after = async (name, drawn) => {
      await pickWindowButtons(page, now, name)
      const ok = await H.until(`Window buttons: ${name}`, async () => {
        const has = await page.evaluate(() => document.querySelector('[data-window-controls]') !== null)
        const kept = JSON.parse(fs.readFileSync(path.join(stateDir, 'settings.json'), 'utf8')).windowButtons
        return has === drawn && kept === { Automatic: 'auto', Show: 'show', Hide: 'hide' }[name]
      }, { timeout: 5000 }).catch(() => false)
      check(`Window buttons "${name}": the buttons ${drawn ? 'show' : 'go'} at once and the choice is saved`, ok)
    }
    await after('Hide', false)
    await after('Show', true)
    await after('Automatic', true)
    await after('Hide', false)
    await closeDialogs(page)
  }

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
  check('the light theme came back (remembered, and told again by the page)',
    (await main.evaluate('electron.nativeTheme.themeSource')) === 'light' &&
    (await main.evaluate(`${mainWindow}.getBackgroundColor()`)).toLowerCase() === (await pageTheme()).background)
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await H.until('the dark theme', async () => (await main.evaluate('electron.nativeTheme.themeSource')) === 'dark', { timeout: 5000 }).catch(() => null)
  check('switching the app back to dark tells the shell', (await main.evaluate('electron.nativeTheme.themeSource')) === 'dark')
  if (hasXdotool()) {
    // "Hide" was chosen last time: the shell knew it before the page loaded.
    check('Window buttons "Hide" is honoured on the next launch before the page loads',
      (await page.evaluate(() => window.objectDesktop.controls)) === 'none' &&
      (await page.evaluate(() => document.querySelector('[data-window-controls]') === null)))
    await openSettings(page, 'Appearance')
    await pickWindowButtons(page, restored, 'Automatic')
    await H.until('the buttons back', () => page.evaluate(() => document.querySelector('[data-window-controls]') !== null), { timeout: 5000 }).catch(() => null)
    check('Window buttons "Automatic" brings the buttons back at once', await page.evaluate(() => document.querySelector('[data-window-controls]') !== null))
    await closeDialogs(page)
  }
  if (wm.name) {
    await page.evaluate(() => window.objectDesktop.toggleMaximize())
    await H.until('maximised', () => page.evaluate(() => window.objectDesktop.isMaximized()))
  }
  // The page's own before-close handler this time (desktop/beforeClose.ts), and the real Close
  // button: the corner pixel of the maximised window, the pointer resting on it while typing.
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
  const sentences = 'The first sentence is here. The second one follows it. The third ends the note.'
  const real = wm.name && hasXdotool()
  if (real) {
    // A press on a tab does not drag the window.
    const before = await main.evaluate(`${mainWindow}.getBounds()`)
    xdo('mousemove', before.x + before.width - 1, before.y)
    await sleep(300)
    const corner = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth - 1, 0)
      return el && el.closest('button') ? el.closest('button').getAttribute('aria-label') : null
    })
    check('the pointer rests on the corner pixel, which is Close', corner === 'Close', corner)
    xdo('type', '--delay', 15, 'Closing at once')
    xdo('key', 'Return')
    await caretInText(page)
    xdo('type', '--delay', 15, sentences)
    check('the bar is faded for typing as Close is clicked', await page.evaluate(() => document.documentElement.hasAttribute('data-typing')))
    closed = await app.closeWith(() => xdo('click', 1))
  } else {
    await page.keyboard.type('Closing at once')
    await page.keyboard.press('Enter')
    await caretInText(page)
    await page.keyboard.type(sentences)
    closed = await app.closeWith(() => page.evaluate(() => { window.objectDesktop.close() }))
  }
  const titled = notes(space).filter((f) => path.basename(f) === 'Closing at once.md')
  const written = titled.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  check(`a title and three sentences typed, then ${real ? 'the corner\'s Close clicked' : 'close()'} at once: all in the file`,
    titled.length === 1 && written.includes('title: Closing at once') && written.endsWith(sentences), written.slice(-200))
  check('the page\'s own handler answered: objectapp exited at once and the port is free',
    closed.code === 0 && closed.ms < 3000 && !(await H.listening(PORT)), closed)

  // -- 3b. a property typed, then the window manager's close (Alt+F4): focus never leaves the field
  if (real) {
    app = await H.launch({ ...base, env: env({ XDG_CURRENT_DESKTOP: 'GNOME' }) })
    ;({ page, main } = app)
    await typeDescription(page, main, 'Described just before closing')
    closed = await app.closeWith(() => xdo('key', 'alt+F4'))
    const described = fs.readFileSync(titled[0], 'utf8')
    check('a property typed just before the window manager\'s close (Alt+F4) is saved',
      /\ndescription: Described just before closing\n/.test(described) && closed.code === 0, described.slice(0, 400))
  }

  // -- 3c. a property typed, then `objectapp` is stopped by a signal (kill, a closed terminal) --
  if (real) {
    app = await H.launch({ ...base, env: env({ XDG_CURRENT_DESKTOP: 'GNOME' }) })
    ;({ page, main } = app)
    await typeDescription(page, main, 'Described just before SIGTERM')
    const shellPid = shellProcess(app.python.pid)
    closed = await app.closeWith(() => app.python.kill('SIGTERM'))
    const described = fs.readFileSync(titled[0], 'utf8')
    check('SIGTERM to objectapp while a property is typed: it is saved',
      /\ndescription: Described just before SIGTERM\n/.test(described), described.slice(0, 400))
    check('SIGTERM to objectapp: objectapp exits, the shell exits, the port is free',
      closed.code === 0 && shellPid !== null && !alive(shellPid) && !(await H.listening(PORT)), { ...closed, shellPid })
  }

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
