// Labels that name the user's own platform: the file manager an object is revealed in is
// Explorer on Windows, Finder on macOS and "file manager" elsewhere. Read from the browser's
// platform hints at render time so the same build reads right everywhere.

export const REVEAL_LABELS = {
  windows: 'Reveal in Explorer',
  mac: 'Reveal in Finder',
  other: 'Show in file manager',
} as const

/** The reveal label for a platform string and user agent (exported for tests). */
export function revealLabelFor(platform: string, userAgent: string): string {
  const hint = `${platform} ${userAgent}`
  if (/win/i.test(platform) || /windows/i.test(userAgent)) return REVEAL_LABELS.windows
  if (/mac|iphone|ipad|ipod/i.test(hint)) return REVEAL_LABELS.mac
  return REVEAL_LABELS.other
}

/** The object menu's reveal label for the platform the app runs on. */
export function revealMenuLabel(): string {
  if (typeof navigator === 'undefined') return REVEAL_LABELS.other
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return revealLabelFor(nav.userAgentData?.platform || nav.platform || '', nav.userAgent || '')
}
