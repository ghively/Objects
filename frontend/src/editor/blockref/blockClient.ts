// The block-reference calls (M8 contract: `GET /api/block`, `GET /api/block/references`). Task 3
// owns `api/types.ts` and `api/client.ts` and adds `BlockInfo`, `api.block` and
// `api.blockReferences`; until it lands they are declared here (the contract's shapes, so they stay
// assignable both ways) and the calls prefer `api`'s methods when present, else call the routes.
import { api, ApiError } from '@/api/client'

export interface BlockInfo {
  path: string
  id: string
  markdown: string
  version: string
}

export interface BlockClient {
  block(path: string, id: string): Promise<BlockInfo>
  blockReferences(path: string, id: string): Promise<{ paths: string[] }>
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(`/api${url}`, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (res.ok) return data as T
  const detail = data && typeof data === 'object' ? (data as Record<string, unknown>).detail : undefined
  throw new ApiError(res.status, typeof detail === 'string' ? detail : res.statusText)
}

const q = (path: string, id: string) => `path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`

/** `api`'s calls (Task 3) when present, else the contract routes. Read lazily so test mocks apply. */
export const blockClient: BlockClient = {
  block: (path, id) => {
    const real = api as unknown as Partial<BlockClient>
    return real.block ? real.block(path, id) : get(`/block?${q(path, id)}`)
  },
  blockReferences: (path, id) => {
    const real = api as unknown as Partial<BlockClient>
    return real.blockReferences ? real.blockReferences(path, id) : get(`/block/references?${q(path, id)}`)
  },
}
