// M31 lane F: Settings > Offline & Sync's local rows (backend `api_storage.py`): the Local Storage
// estimate and Clear media cache. Its own small fetch helper, as `vcsClient.ts` has
// (`client.ts`'s `request` is private); the launch-key cookie goes with every same-origin fetch.
// Neither call writes a note, so no `clientId` is sent (nothing is announced).
import { ApiError } from './client'

/** Bytes and files of one part. */
export interface StoragePart {
  bytes: number
  files: number
}

/** GET /api/storage */
export interface StorageEstimate {
  /** The space folder (notes, files, `.object/`), the cache left out. */
  space: StoragePart
  /** The rebuildable cache (`.object-cache`). */
  cache: StoragePart
  /** The app's own data for this space in the state folder (saved versions and the like). */
  state: StoragePart
  total: number
  cacheFolder: string
}

/** POST /api/storage/clear-media-cache: what was freed. */
export interface ClearedMediaCache {
  files: number
  bytes: number
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (res.ok) return data as T
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  throw new ApiError(res.status, typeof d.detail === 'string' ? d.detail : res.statusText)
}

export const laneFApi = {
  storage(): Promise<StorageEstimate> {
    return call<StorageEstimate>('/storage')
  },
  clearMediaCache(): Promise<ClearedMediaCache> {
    return call<ClearedMediaCache>('/storage/clear-media-cache', { method: 'POST' })
  },
}
