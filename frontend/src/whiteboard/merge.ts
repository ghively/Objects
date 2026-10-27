/**
 * Three-way merge of boards after a 409: what this window changed since `base` (the copy it
 * last loaded or saved) is replayed onto `remote` (the server's copy now).
 */
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { emptyBoard } from './model'

const RECORDS = ['nodes', 'edges', 'blocks'] as const

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Number.isNaN(a) && Number.isNaN(b)
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    if (a.length !== bb.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined)
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined)
  if (ak.length !== bk.length) return false
  for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false
  return true
}

function mergeRecord<V>(
  base: Record<string, V>,
  local: Record<string, V>,
  remote: Record<string, V>,
): Record<string, V> {
  const out: Record<string, V> = { ...remote }
  const keys = new Set([...Object.keys(base), ...Object.keys(local)])
  for (const k of keys) {
    const inLocal = Object.prototype.hasOwnProperty.call(local, k)
    const inBase = Object.prototype.hasOwnProperty.call(base, k)
    if (!inLocal && inBase) delete out[k] // removed here
    else if (inLocal && (!inBase || !deepEqual(base[k], local[k]))) out[k] = local[k] // added or changed here
  }
  return out
}

/**
 * Nodes, edges and blocks: keys added, changed or removed locally since `base` are applied to
 * `remote`. Other top-level keys: local when changed since `base`, else remote. Edges whose ends
 * no longer exist are dropped. `base` is `null` when the board had no file when it was loaded.
 */
export function mergeBoards(
  base: WhiteboardData | null,
  local: WhiteboardData,
  remote: WhiteboardData,
): WhiteboardData {
  const b = base ?? emptyBoard()
  const out: WhiteboardData = { ...remote }
  const top = new Set([...Object.keys(b), ...Object.keys(local), ...Object.keys(remote)])
  for (const k of top) {
    if ((RECORDS as readonly string[]).includes(k)) continue
    if (!deepEqual(b[k], local[k])) {
      if (local[k] === undefined) delete out[k]
      else out[k] = local[k]
    }
  }
  out.nodes = mergeRecord(b.nodes ?? {}, local.nodes ?? {}, remote.nodes ?? {})
  const edges = mergeRecord(b.edges ?? {}, local.edges ?? {}, remote.edges ?? {})
  for (const id of Object.keys(edges)) {
    const e = edges[id]
    if (!out.nodes[e.source] || !out.nodes[e.target]) delete edges[id]
  }
  out.edges = edges
  out.blocks = mergeRecord(b.blocks ?? {}, local.blocks ?? {}, remote.blocks ?? {})
  // A node or edge pointing at a block the other side removed would fail validation: keep its block.
  for (const owner of [...Object.values(out.nodes), ...Object.values(out.edges)]) {
    const id = owner.blockId
    if (id !== undefined && !out.blocks[id]) {
      const block = local.blocks?.[id] ?? remote.blocks?.[id] ?? b.blocks?.[id]
      if (block) out.blocks[id] = block
    }
  }
  return out
}
