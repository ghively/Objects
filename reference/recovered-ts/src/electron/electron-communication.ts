import { ipcMain, type BrowserWindow } from 'electron'
import type {
  ElectronCommunicationMainToRendererRequest,
  ElectronCommunicationRendererToMainRequest,
} from '../electron-shared/electron-communication.model.js'
import { languageKeys } from '../shared-logic/models/general.model.js'
import { deleteCookie, getCookie, setCookie } from './electron-cookies.js'
import { chooseExportFolder, openExportFolder } from './electron-export.js'
import { startLocalApi } from './electron-local-api.js'
import { getSystemAudioAvailability, startSystemAudioCapture, stopSystemAudioCapture } from './electron-system-audio.js'
import { startMeetingDetection, stopMeetingDetection } from './electron-meeting-detector.js'
import { getLocalStorageToMigrate } from './electron-migration.js'
import {
  getOsNotificationAuthStatus,
  openOsNotificationSettingsPane,
  requestOsNotificationAuth,
} from './electron-notification-auth.js'
import { showOsNotificationBanner } from './electron-os-notifications.js'
import { syncSpellCheckerLanguage as applySpellCheckerLanguage } from './electron-spellchecker.js'
import { getDeviceInfo } from './electron-utils.js'
import {
  clearStorageData,
  copyToClipboard,
  downloadFromUrl,
  focusMainWindow,
  getAppleRemindersAccess,
  getLoadingPath,
  getWindowSize,
  handleActionQueueElement,
  handleMenuCommand,
  mainWindow,
  openFilePathOnDevice,
  readTextFromClipboard,
  runVersionUpdate,
  setThemeKey,
  updateInAppState,
} from './electron.js'
import i18n from './i18n/i18next.config.js'

class IpcMainToRenderHandler {
  pendingRequests: Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>

  constructor() {
    this.pendingRequests = new Map()
    this.setupResponseHandler()
  }

  setupResponseHandler() {
    ipcMainHandle('main-to-render-response', (_event, { id, data, error }) => {
      const pendingRequest = this.pendingRequests.get(id)
      if (!pendingRequest) {
        console.error('Pending request not found', id)
        return
      }
      const { resolve, reject } = pendingRequest
      this.pendingRequests.delete(id)

      if (error) {
        reject(new Error(error))
      } else {
        resolve(data)
      }
    })
  }

  async sendToRenderer<T extends keyof ElectronCommunicationMainToRendererRequest>({
    window,
    key,
    data,
  }: {
    window: BrowserWindow
    key: T
    data: ElectronCommunicationMainToRendererRequest[T]['inData']
  }): Promise<ElectronCommunicationMainToRendererRequest[T]['outData']> {
    const id = (Date.now() + Math.random()).toString()

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })

      window.webContents.send('main-to-render-request', {
        id,
        key,
        data,
      })

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          console.error('App request timeout', id)
          reject(new Error('App request timeout'))
        }
      }, 35000)
    })
  }
}

const ipcMainToRenderHandler = new IpcMainToRenderHandler()

export function rendererRequest<T extends keyof ElectronCommunicationMainToRendererRequest>(
  window: BrowserWindow,
  key: T,
  data: ElectronCommunicationMainToRendererRequest[T]['inData']
): Promise<ElectronCommunicationMainToRendererRequest[T]['outData']> {
  return ipcMainToRenderHandler.sendToRenderer({ window, key, data }) as Promise<
    ElectronCommunicationMainToRendererRequest[T]['outData']
  >
}

export async function handleIpcActionElement<T extends keyof ElectronCommunicationRendererToMainRequest>(
  messageKey: T,
  inData: ElectronCommunicationRendererToMainRequest[T]['inData']
): Promise<ElectronCommunicationRendererToMainRequest[T]['outData']> {
  type Handler<T extends keyof ElectronCommunicationRendererToMainRequest> = (
    inData: ElectronCommunicationRendererToMainRequest[T]['inData']
  ) =>
    | Promise<ElectronCommunicationRendererToMainRequest[T]['outData'] | undefined | void>
    | ElectronCommunicationRendererToMainRequest[T]['outData']
    | undefined
    | void

  const handlers: { [K in keyof ElectronCommunicationRendererToMainRequest]: Handler<K> } = {
    runMenuCommand: handleMenuCommand,
    getLoadingPath,
    setLocale: (language) => {
      if (languageKeys.find((key) => key === language)) i18n.changeLanguage(language)
    },
    syncSpellCheckerLanguage: ({ requested }) => applySpellCheckerLanguage(requested),
    setThemeKey,
    getCookie,
    setCookie,
    deleteCookie,
    runVersionUpdate,
    getDeviceInfo,
    focusMainWindow,
    updateInAppState,
    downloadFromUrl,
    openFilePathOnDevice,
    copyToClipboard,
    readTextFromClipboard,
    getWindowSize,
    clearStorageData,
    handleActionQueueElement,
    getAppleRemindersAccess,
    chooseExportFolder,
    openExportFolder,
    startLocalApi,

    // System Audio Capture
    getSystemAudioAvailability,
    startSystemAudioCapture: async () => {
      if (!mainWindow) {
        return { success: false, error: 'No main window' }
      }
      return await startSystemAudioCapture(mainWindow)
    },
    stopSystemAudioCapture,

    // Meeting Detection
    startMeetingDetection: () => {
      if (mainWindow) {
        startMeetingDetection(mainWindow)
      }
    },
    stopMeetingDetection,
    getLocalStorageToMigrate,

    // OS notification authorization + banners
    getOsNotificationAuthStatus: async () => await getOsNotificationAuthStatus(),
    requestOsNotificationAuth: async () => await requestOsNotificationAuth(),
    openOsNotificationSettings: async () => await openOsNotificationSettingsPane(),
    showOsNotification: async (data) => await showOsNotificationBanner(data),
  }

  const handler = handlers[messageKey]
  if (handler) {
    // Do not use `|| undefined` — falsy results like `false` must be preserved.
    return (await handler(inData)) as ElectronCommunicationRendererToMainRequest[T]['outData']
  } else {
    console.error('not implemented', messageKey, inData)
    throw new Error('notImplemented')
  }
}

export function ipcMainOn(channel: string, listener: (event: Electron.IpcMainEvent, ...args: any[]) => void) {
  ipcMain.on(channel, (event, ...args) => {
    listener(event, ...args)
  })
}

export function ipcMainHandle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) {
  ipcMain.handle(channel, async (event, ...args) => {
    // console.debug('ipcMainHandle', channel, args)
    return await listener(event, ...args)
  })
}

// SETUP
ipcMainHandle('renderer-to-main-request', async (_event, payload) => {
  const { key, data } = payload
  return await handleIpcActionElement(key, data)
})
