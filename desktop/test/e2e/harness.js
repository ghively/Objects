'use strict'
// Helpers for shell.e2e.js: start the real back end with `objectapp --window electron`, and
// look at the shell it starts. Nothing here is used by the app.
//
// The shell is started by Python, not by the test, so the test reaches it over the Chromium
// debugging ports: a wrapper executable (found through ELECTRON_OVERRIDE_DIST_PATH, which
// `objectapp` honours as the electron package does) adds `--remote-debugging-port` (the page,
// driven by Playwright) and `--inspect` (the main process), and `--no-sandbox` when the test
// runs as root (containers). The app itself never passes any of these.

const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..', '..')
const DESKTOP = path.join(REPO, 'desktop')

function requirePlaywright() {
  const places = [process.env.OBJECT_E2E_PLAYWRIGHT, 'playwright', path.join(REPO, 'frontend', 'node_modules', 'playwright'),
    '/opt/node-tools/node_modules/playwright'].filter(Boolean)
  for (const place of places) {
    try {
      return require(place)
    } catch {
      // try the next place
    }
  }
  throw new Error('Playwright was not found. Set OBJECT_E2E_PLAYWRIGHT to its folder (node_modules/playwright).')
}

function realElectron() {
  const pkg = path.join(DESKTOP, 'node_modules', 'electron')
  const name = fs.readFileSync(path.join(pkg, 'path.txt'), 'utf8').trim()
  return path.join(pkg, 'dist', name)
}

/** A folder holding an `electron` wrapper that adds the debugging ports. */
function wrapperDist(dir, { cdpPort, inspectPort }) {
  fs.mkdirSync(dir, { recursive: true })
  const flags = [`--remote-debugging-port=${cdpPort}`, `--inspect=${inspectPort}`]
  if (typeof process.getuid === 'function' && process.getuid() === 0) flags.unshift('--no-sandbox')
  const file = path.join(dir, 'electron')
  fs.writeFileSync(file, `#!/bin/sh\nexec "${realElectron()}" ${flags.join(' ')} "$@"\n`)
  fs.chmodSync(file, 0o755)
  return dir
}

/**
 * A folder with a fake `xdg-open` that records what the shell hands to the default browser, and
 * whether the launch variable (OBJECT_DESKTOP_LAUNCH, which holds the one-time link) reached it.
 */
function fakeBrowser(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const log = path.join(dir, 'opened.txt')
  const leaks = path.join(dir, 'inherited.txt')
  const file = path.join(dir, 'xdg-open')
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$1" >> "${log}"\n` +
    `if [ -n "\${OBJECT_DESKTOP_LAUNCH+set}" ]; then printf 'inherited\\n' >> "${leaks}"; fi\n`)
  fs.chmodSync(file, 0o755)
  const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [])
  return { dir, opened: () => lines(log), inherited: () => lines(leaks).length > 0 }
}

