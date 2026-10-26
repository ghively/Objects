/**
 * Native OS notification authorization for the Electron main process.
 *
 * macOS: UNUserNotificationCenter via N-API addon — only for signed packaged
 * `io.capacities.app`. Unpackaged Electron returns `unsupported`.
 * Windows: ToastNotifier.Setting when a Windows addon loads; otherwise
 * Electron Notification.isSupported() (Wine CI cannot ship a Windows .node).
 * Linux: Notification.isSupported().
 *
 * Banner delivery uses Electron's Notification module (UNNotification on 42+),
 * not this addon.
 */
import { app, shell, Notification as ElectronNotification } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXPECTED_MAC_NOTIFICATION_BUNDLE_ID,
  enrichOsNotificationAuthSnapshot,
  isMacOsNotificationAuthSupported,
  parseOsNotificationAuthJson,
  resolveWindowsOsNotificationAuth,
  type OsNotificationAuthSnapshot,
  type OsNotificationAuthStatus,
  type OsNotificationBlockReason,
} from './electron-notification-auth-helpers.js'
import { reportError } from './electron-utils.js'

export type { OsNotificationAuthSnapshot, OsNotificationAuthStatus, OsNotificationBlockReason }

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

type NotificationAuthAddon = {
  getStatus: () => string | Promise<string>
  request: () => string | Promise<string>
}

let addon: NotificationAuthAddon | null | undefined

function resolveAddonPath(): string | undefined {
  const candidates = [
    // Packaged: Contents/Resources/bin (electron-builder extraResources)
    path.join(process.resourcesPath, 'bin', 'capacities_notification_auth.node'),
    // Unpackaged / electron-dist fallbacks (Windows/Linux local builds)
    path.join(__dirname, '../electron-assets/bin/capacities_notification_auth.node'),
    path.join(__dirname, '../../electron-assets/bin/capacities_notification_auth.node'),
    path.join(app.getAppPath(), 'electron-assets/bin/capacities_notification_auth.node'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

function getAddon(): NotificationAuthAddon | null {
  if (addon !== undefined) return addon

  const addonPath = resolveAddonPath()
  if (!addonPath) {
    addon = null
    return addon
  }

  try {
    addon = require(addonPath) as NotificationAuthAddon
  } catch (error) {
    if (error instanceof Error) reportError(error)
    addon = null
  }
  return addon
}

let cachedPackagedMacBundleId: string | null | undefined

function readPackagedMacBundleId(): string | null {
  if (process.platform !== 'darwin' || !app.isPackaged) return null
  if (cachedPackagedMacBundleId !== undefined) return cachedPackagedMacBundleId
  try {
    const infoPlist = path.join(path.dirname(process.execPath), '..', 'Info.plist')
    if (!fs.existsSync(infoPlist)) {
      cachedPackagedMacBundleId = null
      return null
    }
    const bundleId = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', infoPlist], {
      encoding: 'utf8',
    }).trim()
    cachedPackagedMacBundleId = bundleId || null
    return cachedPackagedMacBundleId
  } catch {
    cachedPackagedMacBundleId = null
    return null
  }
}

function unsupportedSnapshot(): OsNotificationAuthSnapshot {
  return enrichOsNotificationAuthSnapshot({ status: 'unsupported' }, { platform: process.platform })
}

function parseSnapshot(raw: string | undefined): OsNotificationAuthSnapshot {
  return parseOsNotificationAuthJson(raw, { platform: process.platform })
}

function applyWindowsAuthFallback(queried: OsNotificationAuthSnapshot | null): OsNotificationAuthSnapshot {
  const resolved = resolveWindowsOsNotificationAuth({
    queriedStatus: queried?.status,
    queriedBlockReason: queried?.blockReason,
    electronNotificationsSupported: ElectronNotification.isSupported(),
  })
  if (queried && resolved.status === queried.status) {
    return queried
  }
  return enrichOsNotificationAuthSnapshot(resolved, { platform: 'win32' })
}

async function readNativeSnapshot(
  reader: (native: NotificationAuthAddon) => string | Promise<string>
): Promise<OsNotificationAuthSnapshot | null> {
  const native = getAddon()
  if (!native) return null
  try {
    return parseSnapshot(await Promise.resolve(reader(native)))
  } catch (error) {
    if (error instanceof Error) reportError(error)
    return null
  }
}

function macAuthGate(): 'ok' | 'unsupported' {
  if (process.platform !== 'darwin') return 'ok'
  const bundleId = readPackagedMacBundleId()
  if (
    !isMacOsNotificationAuthSupported({
      isPackaged: app.isPackaged,
      bundleId,
    })
  ) {
    return 'unsupported'
  }
  return 'ok'
}

export async function getOsNotificationAuthStatus(): Promise<OsNotificationAuthSnapshot> {
  if (macAuthGate() === 'unsupported') {
    return unsupportedSnapshot()
  }

  if (process.platform === 'linux') {
    return enrichOsNotificationAuthSnapshot(
      { status: ElectronNotification.isSupported() ? 'granted' : 'unsupported' },
      { platform: 'linux' }
    )
  }

  const queried = await readNativeSnapshot((native) => native.getStatus())
  if (process.platform === 'win32') {
    return applyWindowsAuthFallback(queried)
  }
  return queried ?? unsupportedSnapshot()
}

/**
 * Requests notification authorization when the platform supports a prompt.
 * On Windows this re-checks status (no prompt). If previously denied on
 * macOS, status stays denied and the caller must open System Settings.
 * Unpackaged macOS returns unsupported.
 */
export async function requestOsNotificationAuth(): Promise<OsNotificationAuthSnapshot> {
  if (macAuthGate() === 'unsupported') {
    return unsupportedSnapshot()
  }

  if (process.platform === 'linux') {
    return getOsNotificationAuthStatus()
  }

  const queried = await readNativeSnapshot((native) => native.request())
  if (process.platform === 'win32') {
    return applyWindowsAuthFallback(queried)
  }
  return queried ?? unsupportedSnapshot()
}

/** Opens the OS notification settings pane, preferably for this app. */
export async function openOsNotificationSettingsPane(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      if (macAuthGate() === 'unsupported') return false
      const bundleId = EXPECTED_MAC_NOTIFICATION_BUNDLE_ID
      try {
        await shell.openExternal(`x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${bundleId}`)
      } catch {
        try {
          await shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension')
        } catch {
          await shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications')
        }
      }
      return true
    }
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:notifications')
      return true
    }
    if (process.platform === 'linux') {
      try {
        await shell.openExternal('gnome-control-center notifications')
        return true
      } catch {
        return false
      }
    }
    return false
  } catch (error) {
    if (error instanceof Error) reportError(error)
    return false
  }
}
