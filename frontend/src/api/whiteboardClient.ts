import { announceLocalChange, api, ApiError, CLIENT_ID, ReadOnlyError, RevisionConflictError } from './client'
import { announceSave } from '@/whiteboard/localSaves'
import type {
  BoardResponse,
  CreatedWhiteboard,
  WhiteboardData,
  WhiteboardSaveResult,
  WhiteboardSettings,
} from './whiteboardTypes'

const BASE = '/api'

const SETTING_KEYS = [
  'isSnappingToGrid',
  'isSnappingToNodes',
  'isShowingDots',
  'isZoomingOnScroll',
  'isEngineeringMode',
] as const satisfies readonly (keyof WhiteboardSettings)[]

/** FastAPI wraps `HTTPException` payloads in `{detail: {...}}`; the routes also answer flat. Accept both. */
function fieldsOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {}
  const b = body as Record<string, unknown>
  if (b.detail && typeof b.detail === 'object') return { ...b, ...(b.detail as Record<string, unknown>) }
  return b
}

function messageOf(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body) return body
  const f = fieldsOf(body)
  if (typeof f.detail === 'string') return f.detail
  if (typeof f.reason === 'string') return f.reason
  return fallback
}

/**
 * The whiteboard routes' own fetch helper (`api/client.ts`'s `request` is private): 409 throws
 * `RevisionConflictError(currentRevision)` (a `ConflictError`), 423 `ReadOnlyError(reason)`,
 * anything else non-2xx `ApiError(status, detail)`.
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (res.ok) return body as T
  const f = fieldsOf(body)
  if (res.status === 409) {
    const rev = f.currentRevision ?? f.currentVersion
    throw new RevisionConflictError(typeof rev === 'string' ? rev : '')
  }
  if (res.status === 423) {
    throw new ReadOnlyError(typeof f.reason === 'string' ? f.reason : messageOf(body, 'read-only'))
  }
  throw new ApiError(res.status, messageOf(body, res.statusText))
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

/** The `whiteboard` value of `ui.json`, keeping only the five known boolean keys. */
export function settingsOf(value: unknown): WhiteboardSettings {
  const out: WhiteboardSettings = {}
  if (!value || typeof value !== 'object') return out
  const v = value as Record<string, unknown>
  for (const key of SETTING_KEYS) {
    if (typeof v[key] === 'boolean') out[key] = v[key]
  }
  return out
}

export const whiteboardApi = {
  /** `GET /api/whiteboard`: the board (the empty board and `revision: ''` when no file exists). Writes nothing. */
  board(path: string): Promise<BoardResponse> {
    return request<BoardResponse>(`${BASE}/whiteboard?path=${encodeURIComponent(path)}`)
  },

  /**
   * `PUT /api/whiteboard`. `baseRevision` `''` creates the file. 409 → `RevisionConflictError(currentRevision)`.
   * M9: when the save stamped the board `.md`, this window hears a `changed` for it. The save is
   * also announced to the views of the board open in this window (`localSaves`), since the
   * server's `whiteboard` event for it carries our `CLIENT_ID` and is dropped as an echo: so a
   * board saved outside a board hook ("Add to whiteboard", "Turn into whiteboard") shows up in
   * them. A view that made the save sees its own revision in it and ignores it.
   */
  async saveBoard(path: string, board: WhiteboardData, baseRevision: string): Promise<WhiteboardSaveResult> {
    const res = await request<WhiteboardSaveResult>(
      `${BASE}/whiteboard`,
      json('PUT', { path, board, baseRevision, clientId: CLIENT_ID }),
    )
    if (res?.mdVersion) announceLocalChange(path, res.mdVersion)
    if (res?.revision !== undefined) announceSave({ path, version: res.revision, source: whiteboardApi })
    return res
  },

  /** `POST /api/whiteboards`: a new Whiteboard object (title blank → "Untitled", as M1). */
  createWhiteboard(title?: string): Promise<CreatedWhiteboard> {
    const body: Record<string, unknown> = { clientId: CLIENT_ID }
    if (title !== undefined) body.title = title
    return request<CreatedWhiteboard>(`${BASE}/whiteboards`, json('POST', body))
  },

  /** The canvas display settings from `ui.json` (`{}` when absent) and the ui revision. */
  async settings(): Promise<{ settings: WhiteboardSettings; revision: string }> {
    const res = await api.ui()
    return { settings: settingsOf((res.ui as Record<string, unknown>).whiteboard), revision: res.revision }
  },

  /**
   * `PUT /api/ui` with `{patch: {whiteboard}}` through `api.patchUi`, so the save is announced to
   * this window as a local `ui` event like every other `ui.json` write. 409 → `RevisionConflictError`.
   * The caller keeps `useUiStore.revision` current (see `useWhiteboardSettings`).
   */
  async saveSettings(
    settings: WhiteboardSettings,
    baseRevision: string,
  ): Promise<{ settings: WhiteboardSettings; revision: string }> {
    const res = await api.patchUi({ whiteboard: settings }, { baseRevision })
    return { settings: settingsOf(res?.ui?.whiteboard), revision: res?.revision ?? '' }
  },
}

export type WhiteboardApi = typeof whiteboardApi
