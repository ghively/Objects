// M23 Task 7: Now's scoring, energy matching and the pool (plan `2026-11-05-m23-work-section.md`,
// Contract `logic/`). Pure: no React, no I/O. Ported from the old dashboard where marked.
import type { Energy, StepKind, WorkBoardItem } from '@/api/types'

type Priority = 'Critical' | 'High' | 'Medium' | 'Low'

export const PRIORITY_WEIGHT: Record<Priority, number> = { Critical: 100, High: 60, Medium: 30, Low: 10 }
/** An item with no priority weighs this much (ported). */
export const NO_PRIORITY_WEIGHT = 20
/** Stale = untouched for more than this many days. */
export const STALE_DAYS = 7
export const STEP_ENERGY: Record<StepKind, Energy | null> = { question: 'low', approve: 'low', do: 'high', agent: null }
export const STEP_MINUTES: Record<StepKind, number> = { question: 5, approve: 2, do: 30, agent: 0 }

const DAY_MS = 24 * 3600 * 1000
const PRIORITIES: readonly Priority[] = ['Critical', 'High', 'Medium', 'Low']

const asPriority = (text: string | null | undefined): Priority | null => {
  const t = (text ?? '').trim().toLowerCase()
  return PRIORITIES.find((p) => p.toLowerCase() === t) ?? null
}

/** A ticket's Desk priority, else the item's own priority when it is one of the four, else null. */
export function effectivePriority(i: WorkBoardItem): Priority | null {
  if (i.ticket) {
    const desk = asPriority(i.ticket.deskPriority)
    if (desk) return desk
  }
  return asPriority(i.priority)
}

const touchedMs = (i: WorkBoardItem): number => {
  const t = new Date(i.lastTouched).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Whole days since the item was last touched. */
export function quietDays(i: WorkBoardItem, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - touchedMs(i)) / DAY_MS))
}

export function isStale(i: WorkBoardItem, now: Date): boolean {
  return !i.done && quietDays(i, now) > STALE_DAYS
}

export function score(i: WorkBoardItem, now: Date): number {
  const p = effectivePriority(i)
  const weight = p ? PRIORITY_WEIGHT[p] : NO_PRIORITY_WEIGHT
  const rank = i.rank ? Math.max(0, 25 - 2 * i.rank) : 0
  const recent = now.getTime() - touchedMs(i) < DAY_MS ? 15 : 0
  const notStarted = i.stage === 'notStarted' ? 25 : 0
  return weight + rank + recent - notStarted
}

/** Gene's turn: active, not parked, and `you`/`approve` with a current step, or `close` (ours). */
export function isYours(i: WorkBoardItem): boolean {
  if (i.done || i.stage === 'parked') return false
  if (i.turn === 'close') return true
  return (i.turn === 'you' || i.turn === 'approve') && i.current !== null
}

/** No energy or High: everything; Medium: anything but a high step; Low: low steps only (ported). */
export function energyMatches(i: WorkBoardItem, energy: Energy | null): boolean {
  if (energy === null || energy === 'high') return true
  const e = i.current ? STEP_ENERGY[i.current.kind] : null
  return energy === 'medium' ? e !== 'high' : e === 'low'
}

export interface FocusFilter { n: number; paths: ReadonlySet<string> }

/**
 * Now's pool, best first. A focus filter offers only that line's own work on Gene's turn, never a
 * fallback. Otherwise Gene's items, Not now last, by score, matched to energy, falling back to
 * the unfiltered list when nothing matches (ported).
 */
export function nowPool(
  items: WorkBoardItem[],
  o: { now: Date; energy: Energy | null; notNow: ReadonlySet<string>; focus: FocusFilter | null },
): WorkBoardItem[] {
  const yours = items.filter(isYours)
  const focus = o.focus
  if (focus) return yours.filter((i) => focus.paths.has(i.path)).sort((a, b) => score(b, o.now) - score(a, o.now))
  const pool = yours.sort(
    (a, b) => Number(o.notNow.has(a.path)) - Number(o.notNow.has(b.path)) || score(b, o.now) - score(a, o.now),
  )
  const matched = pool.filter((i) => energyMatches(i, o.energy))
  return matched.length ? matched : pool
}

/** The three after the top pick, and how many more are hidden on purpose. */
export function upNext(pool: WorkBoardItem[]): { shown: WorkBoardItem[]; hidden: number } {
  return { shown: pool.slice(1, 4), hidden: Math.max(0, pool.length - 4) }
}
