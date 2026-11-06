// M23 Task 7: Everything's sort (plan `2026-11-05-m23-work-section.md`). Pure.
import type { Stage, Turn, WorkBoardItem } from '@/api/types'
import { STAGE_LABELS, TURN_LABELS } from '@/api/types'
import { effectivePriority, PRIORITY_WEIGHT, quietDays, score } from './scoring'

export type EverythingKey = 'type' | 'ticketId' | 'title' | 'area' | 'stage' | 'turn' | 'priority' | 'quietDays' | 'score'

const STAGE_ORDER = Object.keys(STAGE_LABELS) as Stage[]
const TURN_ORDER = Object.keys(TURN_LABELS) as Turn[]

const keyOf = (i: WorkBoardItem, key: EverythingKey, now: Date): string | number => {
  switch (key) {
    case 'type':
      return i.typeName
    case 'ticketId':
      return i.ticket?.id ?? ''
    case 'title':
      return i.title
    case 'area':
      return i.area ?? ''
    case 'stage':
      return STAGE_ORDER.indexOf(i.stage)
    case 'turn':
      return TURN_ORDER.indexOf(i.turn)
    case 'priority': {
      const p = effectivePriority(i)
      return p ? PRIORITY_WEIGHT[p] : 0
    }
    case 'quietDays':
      return quietDays(i, now)
    case 'score':
      return score(i, now)
  }
}

const compare = (a: string | number, b: string | number): number =>
  typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })

/** Sorted by the key (stage and turn in their label order), ties by title. */
export function everythingRows(
  items: WorkBoardItem[],
  now: Date,
  sort: { key: EverythingKey; dir: 1 | -1 },
): WorkBoardItem[] {
  return [...items].sort(
    (a, b) =>
      sort.dir * compare(keyOf(a, sort.key, now), keyOf(b, sort.key, now)) || compare(a.title, b.title),
  )
}
