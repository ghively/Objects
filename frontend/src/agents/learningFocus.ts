// M18: the ledger entries a click on the chat's "Learning" line should highlight on the agent
// page (the Memory tab's and the Skills tab's History lists). The line sets it, then opens the tab.
import { create } from 'zustand'

export interface LearningFocusState {
  agentId: string | null
  entryIds: string[]
  set(agentId: string, entryIds: string[]): void
  clear(): void
}

export const useLearningFocus = create<LearningFocusState>()((set) => ({
  agentId: null,
  entryIds: [],
  set: (agentId, entryIds) => set({ agentId, entryIds: [...entryIds] }),
  clear: () => set({ agentId: null, entryIds: [] }),
}))

/** The entries to highlight for `agentId` (none when the focus is another agent's). */
export function useFocusedEntries(agentId: string): string[] {
  const focusAgent = useLearningFocus((s) => s.agentId)
  const ids = useLearningFocus((s) => s.entryIds)
  return focusAgent === agentId ? ids : NONE
}

const NONE: string[] = []
