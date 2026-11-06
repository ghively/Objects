// M23 Task 7: On the floor's groups (plan `2026-11-05-m23-work-section.md`; the place rule and the
// grouping are ported from the old dashboard). Pure.
import type { FloorItemValue, WorkBoardItem } from '@/api/types'
import { WORK_TEXT } from '../workText'

export interface FloorRow {
  key: string
  place: string
  what: string
  found: string | null
  collected: string | null
  item: FloorItemValue
  owner: WorkBoardItem | null
}

export const COLLECTED_SHOWN = 25

/** The place without parenthesised parts, spaces collapsed; `Anywhere` when empty (ported). */
export function placeOf(place: string | null | undefined): string {
  const p = (place ?? '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()
  return p || WORK_TEXT.anywhere
}

const row = (f: FloorItemValue, owner: WorkBoardItem | null): FloorRow => ({
  key: `${owner ? owner.path : 'general'}#${f.id}`,
  place: placeOf(f.place),
  what: f.what ?? '',
  found: f.found,
  collected: f.collected,
  item: f,
  owner,
})

/** Open rows by place (groups by size, then name); collected rows newest first, at most 25. */
export function floorGroups(
  items: WorkBoardItem[],
  general: FloorItemValue[],
): { open: { place: string; rows: FloorRow[] }[]; collected: FloorRow[] } {
  const rows: FloorRow[] = []
  for (const i of items) if (!i.done) for (const f of i.floorItems) rows.push(row(f, i))
  for (const f of general) rows.push(row(f, null))
  const groups = new Map<string, FloorRow[]>()
  for (const r of rows) if (!r.collected) groups.set(r.place, [...(groups.get(r.place) ?? []), r])
  const open = [...groups].map(([place, list]) => ({ place, rows: list }))
  open.sort((a, b) => b.rows.length - a.rows.length || a.place.localeCompare(b.place))
  const collected = rows
    .filter((r) => r.collected)
    .sort((a, b) => (b.collected as string).localeCompare(a.collected as string))
    .slice(0, COLLECTED_SHOWN)
  return { open, collected }
}
