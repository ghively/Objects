import { FiltersEngine, Request, adsAndTrackingLists } from '@ghostery/adblocker'
import { app, session, type BrowserWindow, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WEB_RESOURCE_BROWSER_PARTITION } from '../electron-shared/web-resource-browser.model.js'

const SAFE_WEB_RESOURCE_PROTOCOLS = new Set(['https:', 'http:'])

let webResourceBlocker: FiltersEngine | undefined
let isWebResourceBlockerInitializing = false

function isSafeWebResourceUrl(url: string | undefined): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return SAFE_WEB_RESOURCE_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

function fromElectronDetails(details: Electron.OnBeforeRequestListenerDetails) {
  const { id, url, resourceType, referrer, webContentsId } = details
  return Request.fromRawDetails(
    webContentsId
      ? {
          _originalRequestDetails: details,
          requestId: `${id}`,
          sourceUrl: referrer,
          tabId: webContentsId,
          type: resourceType || 'other',
          url,
        }
      : {
          _originalRequestDetails: details,
          requestId: `${id}`,
          sourceUrl: referrer,
          type: resourceType || 'other',
          url,
        }
  )
}

async function writeAdblockCache(cachePath: string, buffer: Uint8Array) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, buffer)
}

async function initializeWebResourceAdBlocker() {
  if (isWebResourceBlockerInitializing || webResourceBlocker) return
  isWebResourceBlockerInitializing = true

  try {
    const fetchImpl = globalThis.fetch?.bind(globalThis)
    if (!fetchImpl) throw new Error('Fetch is not available in Electron main process')

    const cachePath = path.join(app.getPath('userData'), 'web-resource-browser-adblocker.bin')
    webResourceBlocker = await FiltersEngine.fromLists(
      fetchImpl,
      adsAndTrackingLists,
      {
        loadCosmeticFilters: false,
        loadGenericCosmeticsFilters: false,
        enableMutationObserver: false,
        enableHtmlFiltering: false,
      },
      {
        path: cachePath,
        read: fs.readFile,
        write: writeAdblockCache,
      }
    )
  } catch (error) {
    console.error('[WebResourceBrowser] Failed to initialize ad blocker:', error)
  } finally {
    isWebResourceBlockerInitializing = false
  }
}

function getAdblockResponse(details: Electron.OnBeforeRequestListenerDetails): Electron.CallbackResponse | undefined {
  if (!webResourceBlocker) return undefined

  const match = webResourceBlocker.match(fromElectronDetails(details))
  if (!match.match) return undefined

  if (match.redirect?.dataUrl) return { redirectURL: match.redirect.dataUrl }
  if (match.rewrite?.url) return { redirectURL: match.rewrite.url }
  return { cancel: true }
}

function isWebResourceBrowserContents(contents: WebContents) {
  try {
    return contents.session === session.fromPartition(WEB_RESOURCE_BROWSER_PARTITION)
  } catch {
    return false
  }
}

/**
 * Guest pages have no Node/preload and every other permission stays denied.
 * `fullscreen` is the HTML Fullscreen API (YouTube's expand control). It does
 * not grant camera, mic, screen capture, geolocation, clipboard, or files.
 * Chromium still requires a user gesture and keeps Esc as the exit.
 */
function isAllowedWebResourceBrowserPermission(permission: string) {
  return permission === 'fullscreen'
}

export function setupWebResourceBrowserSecurity(getMainWindow: () => BrowserWindow | undefined) {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const mainWindow = getMainWindow()
      const isHostedByMainWindow = !!mainWindow && contents.id === mainWindow.webContents.id
      const isWebResourceBrowser = params.partition === WEB_RESOURCE_BROWSER_PARTITION
      const isSafeUrl = isSafeWebResourceUrl(params.src)

      if (!isHostedByMainWindow || !isWebResourceBrowser || !isSafeUrl) {
        event.preventDefault()
        return
      }

      delete webPreferences.preload
      // @ts-expect-error Electron exposes preloadURL on this mutable object but not in all type versions.
      delete webPreferences.preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
      webPreferences.experimentalFeatures = false
      webPreferences.enableBlinkFeatures = undefined
    })

    contents.on('will-navigate', (event, url) => {
      if (!isWebResourceBrowserContents(contents)) return
      if (!isSafeWebResourceUrl(url)) event.preventDefault()
    })
  })
}

export function setupWebResourceBrowserSession() {
  const webResourceSession = session.fromPartition(WEB_RESOURCE_BROWSER_PARTITION)
  initializeWebResourceAdBlocker()

  webResourceSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isAllowedWebResourceBrowserPermission(permission))
  })

  webResourceSession.setPermissionCheckHandler((_webContents, permission) => {
    return isAllowedWebResourceBrowserPermission(permission)
  })

  webResourceSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({})
  })

  webResourceSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === 'mainFrame' && !isSafeWebResourceUrl(details.url)) {
      callback({ cancel: true })
      return
    }

    try {
      const adblockResponse = getAdblockResponse(details)
      if (adblockResponse) {
        callback(adblockResponse)
        return
      }
    } catch (error) {
      console.error('[WebResourceBrowser] Failed to evaluate ad blocker request:', error)
    }

    callback({})
  })
}
