import { z } from 'zod'
import { useStore } from '../composables/useStore.js'
import { NodeEncrypter } from './electron-encrypter.js'
import { ElectronStorage } from './electron-storage.js'

export const { store: settings } = useStore(
  'settings',
  z
    .object({
      zoom: z.number().default(1.0),
      isOpeningAtLogin: z.boolean().default(false),
      isOpeningAsHidden: z.boolean().default(false),
    })
    .default({
      zoom: 1.0,
      isOpeningAtLogin: false,
      isOpeningAsHidden: false,
    }),
  {
    storage: new ElectronStorage(),
    // The encryption is only being used to obfuscate the data, not to secure it.
    encrypter: new NodeEncrypter('9b05fe11371aa96c9ed6abb59dd47e0e'),
  },
  true
)

export function setZoomLevel(window: Electron.BrowserWindow, mode: 'in' | 'out' | 'reset') {
  const current = window.webContents.getZoomFactor()
  const update = mode === 'reset' ? 1.0 : current + (mode === 'in' ? 1 : -1) * 0.05

  if ((update >= 1.5 && mode === 'in') || (update <= 0.6 && mode === 'out')) return

  window.webContents.setZoomFactor(update)
  settings.value.zoom = update
}
