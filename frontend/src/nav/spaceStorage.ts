/**
 * Per-space localStorage keys for the navigation stores (tabs, recent). Each store starts under its
 * old global key (`object.tabs`, `object.recent`); once the space root is known, the store is
 * switched to `<base>:<root>` and rehydrated. The old global key is migrated into the first space
 * that has no key of its own, then deleted, so it is carried over once and never leaks into a
 * second space.
 */
import type { StoreApi } from 'zustand'

/** The persist API zustand's `persist` middleware adds to a store (only what this module uses). */
interface PersistApi {
  /** Missing when zustand found no usable storage (pywebview's Linux private mode turns
   *  localStorage off); the store then works in memory only and these helpers do nothing. */
  persist?: {
    getOptions(): { name?: string }
    setOptions(o: { name: string }): void
    rehydrate(): Promise<void> | void
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the store keeps working in memory */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function spaceKey(base: string, root: string | null): string {
  return root ? `${base}:${root}` : base
}

/**
 * Point a persisted store at the key of `root` (`null`: back to the global key, for tests) and
 * load what is stored there. `empty` is the state to show when neither the space key nor the old
 * global key holds anything.
 */
export async function switchStoreSpace<S>(
  store: StoreApi<S> & PersistApi,
  base: string,
  root: string | null,
  empty: Partial<S>,
): Promise<void> {
  const persist = store.persist
  if (!persist) return
  const name = spaceKey(base, root)
  const current = persist.getOptions().name
  if (root) {
    const legacy = read(base)
    if (legacy !== null) {
      if (read(name) === null) write(name, legacy)
      remove(base)
    }
  }
  if (current !== name) persist.setOptions({ name })
  if (read(name) === null) {
    if (current !== name) store.setState(empty)
    return
  }
  await persist.rehydrate()
}

/** The `state` zustand's `persist` wrapped in a stored value, or null when it isn't one. */
function persistedState(raw: string | null): unknown {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { state?: unknown } | null
    return parsed && typeof parsed === 'object' ? (parsed.state ?? null) : null
  } catch {
    return null
  }
}

/** Whether every key of `patch` already holds the same value (or JSON-equal data) in `state`. */
function sameSlice<S>(patch: Partial<S>, state: S): boolean {
  return (Object.keys(patch) as (keyof S)[]).every((k) => {
    const a = patch[k]
    const b = state[k]
    return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)
  })
}

/**
 * Follow another window's writes to the store's key (the `storage` event never fires in the
 * window that wrote). `merge` gets what that window stored, what the key held before its write
 * (so its removals can be told from our own additions) and our state; it returns the change to
 * apply, or null. Our write of the merged state reaches the other window the same way, so both
 * converge. Returns the function that stops following (tests).
 */
export function followStorage<S>(
  store: StoreApi<S> & PersistApi,
  merge: (incoming: unknown, previous: unknown, current: S) => Partial<S> | null,
): () => void {
  const persist = store.persist
  if (typeof window === 'undefined' || !persist) return () => undefined
  const onStorage = (e: StorageEvent) => {
    if (e.key !== persist.getOptions().name) return
    const incoming = persistedState(e.newValue)
    if (incoming === null) return
    const state = store.getState()
    const patch = merge(incoming, persistedState(e.oldValue), state)
    // Only a real change is applied: `persist` writes the key on every setState, and a write that
    // differs from the other window's (each keeps its own `activeId`) wakes it in turn, endlessly.
    if (patch && !sameSlice(patch, state)) store.setState(patch)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
