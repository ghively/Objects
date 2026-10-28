// The block-reference calls (M8 contract: `GET /api/block`, `GET /api/block/references`), through
// `api/client.ts`. `BlockInfo` matches `api/types.ts`.
import { api } from '@/api/client'

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

/** `api`'s calls, read on each call so test mocks apply. */
export const blockClient: BlockClient = {
  block: (path, id) => api.block(path, id),
  blockReferences: (path, id) => api.blockReferences(path, id),
}
