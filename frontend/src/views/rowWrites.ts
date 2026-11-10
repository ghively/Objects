// Per-row write bookkeeping for layouts that edit rows in place (table, kanban). A layout's rows
// can lag behind its own writes (the parent may patch late, or not at all), so each write must
// carry the newest version this layout knows of, and a row's writes run one after another.
// M29: `syncedRefusal` is the refusal a layout says, before it runs a write, for a synced property
// (filled only through the API), in the same words the server answers.
import type { Row } from '@/api/types'
import { typeOf } from '@/links/linkIndex'
import { isSynced, SYNCED_TEXT } from '@/properties/synced'

export interface RowWrites {
  /**
   * Run `write` after the row's earlier writes, with the newest version known for it and the
   * newest copy of the row. The result's version is remembered, so a later write from a stale
   * row still sends the right one.
   */
  run<T extends { version: string }>(row: Row, write: (version: string, latest: Row) => Promise<T>): Promise<T>
  /**
   * Remember a fresh copy of a row (written or reloaded) as the newest one; with `stale`, that
   * older copy's version counts as superseded.
   */
  seen(row: Row, stale?: Row): void
}

/** M29: the refusal for writing `keys` of the row's object when one is synced, else null. */
export function syncedRefusal(row: Row, keys: Iterable<string>): string | null {
  const defs = typeOf(row.summary.type)?.propertyDefinitions ?? []
  for (const key of keys) {
    const def = defs.find((d) => d.key === key && isSynced(d))
    if (def?.synced) return SYNCED_TEXT.readOnly(def.name, def.synced.source)
  }
  return null
}

interface Known {
  version: string
  row?: Row
  /** Versions this layout has moved past (versions are content hashes, so one can come back). */
  stale: Set<string>
}

export function createRowWrites(): RowWrites {
  const known = new Map<string, Known>()
  const queue = new Map<string, Promise<unknown>>()

  const head = (row: Row): string => {
    const k = known.get(row.summary.path)
    return k && k.stale.has(row.version) ? k.version : row.version
  }
  const latest = (row: Row): Row => {
    const k = known.get(row.summary.path)
    return k?.row && k.stale.has(row.version) && k.row.version === k.version ? k.row : row
  }
  const advance = (path: string, from: string, to: string, row?: Row) => {
    const k = known.get(path) ?? { version: to, stale: new Set<string>() }
    if (from !== to) k.stale.add(from)
    k.stale.delete(to)
    k.version = to
    k.row = row && row.version === to ? row : k.row
    known.set(path, k)
  }

  return {
    run(row, write) {
      const path = row.summary.path
      const prev = queue.get(path) ?? Promise.resolve()
      const job = prev.then(async () => {
        const from = head(row)
        const res = await write(from, latest(row))
        advance(path, from, res.version)
        return res
      })
      queue.set(
        path,
        job.catch(() => undefined),
      )
      return job
    },
    seen(row, stale) {
      advance(row.summary.path, stale ? head(stale) : row.version, row.version, row)
    },
  }
}
