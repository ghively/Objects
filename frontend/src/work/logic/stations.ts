// M23 Task 7: the Projects map's lines and stations (plan `2026-11-05-m23-work-section.md`). Pure.
import type { Stage, WorkBoardItem } from '@/api/types'
import { WORK_TEXT } from '../workText'
import { isYours } from './scoring'

export type StationState = 'done' | 'doing' | 'waiting' | 'notStarted'
export interface Station { key: string; label: string; state: StationState; path: string; stepId: string | null }
export interface MapLine {
  key: string
  title: string
  projectPath: string | null
  stations: Station[]
  percentDone: number
  nextForYou: { path: string; text: string } | null
}

const STAGE_STATION: Record<Stage, StationState> = {
  done: 'done',
  doing: 'doing',
  parked: 'waiting',
  notStarted: 'notStarted',
  ready: 'notStarted',
}

const itemStation = (i: WorkBoardItem): Station => ({
  key: i.path,
  label: i.title,
  state: i.done ? 'done' : STAGE_STATION[i.stage],
  path: i.path,
  stepId: null,
})

/** A project's own steps: finished → done; the current one doing on Gene's turn, else waiting. */
const stepStations = (p: WorkBoardItem): Station[] => {
  const cur = p.steps.findIndex((s) => s.current)
  return p.steps.map((s, k) => {
    let state: StationState
    if (s.state === 'done' || s.state === 'declined') state = 'done'
    else if (k === cur) state = p.turn === 'you' ? 'doing' : 'waiting'
    else state = 'notStarted'
    return { key: `${p.path}#${s.id}`, label: s.text, state, path: p.path, stepId: s.id }
  })
}

const makeLine = (
  key: string,
  title: string,
  projectPath: string | null,
  stations: Station[],
  byPath: Map<string, WorkBoardItem>,
): MapLine => {
  const done = stations.filter((s) => s.state === 'done').length
  let nextForYou: MapLine['nextForYou'] = null
  for (const s of stations) {
    const owner = byPath.get(s.path)
    if (!owner || !owner.current || !isYours(owner)) continue
    if (s.stepId !== null && s.stepId !== owner.current.id) continue
    nextForYou = { path: owner.path, text: owner.current.text }
    break
  }
  return {
    key,
    title,
    projectPath,
    stations,
    percentDone: stations.length ? Math.round((done / stations.length) * 100) : 0,
    nextForYou,
  }
}

/**
 * One line per Project (its steps, then its tasks), then one line per Area for the work items with
 * no project that aren't Projects ("No area" for none); by active stations descending, then title.
 */
export function projectLines(items: WorkBoardItem[]): MapLine[] {
  const byPath = new Map(items.map((i) => [i.path, i]))
  const lines: MapLine[] = []
  for (const p of items.filter((i) => i.isProject)) {
    const tasks = items.filter((i) => !i.isProject && i.projectPath === p.path)
    lines.push(makeLine(p.path, p.title, p.path, [...stepStations(p), ...tasks.map(itemStation)], byPath))
  }
  const areas = new Map<string, WorkBoardItem[]>()
  for (const i of items) {
    if (i.isProject || i.projectPath) continue
    const name = i.area ?? WORK_TEXT.noArea
    areas.set(name, [...(areas.get(name) ?? []), i])
  }
  for (const [name, list] of areas) lines.push(makeLine(`area:${name}`, name, null, list.map(itemStation), byPath))
  const active = (l: MapLine) => l.stations.filter((s) => s.state !== 'done').length
  return lines.sort((a, b) => active(b) - active(a) || a.title.localeCompare(b.title))
}
