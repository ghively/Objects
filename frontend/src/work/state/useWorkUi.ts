// M23 Task 8: the Work page's own UI state, per space in browser storage (`object.work:<space
// root>`), so using the page writes no file. Not now and the selected focus line are today's only:
// an earlier day's reads as empty. Blocked storage keeps the state in memory.
import { create } from 'zustand'
import type { Energy, WorkViewId } from '@/api/types'
import { zonedToday } from '@/lib/zonedTime'
import { useSpaceInfo } from '@/settings/useSpaceInfo'

/** Everything's sort keys (T7's `EverythingKey`). */
export type WorkSortKey = 'type' | 'ticketId' | 'title' | 'area' | 'stage' | 'turn' | 'priority' | 'quietDays' | 'score'

export interface WorkUiValues {
  energy: Energy | null
  /** Just one thing. */
  calm: boolean
  view: WorkViewId
  focusLine: { day: string; n: number } | null
  notNow: { day: string; paths: string[] }
  /** Flow's area filter (null: All areas). */
  flowArea: string | null
  everythingSort: { key: WorkSortKey; dir: 1 | -1 }
}

export interface WorkUiState extends WorkUiValues {
  setEnergy(energy: Energy | null): void
  setCalm(calm: boolean): void
  setView(view: WorkViewId): void
  /** Select focus line `n` for today (null clears it). */
  setFocusLine(n: number | null): void
  /** Not now: `path` goes to the back of Now for today. */
  addNotNow(path: string): void
  clearNotNow(): void
  setFlowArea(area: string | null): void
  setEverythingSort(sort: { key: WorkSortKey; dir: 1 | -1 }): void
}

export const WORK_UI_KEY = 'object.work'

const defaults = (): WorkUiValues => ({
  energy: null,
  calm: false,
  view: 'now',
  focusLine: null,
  notNow: { day: zonedToday(), paths: [] },
  flowArea: null,
  everythingSort: { key: 'score', dir: -1 },
})

const ENERGIES: readonly Energy[] = ['low', 'medium', 'high']
const SORT_KEYS: readonly WorkSortKey[] = ['type', 'ticketId', 'title', 'area', 'stage', 'turn', 'priority', 'quietDays', 'score']

/** The stored values, checked field by field; another day's Not now and focus line read as empty. */
function clean(raw: unknown): WorkUiValues {
  const out = defaults()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  const today = out.notNow.day
  if (ENERGIES.includes(r.energy as Energy)) out.energy = r.energy as Energy
  if (typeof r.calm === 'boolean') out.calm = r.calm
  if (typeof r.view === 'string' && r.view) out.view = r.view
  const fl = r.focusLine as { day?: unknown; n?: unknown } | null | undefined
  if (fl && fl.day === today && typeof fl.n === 'number' && Number.isInteger(fl.n) && fl.n > 0) out.focusLine = { day: today, n: fl.n }
  const nn = r.notNow as { day?: unknown; paths?: unknown } | null | undefined
  if (nn && nn.day === today && Array.isArray(nn.paths)) {
    out.notNow = { day: today, paths: nn.paths.filter((p): p is string => typeof p === 'string') }
  }
  if (typeof r.flowArea === 'string' && r.flowArea) out.flowArea = r.flowArea
  const es = r.everythingSort as { key?: unknown; dir?: unknown } | null | undefined
  if (es && SORT_KEYS.includes(es.key as WorkSortKey) && (es.dir === 1 || es.dir === -1)) {
    out.everythingSort = { key: es.key as WorkSortKey, dir: es.dir }
  }
  return out
}

const keyFor = (root: string | null) => (root ? `${WORK_UI_KEY}:${root}` : WORK_UI_KEY)

let root: string | null = null

function read(r: string | null): WorkUiValues {
  try {
    const text = window.localStorage.getItem(keyFor(r))
    return clean(text ? JSON.parse(text) : null)
  } catch {
    return defaults()
  }
}

function write(values: WorkUiValues): void {
  try {
    window.localStorage.setItem(keyFor(root), JSON.stringify(values))
  } catch {
    // Blocked storage: the state lives in memory only.
  }
}

function values(s: WorkUiState): WorkUiValues {
  const { energy, calm, view, focusLine, notNow, flowArea, everythingSort } = s
  return { energy, calm, view, focusLine, notNow, flowArea, everythingSort }
}

export const useWorkUi = create<WorkUiState>()((set, get) => {
  const save = (patch: Partial<WorkUiValues>) => {
    set(patch)
    write(values(get()))
  }
  return {
    ...defaults(),
    setEnergy: (energy) => save({ energy }),
    setCalm: (calm) => save({ calm }),
    setView: (view) => save({ view }),
    setFocusLine: (n) => save({ focusLine: n === null ? null : { day: zonedToday(), n } }),
    addNotNow: (path) => {
      const today = zonedToday()
      const cur = get().notNow
      const paths = cur.day === today ? cur.paths.filter((p) => p !== path) : []
      save({ notNow: { day: today, paths: [...paths, path] } })
    },
    clearNotNow: () => save({ notNow: { day: zonedToday(), paths: [] } }),
    setFlowArea: (flowArea) => save({ flowArea }),
    setEverythingSort: (everythingSort) => save({ everythingSort }),
  }
})

/**
 * Read the state stored for space `spaceRoot` (null: the global key). Called whenever the space's
 * root changes, and by tests to stand for a reload.
 */
export function loadWorkUi(spaceRoot: string | null): void {
  root = spaceRoot
  useWorkUi.setState(read(spaceRoot))
}

/** Today's Not now paths (an earlier day's are empty). */
export function notNowToday(s: Pick<WorkUiValues, 'notNow'>): ReadonlySet<string> {
  return new Set(s.notNow.day === zonedToday() ? s.notNow.paths : [])
}

/** Today's selected focus line, or null (an earlier day's is none). */
export function focusLineToday(s: Pick<WorkUiValues, 'focusLine'>): number | null {
  return s.focusLine && s.focusLine.day === zonedToday() ? s.focusLine.n : null
}

// The space's root decides the key: follow it as the space info loads or the space changes.
loadWorkUi(useSpaceInfo.getState().space?.root ?? null)
useSpaceInfo.subscribe((s) => {
  const r = s.space?.root ?? null
  if (r !== root) loadWorkUi(r)
})
