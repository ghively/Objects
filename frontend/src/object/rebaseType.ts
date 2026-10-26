/**
 * Three-way merge for type edits: the change from `base` to `next` (an edit the caller built
 * from the copy it saw) replayed onto `latest` (the copy as it is now, after earlier saves).
 *
 * Plain objects merge key by key; arrays of objects with an `id` merge by id (items added,
 * removed, changed or reordered in the edit); anything else the edit changed is taken from
 * `next`. What the edit did not touch keeps `latest`'s value, so two quick edits built from the
 * same stale copy never undo each other.
 */

type Plain = Record<string, unknown>

function isPlain(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined)
    const kb = Object.keys(b).filter((k) => b[k] !== undefined)
    return ka.length === kb.length && ka.every((k) => same(a[k], b[k]))
  }
  return false
}

function idOf(v: unknown): string | null {
  return isPlain(v) && typeof v.id === 'string' ? v.id : null
}

function isIdArray(v: unknown): v is Plain[] {
  return Array.isArray(v) && v.every((x) => idOf(x) !== null)
}

function rebaseIdArray(base: Plain[], next: Plain[], latest: Plain[]): Plain[] {
  const baseBy = new Map(base.map((x) => [x.id as string, x]))
  const nextBy = new Map(next.map((x) => [x.id as string, x]))
  const removed = new Set([...baseBy.keys()].filter((id) => !nextBy.has(id)))
  const commonNext = next.map((x) => x.id as string).filter((id) => baseBy.has(id))
  const commonBase = base.map((x) => x.id as string).filter((id) => nextBy.has(id))
  const reordered = commonNext.some((id, i) => id !== commonBase[i])

  let kept = latest.filter((x) => !removed.has(x.id as string))
  if (reordered) {
    const rank = new Map(commonNext.map((id, i) => [id, i]))
    const ranked = kept.filter((x) => rank.has(x.id as string))
    ranked.sort((a, b) => rank.get(a.id as string)! - rank.get(b.id as string)!)
    let r = 0
    kept = kept.map((x) => (rank.has(x.id as string) ? ranked[r++] : x))
  }
  const out = kept.map((x) => {
    const id = x.id as string
    const b = baseBy.get(id)
    const n = nextBy.get(id)
    return b && n ? (rebase(b, n, x) as Plain) : x
  })
  const have = new Set(out.map((x) => x.id as string))
  for (const [i, x] of next.entries()) {
    const id = x.id as string
    if (baseBy.has(id) || have.has(id)) continue
    // Insert before the first later item of `next` that is still there; else append.
    const follower = next.slice(i + 1).find((y) => have.has(y.id as string) && baseBy.has(y.id as string))
    const at = follower ? out.findIndex((y) => y.id === follower.id) : out.length
    out.splice(at, 0, x)
    have.add(id)
  }
  return out
}

export function rebase<T>(base: T, next: T, latest: T): T {
  if (same(base, next)) return latest
  if (isPlain(base) && isPlain(next) && isPlain(latest)) {
    const out: Plain = { ...latest }
    for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (same(base[k], next[k])) continue
      if (next[k] === undefined) delete out[k]
      else out[k] = rebase(base[k], next[k], latest[k])
    }
    return out as T
  }
  if (isIdArray(base) && isIdArray(next) && isIdArray(latest)) {
    return rebaseIdArray(base, next, latest) as T
  }
  return next
}
