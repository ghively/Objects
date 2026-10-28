import { announceLocalChange, ApiError, CLIENT_ID, ReadOnlyError, RevisionConflictError } from '@/api/client'
import type { WhiteboardSaveResult } from '@/api/whiteboardTypes'
import type { InkResponse, InkStroke } from './types'

const BASE = '/api'

function detailOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    const d = b.detail ?? b.reason
    if (typeof d === 'string') return d
    if (d !== undefined) return JSON.stringify(d)
  }
  return fallback
}

/**
 * The ink routes' own fetch helper (`api/client.ts`'s `request` is private): 409 throws
 * `RevisionConflictError(currentRevision)`, 423 `ReadOnlyError(reason)`, anything else non-2xx
 * `ApiError(status, detail)`.
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  let body: unknown = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (res.ok) return body as T
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (res.status === 409) {
    const rev = b.currentRevision ?? b.currentVersion
    throw new RevisionConflictError(typeof rev === 'string' ? rev : '')
  }
  if (res.status === 423) {
    throw new ReadOnlyError(typeof b.reason === 'string' ? b.reason : detailOf(body, res.statusText || 'read-only'))
  }
  throw new ApiError(res.status, detailOf(body, typeof body === 'string' ? body : res.statusText))
}

export const inkClient = {
  load(path: string): Promise<InkResponse> {
    return request<InkResponse>(`${BASE}/whiteboard/ink?path=${encodeURIComponent(path)}`)
  },
  /**
   * M9: the result also carries the board `.md`'s stamp (`mdVersion`, `mdBaseVersion`); when the
   * save stamped it, this window hears a `changed` for it.
   */
  async save(path: string, strokes: InkStroke[], baseRevision: string): Promise<WhiteboardSaveResult> {
    const res = await request<WhiteboardSaveResult>(`${BASE}/whiteboard/ink`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, strokes, baseRevision, clientId: CLIENT_ID }),
    })
    if (res?.mdVersion) announceLocalChange(path, res.mdVersion)
    return res
  },
}

export type InkClient = typeof inkClient
