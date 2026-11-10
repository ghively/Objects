/**
 * M29: the type of the last object created through any create path, per viewer and per space
 * (localStorage `object.lastType:<space root>`, holding `{"typeId": string | null}`). It feeds the
 * suggested type's fallback and is never sent to the server. A missing, garbled or unreadable
 * stored value reads as null; when storage is unavailable the store keeps working in memory.
 */
import { create } from 'zustand'
import { spaceKey } from '@/nav/spaceStorage'

const BASE = 'object.lastType'

interface LastTypeState {
  typeId: string | null
  set(typeId: string): void
}

let key: string = BASE

function readStored(k: string): string | null {
  try {
    const raw = localStorage.getItem(k)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const id = (parsed as { typeId?: unknown }).typeId
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
}

function writeStored(k: string, typeId: string | null): void {
  try {
    localStorage.setItem(k, JSON.stringify({ typeId }))
  } catch {
    /* storage unavailable: memory only */
  }
}

export const useLastType = create<LastTypeState>()((set) => ({
  typeId: null,
  set(typeId: string) {
    set({ typeId })
    writeStored(key, typeId)
  },
}))

/** Point the store at `root`'s key (`null`: the global key, for tests) and load its value. */
export async function setLastTypeSpace(root: string | null): Promise<void> {
  key = spaceKey(BASE, root)
  useLastType.setState({ typeId: readStored(key) })
}
