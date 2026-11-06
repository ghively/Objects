// M23 Task 7: focus lines against the board (plan `2026-11-05-m23-work-section.md`). Pure.
import type { FocusLine, WorkBoardItem } from '@/api/types'

/** The line's resolved links plus every item whose project is one of them. */
export function linkedPaths(line: FocusLine, items: WorkBoardItem[]): Set<string> {
  const links = new Set<string>()
  for (const l of line.links) if (l.path) links.add(l.path)
  const out = new Set(links)
  for (const i of items) if (i.projectPath && links.has(i.projectPath)) out.add(i.path)
  return out
}

const linkedItems = (line: FocusLine, items: WorkBoardItem[]): WorkBoardItem[] => {
  const paths = linkedPaths(line, items)
  return items.filter((i) => paths.has(i.path))
}

/** Struck through: at least one linked work item and none of them still active. */
export function isCleared(line: FocusLine, items: WorkBoardItem[]): boolean {
  const linked = linkedItems(line, items)
  return linked.length > 0 && linked.every((i) => i.done)
}

/** Steps finished over the steps of the linked items. */
export function focusProgress(line: FocusLine, items: WorkBoardItem[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const i of linkedItems(line, items)) {
    done += i.stepsFinished
    total += i.stepCount
  }
  return { done, total }
}

/** The `n` of the first line whose linked work holds Now's top item, else null. */
export function currentLine(lines: FocusLine[], items: WorkBoardItem[], top: WorkBoardItem | null): number | null {
  if (!top) return null
  return lines.find((l) => linkedPaths(l, items).has(top.path))?.n ?? null
}
