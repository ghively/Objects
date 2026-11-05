/**
 * M10: showing the AI chat. `revealAiChat` opens the active tab's AI chat side-panel entry (or
 * reveals the one already there: one per tab) and asks the chat to focus its input; `AiHost`
 * registers it as the store's reveal hook. The first-use notice is remembered per space under
 * `noticeKey(root)`.
 */
import { create } from 'zustand'
import { useTabs } from '@/nav/tabs'

/** A counter the chat panel watches: each bump moves focus to its input. */
export const useAiFocus = create<{ n: number; bump(): void }>((set, get) => ({
  n: 0,
  bump: () => set({ n: get().n + 1 }),
}))

/** Open (or reveal) the AI chat in the active tab's side panel and focus it. */
export function revealAiChat(): void {
  useTabs.getState().openInSidepanel({ kind: 'aiChat' })
  useAiFocus.getState().bump()
}

/** localStorage key of the first-use notice, per space. */
export function noticeKey(root: string | null | undefined): string {
  return `object.aiNotice:${root ?? ''}`
}

export function noticeSeen(root: string | null | undefined): boolean {
  try {
    return localStorage.getItem(noticeKey(root)) === '1'
  } catch {
    return false
  }
}

export function rememberNotice(root: string | null | undefined): void {
  try {
    localStorage.setItem(noticeKey(root), '1')
  } catch {
    // Storage refused (private mode): the notice shows again next time.
  }
}
