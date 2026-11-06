// M23 Task 7: Your queues, by the current step (plan `2026-11-05-m23-work-section.md`). Pure.
import type { WorkBoardItem } from '@/api/types'
import { score } from './scoring'

export type QueueKey = 'answer' | 'do' | 'approve' | 'agent'

const queueOf = (i: WorkBoardItem): QueueKey | null => {
  const s = i.current
  if (!s) return null
  if (s.kind === 'question') return 'answer'
  if (s.kind === 'do') return 'do'
  if (s.kind === 'agent') return 'agent'
  return s.state === 'approved' ? 'agent' : 'approve'
}

/** Question → answer, Do → do, open Approve → approve, Agent or approved Approve → agent; by score. */
export function queues(items: WorkBoardItem[], now: Date): Record<QueueKey, WorkBoardItem[]> {
  const out: Record<QueueKey, WorkBoardItem[]> = { answer: [], do: [], approve: [], agent: [] }
  for (const i of items) {
    if (i.done) continue
    const q = queueOf(i)
    if (q) out[q].push(i)
  }
  for (const k of Object.keys(out) as QueueKey[]) out[k].sort((a, b) => score(b, now) - score(a, now))
  return out
}