/** The command lines of `pid` and every process under it (Linux, /proc). */
function commandLines(pid) {
  const out = []
  const walk = (p) => {
    try {
      out.push({ pid: p, argv: fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0').filter(Boolean) })
    } catch {
      return
    }
    let kids = []
    try {
      kids = fs.readFileSync(`/proc/${p}/task/${p}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)
    } catch {
      // no children listed
    }
    for (const k of kids) walk(Number(k))
  }
  walk(pid)
  return out
}

function pythonCommand() {
  if (process.env.OBJECT_E2E_PYTHON) return [process.env.OBJECT_E2E_PYTHON]
  return ['uv', 'run', '--directory', REPO, 'python']
}

function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

async function until(what, check, { timeout = 20000, every = 100 } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, every))
  }
}

/** A CDP session with the shell's main process (its `--inspect` port). */
async function mainProcess(inspectPort) {
  const targets = await until('the main process inspector', async () => {
    try {
      return await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json()
    } catch {
      return null
    }
  })
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let next = 0
  const waiting = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const done = waiting.get(message.id)
    if (done) {
      waiting.delete(message.id)
      done(message)
    }
  })
  /** Evaluates `expression` in the main process (`electron` is in scope); awaits promises. */
  async function evaluate(expression) {
    const id = ++next
    const answer = new Promise((resolve) => waiting.set(id, resolve))
    socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: {
        expression: `(async () => { const electron = process.mainModule.require('electron'); return (${expression}) })()`,
        awaitPromise: true,
        returnByValue: true,
      },
    }))
    const message = await answer
    if (message.error || message.result.exceptionDetails) {
      throw new Error(`main process: ${JSON.stringify(message.error || message.result.exceptionDetails)}`)
    }
    return message.result.result.value
  }
  return { evaluate, close: () => socket.close() }
}

/**
 * Starts `objectapp --window electron` on `space` and attaches to its window.
 * Returns `{ page, main, browser, python, exited, output, port }`.
 */
async function launch({ space, stateDir, port, work, env = {}, args = [] }) {
  const { chromium } = requirePlaywright()
  const cdpPort = port + 100
  const inspectPort = port + 200
  const dist = wrapperDist(path.join(work, 'dist'), { cdpPort, inspectPort })
  const [command, ...first] = pythonCommand()
  const output = []
  const python = spawn(command, [...first, '-m', 'objectapp', '--space', space, '--port', String(port),
    '--window', 'electron', ...args], {
    cwd: REPO,
    env: {
      ...process.env,
      PYTHONPATH: [path.join(REPO, 'backend'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      OBJECT_STATE_DIR: stateDir,
      ELECTRON_OVERRIDE_DIST_PATH: dist,
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  python.stdout.on('data', (chunk) => output.push(String(chunk)))
  python.stderr.on('data', (chunk) => output.push(String(chunk)))
  let exitCode = null
  const exited = new Promise((resolve) => python.once('exit', (code, signal) => {
    exitCode = code === null ? `signal ${signal}` : code
    resolve(exitCode)
  }))
  const stillRunning = () => {
    if (exitCode !== null) throw new Error(`objectapp exited (${exitCode}):\n${output.join('')}`)
  }
  const browser = await until('the window', async () => {
    stillRunning()
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
    } catch {
      return null
    }
  }, { timeout: 40000, every: 250 })
  const page = await until('the app page', () => {
    stillRunning()
    return browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(`http://127.0.0.1:${port}/`))
  })
  const main = await mainProcess(inspectPort)
  /** A PNG of a window's page (`index` in creation order), taken by the shell itself. */
  async function capture(file, index = 0) {
    const png = await main.evaluate(`electron.BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[${index}]
      .webContents.capturePage().then((image) => image.toPNG().toString('base64'))`)
    fs.writeFileSync(file, Buffer.from(png, 'base64'))
  }
  /**
   * Runs `trigger` (what closes the window) and waits for `objectapp` to exit. The inspector is
   * let go first: a main process with a debugger attached waits for it at exit.
   */
  async function closeWith(trigger, { timeout = 20000 } = {}) {
    main.close()
    const started = Date.now()
    await Promise.resolve(trigger()).catch(() => {})
    const code = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('timeout'), timeout))])
    await browser.close().catch(() => {})
    if (code === 'timeout') {
      python.kill('SIGKILL')
      throw new Error(`objectapp did not exit within ${timeout} ms of the window closing:\n${output.join('')}`)
    }
    return { code, ms: Date.now() - started }
  }
  return { page, main, browser, python, exited, output, port, capture, closeWith, exitCode: () => exitCode }
}

function xprop(...args) {
  const result = spawnSync('xprop', args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout : null
}

/** Starts a window manager when none runs (xvfb has none; maximise and minimise need one). */
function ensureWindowManager() {
  const root = xprop('-root', '_NET_SUPPORTING_WM_CHECK')
  if (root === null) return { stop() {}, name: null }
  if (/window id # 0x/.test(root)) return { stop() {}, name: 'the session\'s' }
  if (spawnSync('which', ['openbox']).status !== 0) return { stop() {}, name: null }
  const wm = spawn('openbox', [], { stdio: 'ignore' })
  return { stop: () => wm.kill(), name: 'openbox' }
}

module.exports = {
  REPO, DESKTOP, launch, until, listening, fakeBrowser, commandLines, xprop, ensureWindowManager,
  tmpdir: (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
}
