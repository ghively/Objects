// M24 Task 10: the Captures view's own small store (the board does not carry captures).
import { create } from 'zustand'
import { api } from '@/api/client'
import type { CaptureItem } from '@/api/types'

interface CapturesState {
  items: CaptureItem[]
  loaded: boolean
  load(): Promise<void>
}

export const useCaptures = create<CapturesState>()((set) => ({
  items: [],
  loaded: false,
  async load() {
    try {
      set({ items: await api.captureItems(), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
}))

export function resetCaptures(): void {
  useCaptures.setState({ items: [], loaded: false })
}

/** New + Needs you (the view's badge). */
export function openCaptureCount(): number {
  return useCaptures.getState().items.filter((c) => c.status !== 'filed').length
}
