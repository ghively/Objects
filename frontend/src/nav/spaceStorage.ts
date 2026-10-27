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
  persist: {
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
  const name = spaceKey(base, root)
  const current = store.persist.getOptions().name
  if (root) {
    const legacy = read(base)
    if (legacy !== null) {
      if (read(name) === null) write(name, legacy)
      remove(base)
    }
  }
  if (current !== name) store.persist.setOptions({ name })
  if (read(name) === null) {
    if (current !== name) store.setState(empty)
    return
  }
  await store.persist.rehydrate()
}
