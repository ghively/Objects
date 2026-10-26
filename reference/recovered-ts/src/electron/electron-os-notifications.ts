/**
 * Show OS notification banners from the Electron main process.
 *
 * Electron 42+ delivers via UNNotification on macOS (same stack as our auth addon).
 *
 * Canonical pattern:
 *   const n = new Notification({ title, body })
 *   n.on('show' | 'failed' | 'click' | 'close', ...)
 *   n.show()
 *
 * Rules that matter in practice:
 * - Must call `.show()` — constructing alone does nothing.
 * - Keep a strong reference until `close`/`failed` or the object can be GC'd
 *   before the OS posts the banner (classic Electron footgun).
 * - On macOS, the app must be code-signed; unsigned builds emit `failed`.
 * - Prefer main-process Notification over renderer `new Notification()`.
 *
 * Do not import from `./electron.js` / `./electron-communication.js` here —
 * that circular dependency made esbuild emit illegal `await` in module init.
 */
import { BrowserWindow, Notification as ElectronNotification } from 'electron'
import { getOsNotificationAuthStatus } from './electron-notification-auth.js'
import { reportError } from './electron-utils.js'

export type ShowOsNotificationResult = {
  shown: boolean
  error?: string
  event?: 'show' | 'failed' | 'timeout'
}

/** Prevent GC of in-flight notifications before the OS has posted them. */
const retainedNotifications = new Set<Electron.Notification>()

function focusCapacitiesWindow(): BrowserWindow | undefined {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  const window = BrowserWindow.getFocusedWindow() ?? windows[0]
  if (!window) return undefined
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
  return window
}

/** Fire-and-forget main→renderer request (response is optional for this click path). */
function requestOpenOsNotification(window: BrowserWindow, notificationId: string) {
  window.webContents.send('main-to-render-request', {
    id: `os-notification-click-${Date.now()}`,
    key: 'openOsNotification',
    data: { notificationId },
  })
}

export async function showOsNotificationBanner(options: {
  notificationId: string
  title: string
  body: string
}): Promise<ShowOsNotificationResult> {
  if (!ElectronNotification.isSupported()) {
    return { shown: false, error: 'unsupported', event: 'failed' }
  }

  try {
    const auth = await getOsNotificationAuthStatus()
    if (auth.status === 'denied') {
      return { shown: false, error: 'os_auth_denied', event: 'failed' }
    }
  } catch (error) {
    if (error instanceof Error) reportError(error)
  }

  return await new Promise<ShowOsNotificationResult>((resolve) => {
    let settled = false
    const finish = (result: ShowOsNotificationResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    try {
      const notification = new ElectronNotification({
        title: options.title,
        body: options.body,
        silent: false,
      })

      retainedNotifications.add(notification)

      notification.on('show', () => {
        finish({ shown: true, event: 'show' })
      })

      notification.on('failed', (_event, error) => {
        retainedNotifications.delete(notification)
        finish({ shown: false, error: String(error), event: 'failed' })
      })

      notification.on('close', () => {
        retainedNotifications.delete(notification)
      })

      notification.on('click', () => {
        const window = focusCapacitiesWindow()
        if (!window) return
        requestOpenOsNotification(window, options.notificationId)
      })

      notification.show()

      setTimeout(() => {
        if (settled) return
        finish({
          shown: false,
          error: 'timeout_no_show_or_failed',
          event: 'timeout',
        })
        setTimeout(() => retainedNotifications.delete(notification), 30_000)
      }, 5000)
    } catch (error) {
      if (error instanceof Error) reportError(error)
      finish({
        shown: false,
        error: error instanceof Error ? error.message : String(error),
        event: 'failed',
      })
    }
  })
}
