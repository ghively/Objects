import type { ChangeEvent, ObjectDetail, ObjectSummary, SaveResult, SpaceInfo } from './types'

/** Any non-2xx response that is not a conflict or a read-only refusal. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 409: the file changed on disk since `baseVersion`. Nothing was written. */
export class ConflictError extends ApiError {
  readonly currentVersion: string
  constructor(currentVersion: string) {
    super(409, 'conflict')
    this.name = 'ConflictError'
    this.currentVersion = currentVersion
  }
}

/** 423: the object is read-only (for example, broken frontmatter). Nothing was written. */
export class ReadOnlyError extends ApiError {
  readonly reason: string
  constructor(reason: string) {
    super(423, reason)
    this.name = 'ReadOnlyError'
    this.reason = reason
  }
}

const BASE = '/api'

function qs(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function detailOf(data: unknown): Record<string, unknown> {
  // FastAPI wraps HTTPException payloads in {detail: ...}; accept both shapes.
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (d.detail && typeof d.detail === 'object') return d.detail as Record<string, unknown>
    return d
  }
  return {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await readJson(res)
  if (res.ok) return data as T
  const d = detailOf(data)
  if (res.status === 409) throw new ConflictError(String(d.currentVersion ?? ''))
  if (res.status === 423) throw new ReadOnlyError(String(d.reason ?? 'read-only'))
  throw new ApiError(res.status, typeof data === 'string' ? data : res.statusText)
}

type ChangeListener = (e: ChangeEvent) => void

const listeners = new Set<ChangeListener>()
let source: EventSource | null = null

function ensureSource() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource(`${BASE}/events`)
  source.addEventListener('change', (msg) => {
    let e: ChangeEvent
    try {
      e = JSON.parse((msg as MessageEvent<string>).data) as ChangeEvent
    } catch {
      return
    }
    for (const cb of [...listeners]) cb(e)
  })
}

export const api = {
  space(): Promise<SpaceInfo> {
    return request<SpaceInfo>('/space')
  },

  objects(type?: string): Promise<ObjectSummary[]> {
    return request<ObjectSummary[]>(`/objects${qs({ type })}`)
  },

  object(path: string): Promise<ObjectDetail> {
    return request<ObjectDetail>(`/object${qs({ path })}`)
  },

  /**
   * Save an object's body. Resolves with the new version (unchanged if the body was identical).
   * Rejects with `ConflictError` (409) or `ReadOnlyError` (423); neither writes the file.
   */
  saveBody(path: string, body: string, baseVersion: string): Promise<SaveResult> {
    return request<SaveResult>('/object/body', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, body, baseVersion }),
    })
  },

  /** Resolve a `[[link]]` to a path, or `null` when nothing matches (404). */
  async resolve(link: string, from?: string): Promise<string | null> {
    try {
      const r = await request<{ path: string }>(`/resolve${qs({ link, from })}`)
      return r.path
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },

  /** Show the object's file in the OS file manager (Explorer on Windows). */
  async reveal(path: string): Promise<void> {
    await request<unknown>('/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  },

  /** Subscribe to file changes pushed over SSE. Returns an unsubscribe function. */
  onChange(cb: ChangeListener): () => void {
    listeners.add(cb)
    ensureSource()
    return () => {
      listeners.delete(cb)
      if (listeners.size === 0 && source) {
        source.close()
        source = null
      }
    }
  },
}

export type Api = typeof api
