/**
 * The media token "Clear media cache" bumps (M31, Offline & Sync). Object keeps no media cache of
 * its own, but the browser keeps copies of the files it fetched (`GET /api/file`). "Clear media
 * cache" bumps this per-device token, and every space file URL carries it (`api.fileUrl` adds it,
 * `&m=<token>`, which the server ignores), so each image, video, audio and PDF loads afresh from
 * the space's files. Kept in localStorage (`object.mediaToken`) so it outlives a reload; without
 * storage it lives for the session.
 *
 * This module imports nothing of the app (`api/client.ts` reads it); `settings/mediaLoading.ts`
 * re-exports it with the "Media loading" setting.
 */
import { useSyncExternalStore } from 'react'

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

/** A new token: every space file URL changes, so the files load past the browser's cache. */
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

/** The token, re-rendering when it changes (so a shown file's URL follows "Clear media cache"). */
export function useMediaToken(): string | null {
  return useSyncExternalStore(subscribe, getMediaToken, getMediaToken)
}

/**
 * A space file's URL with the token `t` (a URL that isn't Object's `/api/file`, or no token: as
 * given). A URL that already carries a token gets `t` in its place.
 */
export function withMediaToken(url: string, t: string | null): string {
  if (!t || !url.startsWith('/api/file?')) return url
  return `${url.replace(/&m=[^&]*/, '')}&m=${encodeURIComponent(t)}`
}
