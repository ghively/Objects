// The version-control routes (`/api/vcs/*`, backend `api_vcs.py`): status, turning it on and off,
// committing, the remote, the space's history and restoring. Its own small fetch helper, as
// `whiteboardClient.ts` has (`client.ts`'s `request` is private).
import { ApiError, CLIENT_ID, ConflictError } from './client'

const BASE = '/api/vcs'

export type VcsTarget = 'space' | 'state'

export interface VcsCommitInfo {
  sha: string
  short: string
  at: string
  message: string
}

export interface VcsRemoteStatus {
  name: string
  url: string | null
  branch: string
  autoPush: boolean
  ahead: number | null
  behind: number | null
  diverged: boolean
  neverPushed: boolean
  lastPush: string | null
  lastFetch: string | null
  blocked: string | null
}

export interface VcsStatus {
  target: VcsTarget
  gitAvailable: boolean
  enabled: boolean
  repository: boolean
  root: string
  name?: string
  branch?: string | null
  lastCommit?: VcsCommitInfo | null
  pending?: number
  nextCommitIn?: number | null
  foreignStaged?: number
  warning?: string | null
  error?: { at: string; message: string } | null
  busyOperation?: string | null
  remote?: VcsRemoteStatus | null
  remotes?: Record<string, string>
  ignoresObjectFolder?: boolean
  settings?: VcsSettings
}

export interface VcsSettings {
  commitDelaySeconds: number
  pushDelaySeconds: number
}

export interface VcsFileChange {
  status: string
  path: string
  oldPath?: string
}

export interface VcsCommit extends VcsCommitInfo {
  author: string
  files: VcsFileChange[]
}

export interface VcsFileDiff {
  path: string
  oldPath?: string
  status: string
  binary: boolean
  diff: string
  truncated: boolean
}

export interface VcsFileVersion extends VcsCommitInfo {
  author: string
  /** The object's path in that commit (it may have been renamed since). */
  path: string
  status: string
}

export interface EnableAllResult {
  path: string
  name: string
  ok: boolean
  message: string | null
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
  if (res.status === 409 && typeof d.currentVersion === 'string') throw new ConflictError(d.currentVersion)
  throw new ApiError(res.status, typeof d.detail === 'string' ? d.detail : res.statusText)
}

function body(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const vcsApi = {
  status(target: VcsTarget = 'space'): Promise<VcsStatus> {
    return call<VcsStatus>(`/status${qs({ target })}`)
  },
  enable(target: VcsTarget = 'space'): Promise<VcsStatus> {
    return call<VcsStatus>('/enable', body('POST', { target }))
  },
  disable(target: VcsTarget = 'space'): Promise<VcsStatus> {
    return call<VcsStatus>('/disable', body('POST', { target }))
  },
  enableAll(): Promise<{ spaces: EnableAllResult[] }> {
    return call('/enable-all', { method: 'POST' })
  },
  commit(target: VcsTarget = 'space'): Promise<{ commit: string | null; status: VcsStatus }> {
    return call('/commit', body('POST', { target }))
  },
  push(target: VcsTarget = 'space'): Promise<VcsStatus> {
    return call<VcsStatus>('/push', body('POST', { target }))
  },
  pull(target: VcsTarget = 'space'): Promise<VcsStatus> {
    return call<VcsStatus>('/fetch', body('POST', { target }))
  },
  setRemote(target: VcsTarget, url: string, branch?: string | null, autoPush?: boolean): Promise<VcsStatus> {
    return call<VcsStatus>('/remote', body('PUT', { target, url, branch: branch || null, autoPush }))
  },
  setAutoPush(target: VcsTarget, autoPush: boolean): Promise<VcsStatus> {
    return call<VcsStatus>('/remote', body('PUT', { target, url: '', autoPush }))
  },
  setSettings(patch: Partial<VcsSettings>): Promise<VcsSettings> {
    return call<VcsSettings>('/settings', body('PUT', patch))
  },
  log(skip = 0, limit = 50): Promise<{ commits: VcsCommit[]; more: boolean }> {
    return call(`/log${qs({ skip, limit })}`)
  },
  diff(sha: string, path?: string): Promise<{ sha: string; files: VcsFileDiff[] }> {
    return call(`/diff${qs({ sha, path })}`)
  },
  restore(sha: string): Promise<{ commit: string | null; changed: string[]; status: VcsStatus }> {
    return call('/restore', body('POST', { sha, clientId: CLIENT_ID }))
  },
  fileLog(path: string): Promise<VcsFileVersion[]> {
    return call<{ versions: VcsFileVersion[] }>(`/file-log${qs({ path })}`).then((r) => r?.versions ?? [])
  },
  file(path: string, sha: string, sourcePath?: string): Promise<{ sha: string; text: string }> {
    return call(`/file${qs({ path, sha, sourcePath })}`)
  },
  fileRestore(path: string, sha: string, baseVersion: string, sourcePath?: string): Promise<{ version: string; commit: string | null }> {
    return call('/file-restore', body('POST', { path, sha, sourcePath, baseVersion, clientId: CLIENT_ID }))
  },
}
