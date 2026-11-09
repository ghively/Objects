// The open space's version-control status, shared by the sidebar line, Settings and the history
// page. Read with `refresh()`; the sidebar refreshes it every minute. A failed read (no server,
// a test without the route) leaves it null, so nothing shows.
import { create } from 'zustand'
import { vcsApi, type VcsStatus } from '@/api/vcsClient'

export interface VcsStatusState {
  space: VcsStatus | null
  refresh(): Promise<VcsStatus | null>
  set(status: VcsStatus): void
}

export const useVcsStatus = create<VcsStatusState>((set) => ({
  space: null,
  async refresh() {
    try {
      const s = await vcsApi.status('space')
      set({ space: s && typeof s === 'object' ? s : null })
      return s
    } catch {
      set({ space: null })
      return null
    }
  },
  set(status) {
    if (status.target === 'space') set({ space: status })
  },
}))

export const VCS_POLL_MS = 60_000
