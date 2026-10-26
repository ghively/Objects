import { shell } from 'electron'
import { extractXCallbackData, getXCallbackErrorUrl } from '../electron-shared/electron-shared.js'
import { CAPACITIES_PROTOCOL, createWindow, mainWindow, showAndFocusWindow } from './electron.js'
import { rendererRequest } from './electron-communication.js'

// X-CALLBACK-URL handling
const localCreateNewStorage: {
  [key: string]: boolean | undefined
} = {}

function runXCallbackError(
  errorCode: string,
  errorMessage: string,
  errorUrl: string | undefined,
  searchParamsObj: any
) {
  const responseUrl = getXCallbackErrorUrl(errorCode, errorMessage, errorUrl, searchParamsObj)
  if (!responseUrl) return true
  shell.openExternal(responseUrl)
  return true
}

export function handleXCallback(url: string): boolean {
  if (!url.startsWith(`${CAPACITIES_PROTOCOL}://x-callback-url/`)) return false

  const xCallbackData = extractXCallbackData(url.replace(`${CAPACITIES_PROTOCOL}://x-callback-url/`, ''))

  if ('error' in xCallbackData && xCallbackData.error) {
    const { error } = xCallbackData
    return runXCallbackError(error.errorCode, error.errorMessage, error.errorUrl, error.searchParamsObj)
  } else if ('data' in xCallbackData && xCallbackData.data) {
    const { data } = xCallbackData

    let waitFirst = false
    if (!mainWindow) {
      createWindow()
      waitFirst = true
    }
    if (!mainWindow) {
      return runXCallbackError('500', 'App not ready', data.errorUrl, data.data.searchParamsObj)
    }

    const processId = data.processId

    async function pingFrontend(_waitFirst = false) {
      if (!data) return
      for (let i = 0; i < 10; i++) {
        if (!!localCreateNewStorage[processId]) {
          delete localCreateNewStorage[processId]
          return
        }
        if (mainWindow) {
          const response = await rendererRequest(mainWindow, 'handleXCallbackAction', data)

          if (!response) {
            runXCallbackError('500', 'No response from app', undefined, undefined)
            return
          }

          const { successUrl, errorUrl, processId, type } = response

          if (processId) {
            localCreateNewStorage[processId] = true
          }

          if (errorUrl) {
            shell.openExternal(errorUrl)
          } else if (successUrl) {
            shell.openExternal(successUrl)
          }
          if (type !== 'getCurrentObject') {
            showAndFocusWindow(mainWindow)
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    pingFrontend(waitFirst)
    return true
  } else {
    throw new Error('invalid x-callback-url')
  }
}
