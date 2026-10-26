/**
 * Pure helpers for Electron OS notification authorization.
 * Kept free of Electron/Node so unit tests stay hermetic.
 */

export type OsNotificationAuthStatus = 'notDetermined' | 'granted' | 'denied' | 'unsupported'
export type OsNotificationBlockReason = 'user' | 'application' | 'policy' | 'manifest' | 'unknown'

export type OsNotificationAuthSnapshot = {
  status: OsNotificationAuthStatus
  blockReason?: OsNotificationBlockReason
  canOpenSettings: boolean
  canRequest: boolean
  /** Optional diagnostics from the native addon (packaged macOS). */
  authorizationStatus?: string
  alertSetting?: string
  notificationCenterSetting?: string
  soundSetting?: string
  bundleId?: string
}

export const EXPECTED_MAC_NOTIFICATION_BUNDLE_ID = 'io.capacities.app'

/**
 * macOS System Settings state is only truthful for signed packaged Capacities.
 * Unpackaged Electron must not guess.
 */
export function isMacOsNotificationAuthSupported(options: { isPackaged: boolean; bundleId?: string | null }): boolean {
  if (!options.isPackaged) return false
  if (!options.bundleId) return false
  return options.bundleId === EXPECTED_MAC_NOTIFICATION_BUNDLE_ID
}

/**
 * Windows toast query is best-effort. CI Wine builds cannot ship a Windows
 * `.node`, and CreateToastNotifier can fail even when Electron can still post
 * banners. Fall back to Electron Notification availability — same as Linux.
 * Honor a real granted / denied / notDetermined from a working addon.
 * Never apply this on macOS.
 */
export function resolveWindowsOsNotificationAuth(input: {
  queriedStatus?: OsNotificationAuthStatus
  queriedBlockReason?: OsNotificationBlockReason
  electronNotificationsSupported: boolean
}): { status: OsNotificationAuthStatus; blockReason?: OsNotificationBlockReason } {
  if (input.queriedStatus === 'denied') {
    return { status: 'denied', blockReason: input.queriedBlockReason ?? 'unknown' }
  }
  if (input.queriedStatus === 'granted' || input.queriedStatus === 'notDetermined') {
    return { status: input.queriedStatus }
  }
  return { status: input.electronNotificationsSupported ? 'granted' : 'unsupported' }
}

/**
 * Map Apple UNNotificationSettings fields to Capacities status.
 * Authorized/provisional only count as granted when alerts are enabled.
 */
export function mapMacUnNotificationSettings(input: {
  authorizationStatus: 'notDetermined' | 'denied' | 'authorized' | 'provisional' | 'ephemeral' | string
  alertSetting: 'enabled' | 'disabled' | 'notSupported' | string
}): { status: OsNotificationAuthStatus; blockReason?: OsNotificationBlockReason } {
  const auth = input.authorizationStatus
  if (auth === 'notDetermined') return { status: 'notDetermined' }
  if (auth === 'denied') return { status: 'denied', blockReason: 'user' }

  if (auth === 'authorized' || auth === 'provisional' || auth === 'ephemeral') {
    if (input.alertSetting === 'disabled') {
      return { status: 'denied', blockReason: 'user' }
    }
    return { status: 'granted' }
  }

  return { status: 'unsupported' }
}

export function enrichOsNotificationAuthSnapshot(
  partial: {
    status: OsNotificationAuthStatus
    blockReason?: OsNotificationBlockReason
    authorizationStatus?: string
    alertSetting?: string
    notificationCenterSetting?: string
    soundSetting?: string
    bundleId?: string
  },
  options: { platform: NodeJS.Platform | string }
): OsNotificationAuthSnapshot {
  const { status, blockReason } = partial
  const diagnostics = {
    authorizationStatus: partial.authorizationStatus,
    alertSetting: partial.alertSetting,
    notificationCenterSetting: partial.notificationCenterSetting,
    soundSetting: partial.soundSetting,
    bundleId: partial.bundleId,
  }

  if (options.platform === 'linux') {
    if (status === 'unsupported') {
      return { status: 'unsupported', canOpenSettings: false, canRequest: false, ...diagnostics }
    }
    return { status: 'granted', canOpenSettings: false, canRequest: false, ...diagnostics }
  }

  if (options.platform === 'win32') {
    return {
      status,
      blockReason: status === 'denied' ? (blockReason ?? 'unknown') : undefined,
      canOpenSettings: status !== 'unsupported',
      canRequest: false,
      ...diagnostics,
    }
  }

  // darwin / default
  if (status === 'unsupported') {
    return { status: 'unsupported', canOpenSettings: false, canRequest: false, ...diagnostics }
  }

  return {
    status,
    blockReason: status === 'denied' ? (blockReason ?? 'user') : undefined,
    // notDetermined: Capacities is not in System Settings yet — requesting auth registers it.
    // Open Settings is only useful after a decision (denied) or when Allow was turned off later.
    canOpenSettings: status === 'denied' || status === 'granted',
    canRequest: status === 'notDetermined',
    ...diagnostics,
  }
}

export function parseOsNotificationAuthJson(
  raw: string | undefined,
  options: { platform: NodeJS.Platform | string }
): OsNotificationAuthSnapshot {
  try {
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    const status =
      parsed?.status === 'granted' ||
      parsed?.status === 'denied' ||
      parsed?.status === 'notDetermined' ||
      parsed?.status === 'unsupported'
        ? parsed.status
        : 'unsupported'

    const blockReason =
      parsed?.blockReason === 'user' ||
      parsed?.blockReason === 'application' ||
      parsed?.blockReason === 'policy' ||
      parsed?.blockReason === 'manifest' ||
      parsed?.blockReason === 'unknown'
        ? parsed.blockReason
        : undefined

    return enrichOsNotificationAuthSnapshot(
      {
        status,
        blockReason,
        authorizationStatus: typeof parsed?.authorizationStatus === 'string' ? parsed.authorizationStatus : undefined,
        alertSetting: typeof parsed?.alertSetting === 'string' ? parsed.alertSetting : undefined,
        notificationCenterSetting:
          typeof parsed?.notificationCenterSetting === 'string' ? parsed.notificationCenterSetting : undefined,
        soundSetting: typeof parsed?.soundSetting === 'string' ? parsed.soundSetting : undefined,
        bundleId: typeof parsed?.bundleId === 'string' ? parsed.bundleId : undefined,
      },
      options
    )
  } catch {
    return enrichOsNotificationAuthSnapshot({ status: 'unsupported' }, options)
  }
}
