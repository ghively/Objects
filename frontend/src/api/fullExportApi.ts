// M31: the Full Export routes (`/api/full-export*`, backend `api_fullexport.py`): start a manual
// export of this space or of all spaces, follow its job, and read the automated export's status.
// Its own small fetch helper, as `vcsClient.ts` has (`client.ts`'s `request` is private); the
// launch-key cookie goes with every same-origin fetch.
import { ApiError } from './client'

const BASE = '/api/full-export'

export type FullExportScope = 'current' | 'all'

export interface FullExportSpaceResult {
  name: string
  /** The space's folder name inside the export folder. */
  folder: string
  objects: number
  media: number
}

export interface FullExportResult {
  /** The dated export folder, a full path. */
  folder: string
  spaces: FullExportSpaceResult[]
  objects: number
  media: number
}

export interface FullExportJob {
  id: string
  state: 'running' | 'done' | 'failed'
  scope: FullExportScope
  done: number
  total: number
  result: FullExportResult | null
  error: string | null
}

export interface FullExportAutoStatus {
  enabled: boolean
  scope: FullExportScope
  folder: string | null
  interval: 'daily' | 'weekly'
  lastRun: string | null
  lastFolder: string | null
  lastError: string | null
  nextRun: string | null
  /** Why an automated run can't happen now (the folder), or null. */
  blocked: string | null
  running: boolean
}

export interface FullExportStatus {
  running: FullExportJob | null
  auto: FullExportAutoStatus
}

export interface FullExportRequest {
  scope: FullExportScope
  folder?: string | null
  media?: boolean
  wikilinks?: boolean
  titleHeading?: boolean
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
  throw new ApiError(res.status, typeof d.detail === 'string' ? d.detail : res.statusText)
}

export const fullExportApi = {
  /** Start an export (202): the job as it starts. 422 a bad folder, 409 one is running. */
  async start(req: FullExportRequest): Promise<FullExportJob> {
    const res = await call<{ job: FullExportJob }>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    return res.job
  },
  job(id: string): Promise<FullExportJob> {
    return call<FullExportJob>(`/jobs/${encodeURIComponent(id)}`)
  },
  status(): Promise<FullExportStatus> {
    return call<FullExportStatus>('/status')
  },
}
