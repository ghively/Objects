// M24 Task 10: the Captures view's own small store (the board does not carry captures).
import { create } from 'zustand'
import { api } from '@/api/client'
import type { CaptureItem } from '@/api/types'

interface CapturesState {
  items: CaptureItem[]
  loaded: boolean
  load(): Promise<void>
  /** Fix pass H: the capture whose reply box the view opens on (a parked dump picked on Now). */
  replyTo: string | null
  reply(path: string | null): void
}

export const useCaptures = create<CapturesState>()((set) => ({
  items: [],
  loaded: false,
  replyTo: null,
  reply: (path) => set({ replyTo: path }),
  async load() {
    try {
      set({ items: await api.captureItems(), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
}))

export function resetCaptures(): void {
  useCaptures.setState({ items: [], loaded: false, replyTo: null })
}

/** New + Needs you (the view's badge). */
export function openCaptureCount(): number {
  return useCaptures.getState().items.filter((c) => c.status !== 'filed').length
}
