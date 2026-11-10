/**
 * Offline & Sync's media rows (M31, catalog section 1): "Media loading (Everything | Required only)"
 * and "Clear media cache", as the page's media blocks (`editor/media/MediaView.tsx`) read them.
 *
 * - `mediaLoading: 'required'` (a device setting): images, video, audio and PDF embeds show a
 *   placeholder with "Load" until clicked; `everything` loads them at once, as before.
 * - The media token: Object keeps no media cache of its own, but the browser keeps copies of the
 *   files it fetched (`GET /api/file`). "Clear media cache" bumps this per-device token, and the
 *   media blocks add it to their file URLs (`&m=<token>`, which the server ignores), so each loads
 *   afresh from the space's files. Kept in localStorage (`object.mediaToken`) so it outlives a
 *   reload; without storage it lives for the session.
 */
import { useSyncExternalStore } from 'react'
import { useSettings } from './useSettings'

// our strings
export const MEDIA_TEXT = {
  load: 'Load',
  notLoaded: 'Not loaded yet (Media loading: Required only).',
} as const

const KEY = 'object.mediaToken'
const listeners = new Set<() => void>()

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

let token: string | null = readStored()

function emit() {
  for (const cb of [...listeners]) cb()
}

/** The current media token (`null` until the cache is first cleared). */
export function getMediaToken(): string | null {
  return token
}

/** A new token: every media block reloads its file past the browser's cache. */
export function bumpMediaToken(): string {
  token = Date.now().toString(36)
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // no storage: the token lasts for this session
  }
  emit()
  return token
}

/** Tests: forget the token. */
export function resetMediaToken(): void {
  token = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing stored
  }
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useMediaToken(): string | null {
  return useSyncExternalStore(subscribe, getMediaToken, getMediaToken)
}

/** A space file's URL with the token (a URL that isn't Object's `/api/file`, or no token: as given). */
export function withMediaToken(url: string, t: string | null): string {
  if (!t || !url.startsWith('/api/file?')) return url
  return `${url}&m=${encodeURIComponent(t)}`
}

/** Whether "Media loading" is "Required only". */
export function useMediaOnRequest(): boolean {
  return useSettings((s) => s.settings.mediaLoading === 'required')
}
