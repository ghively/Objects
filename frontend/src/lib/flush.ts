// Pending-save flushers (open editors register one). `flushAll` runs before a space switch.
type Flusher = () => Promise<void>

const flushers = new Set<Flusher>()

/** Register `fn`; the returned function unregisters it. */
export function registerFlusher(fn: Flusher): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

/** Await every registered flusher; errors are collected and rethrown after all of them ran. */
export async function flushAll(): Promise<void> {
  const results = await Promise.allSettled([...flushers].map((fn) => Promise.resolve().then(fn)))
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []))
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `${errors.length} pending saves failed`)
}
