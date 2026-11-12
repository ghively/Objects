'use strict'
// The bridge: `window.objectDesktop`, the only thing the shell gives the page (the plan's
// Contract; typed in `frontend/src/desktop/bridge.ts`). The page runs sandboxed, with context
// isolation and no Node; this file may use only Electron's renderer modules.

const { contextBridge, ipcRenderer } = require('electron')

// Asked once, synchronously, so `platform`, `controls` and `framed` are plain values the
// moment the page's first script runs.
const info = ipcRenderer.sendSync('object-desktop:info')

let beforeClose = null
const stateListeners = new Set()

ipcRenderer.on('object-desktop:window-state', (_event, state) => {
  for (const cb of [...stateListeners]) cb(state)
})

// The shell is about to close the window: let the page save, then answer. The shell waits for
// this answer or 3 seconds, whichever comes first.
ipcRenderer.on('object-desktop:before-close', async () => {
  try {
    if (beforeClose) await beforeClose()
  } catch {
    // a failed save must not keep the window open
  } finally {
    ipcRenderer.send('object-desktop:before-close-done')
  }
})

contextBridge.exposeInMainWorld('objectDesktop', {
  platform: info.platform,
  controls: info.controls,
  framed: info.framed === true,
  minimize: () => { ipcRenderer.send('object-desktop:minimize') },
  toggleMaximize: () => { ipcRenderer.send('object-desktop:toggle-maximize') },
  close: () => { ipcRenderer.send('object-desktop:close') },
  isMaximized: () => ipcRenderer.invoke('object-desktop:is-maximized'),
  isFullScreen: () => ipcRenderer.invoke('object-desktop:is-full-screen'),
  onWindowState: (cb) => {
    stateListeners.add(cb)
    return () => { stateListeners.delete(cb) }
  },
  setTheme: (theme) => { ipcRenderer.send('object-desktop:set-theme', theme) },
  onBeforeClose: (handler) => {
    beforeClose = handler
    return () => { if (beforeClose === handler) beforeClose = null }
  },
  setWindowButtons: (value) => ipcRenderer.invoke('object-desktop:set-window-buttons', value),
})
