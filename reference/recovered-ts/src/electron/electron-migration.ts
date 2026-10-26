import { BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { rendererRequest } from './electron-communication.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function getLocalStorageToMigrate() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: true,
      enableBlinkFeatures: undefined,
    },
  })

  window.loadURL(`file://${path.join(__dirname, '../../dist', 'get-local-storage-to-migrate.html')}`)
  await new Promise<void>((resolve) => window.webContents.on('dom-ready', () => resolve()))
  const storage = await rendererRequest(window, 'getLocalStorage', undefined)

  window.close()
  return storage
}
