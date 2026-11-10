// M31 lane D2: the definition-history routes (backend `api_history.py` lists and reads a type's,
// collection's or saved query's kept versions; `api_definition_history.py` restores one). Its own
// small fetch helper, as `vcsClient.ts` has (`client.ts`'s `request` is private).
import { ApiError, ConfirmRequiredError, ReadOnlyError, RevisionConflictError } from './client'

const BASE = '/api/history/definition'

/** The definitions that keep versions and have a page to restore them from. */
export type DefinitionKind = 'types' | 'collections' | 'queries'

/** One kept version of a definition file, newest first (`number` counts from the oldest, 1). */
export interface DefinitionVersion {
  id: string
  number: number
  at: string
  size: number
}

export interface DefinitionVersionContent {
  id: string
  text: string | null
}

export interface DefinitionRestoreResult {
  /** The definition file's new revision. */
  revision: string
  /** Objects the save rewrote to follow the definition (a type's renamed or removed properties). */
  rewritten: string[]
  skipped: { path: string; reason: string }[]
}

/** The definition's file in the space (`.object/<kind>/<id>.json`). */
export function definitionPath(kind: DefinitionKind, id: string): string {
  return `.object/${kind}/${id}.json`
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (res.ok) return data as T
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const detail = typeof d.detail === 'string' ? d.detail : res.statusText
  if (res.status === 409) throw new RevisionConflictError(String(d.currentRevision ?? ''))
  if (res.status === 428) throw new ConfirmRequiredError(detail || 'Confirmation required', Number(d.affected ?? 0))
  if (res.status === 423) throw new ReadOnlyError(String(d.reason ?? detail))
  throw new ApiError(res.status, detail)
}

export const definitionHistoryApi = {
  async versions(path: string): Promise<DefinitionVersion[]> {
    const res = await call<{ versions: DefinitionVersion[] }>(`?path=${encodeURIComponent(path)}`)
    return Array.isArray(res?.versions) ? res.versions : []
  },
  version(path: string, id: string): Promise<DefinitionVersionContent> {
    return call(`/version?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`)
  },
  /**
   * Put a version back. 409 `RevisionConflictError` (changed since `baseRevision`), 428
   * `ConfirmRequiredError` (a type version that removes values: send again with `confirm`).
   */
  restore(path: string, id: string, baseRevision: string, confirm = false): Promise<DefinitionRestoreResult> {
    return call('/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id, baseRevision, confirm }),
    })
  },
}
