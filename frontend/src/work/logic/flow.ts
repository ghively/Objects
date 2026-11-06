// M23 Task 7: the Flow board's lanes and columns (plan `2026-11-05-m23-work-section.md`). Pure.
import type { Stage, WorkBoardItem } from '@/api/types'
import { score } from './scoring'

export type Lane = 'you' | 'agent' | 'others'
export const FLOW_COLUMNS: Stage[] = ['notStarted', 'ready', 'doing', 'parked', 'done']
/** Doing for You is flagged Overloaded above this. */
export const DOING_LIMIT = 3

const LANES: readonly Lane[] = ['you', 'agent', 'others']

/** Agent turn → Agent; parked, no steps or Blocked on set → Others; else You. */
export function laneOf(i: WorkBoardItem): Lane {
  if (i.turn === 'agent') return 'agent'
  if (i.turn === 'parked' || i.turn === 'none' || i.blockedOn) return 'others'
  return 'you'
}

/**
 * The board's cells (the Done column holds recently done items only), each sorted by score;
 * `areas` are the active items' areas by name. `now` (the score's recency) defaults to the clock.
 */
export function flowBoard(
  items: WorkBoardItem[],
  area: string | null,
  now: Date = new Date(),
): { cells: Record<Lane, Record<Stage, WorkBoardItem[]>>; youDoing: number; overloaded: boolean; areas: string[] } {
  const empty = (): Record<Stage, WorkBoardItem[]> =>
    Object.fromEntries(FLOW_COLUMNS.map((c) => [c, [] as WorkBoardItem[]])) as Record<Stage, WorkBoardItem[]>
  const cells: Record<Lane, Record<Stage, WorkBoardItem[]>> = { you: empty(), agent: empty(), others: empty() }
  for (const i of items) {
    if (i.done && !i.recentlyDone) continue
    if (area !== null && i.area !== area) continue
    cells[laneOf(i)][i.done ? 'done' : i.stage].push(i)
  }
  for (const lane of LANES) for (const c of FLOW_COLUMNS) cells[lane][c].sort((a, b) => score(b, now) - score(a, now))
  const areas = [...new Set(items.filter((i) => !i.done && i.area).map((i) => i.area as string))].sort((a, b) =>
    a.localeCompare(b),
  )
  const youDoing = cells.you.doing.length
  return { cells, youDoing, overloaded: youDoing > DOING_LIMIT, areas }
}
