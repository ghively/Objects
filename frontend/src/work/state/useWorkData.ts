// M23 Task 8: the Work page's data. Every view is computed from these parts (the board above all).
// Reads only: nothing here writes. `useWorkEvents` reloads the parts a change touches, debounced.
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@/api/client'
import type {
  AgentStatus,
  CaptureSummary,
  ChangeEvent,
  FocusDay,
  GeneralFloor,
  TypeDef,
  WorkAlerts,
  WorkBoard,
  WorkToday,
  WorkWins,
} from '@/api/types'
import { useSpaceInfo } from '@/settings/useSpaceInfo'

export type WorkPart = 'board' | 'all' | 'focus' | 'today' | 'alerts' | 'agent' | 'needsYou' | 'wins' | 'general'

/** What the page loads on mount; `all`, `wins` and `general` load when a view asks. */
export const DEFAULT_PARTS: readonly WorkPart[] = ['board', 'focus', 'today', 'alerts', 'agent', 'needsYou']

/** The reload debounce (Contract: 300 ms). */
export const EVENTS_DEBOUNCE_MS = 300

export interface WorkDataState {
  board: WorkBoard | null
  all: WorkBoard | null
  focus: FocusDay | null
  today: WorkToday | null
  alerts: WorkAlerts | null
  agent: AgentStatus | null
  needsYou: CaptureSummary[] | null
  wins: WorkWins | null
  general: GeneralFloor | null
  /** The message of the last failed load, per part (cleared when it loads). */
  error: Partial<Record<WorkPart, string>>
  /** Rows (`"{path}#{stepId}"`) hidden while their action runs, or until the next board shows it done. */
  hidden: ReadonlySet<string>
  load(parts?: readonly WorkPart[]): Promise<void>
  hide(key: string): void
  unhide(key: string): void
}

const FETCH: { [K in WorkPart]: () => Promise<WorkDataState[K]> } = {
  board: () => api.workBoard(),
  all: () => api.workBoard('all'),
  focus: () => api.workFocus(),
  today: () => api.workToday(),
  alerts: () => api.workAlerts(),
  agent: () => api.workAgent(),
  needsYou: () => api.workCaptures('needsYou'),
  wins: () => api.workWins(),
  general: () => api.generalFloor(),
}

// A row hidden by a successful action stays hidden until a board load that started after the
// action finished arrives (then the board itself shows it done); `settled` holds that moment.
let tick = 0
const settled = new Map<string, number>()
// The latest request per part: an older answer arriving late never replaces a newer one.
const latest = new Map<WorkPart, number>()

/** The action behind hidden row `key` finished: the next board load may show it again. */
export function settleHidden(key: string): void {
  tick += 1
  settled.set(key, tick)
}

export const useWorkData = create<WorkDataState>()((set, get) => ({
  board: null,
  all: null,
  focus: null,
  today: null,
  alerts: null,
  agent: null,
  needsYou: null,
  wins: null,
  general: null,
  error: {},
  hidden: new Set<string>(),

  async load(parts = DEFAULT_PARTS) {
    await Promise.all(
      [...new Set(parts)].map(async (part) => {
        tick += 1
        const mine = tick
        latest.set(part, mine)
        try {
          const value = await FETCH[part]()
          if (latest.get(part) !== mine) return
          const { [part]: _gone, ...error } = get().error
          const patch: Partial<WorkDataState> = { [part]: value, error }
          if (part === 'board') {
            const shown = [...settled].filter(([, at]) => at < mine).map(([k]) => k)
            if (shown.length) {
              const hidden = new Set(get().hidden)
              for (const k of shown) {
                settled.delete(k)
                hidden.delete(k)
              }
              patch.hidden = hidden
            }
          }
          set(patch)
        } catch (e) {
          if (latest.get(part) !== mine) return
          set({ error: { ...get().error, [part]: e instanceof Error && e.message ? e.message : String(e) } })
        }
      }),
    )
  },

  hide(key) {
    settled.delete(key)
    if (get().hidden.has(key)) return
    set({ hidden: new Set(get().hidden).add(key) })
  },

  unhide(key) {
    settled.delete(key)
    if (!get().hidden.has(key)) return
    const hidden = new Set(get().hidden)
    hidden.delete(key)
    set({ hidden })
  },
}))

/** Tests: an empty store. */
export function resetWorkData(): void {
  settled.clear()
  latest.clear()
  useWorkData.setState({
    board: null,
    all: null,
    focus: null,
    today: null,
    alerts: null,
    agent: null,
    needsYou: null,
    wins: null,
    general: null,
    error: {},
    hidden: new Set<string>(),
  })
}

// ---- which parts an event touches ----------------------------------------------------------

const OBJECT_EVENTS = new Set<ChangeEvent['kind']>(['changed', 'created', 'deleted', 'renamed', 'types'])

function typeOfPath(path: string, types: readonly TypeDef[]): TypeDef | null {
  let best: TypeDef | null = null
  for (const t of types) {
    if (!t.folder) continue
    if (path.startsWith(`${t.folder}/`) && (!best || t.folder.length > best.folder.length)) best = t
  }
  return best
}

const isDailyNoteType = (t: TypeDef) => t.id === 'dailynote'
const isMeetingType = (t: TypeDef) => t.id === 'meeting' || t.templateKey === 'meeting'
/** `alerttype.is_alert_type`: an `alertKey` text property and a `severity` label property. */
const isAlertType = (t: TypeDef) =>
  t.propertyDefinitions.some((p) => p.key === 'alertKey' && p.type === 'text') &&
  t.propertyDefinitions.some((p) => p.key === 'severity' && p.type === 'label')

/** The parts event `e` makes stale (`allLoaded`: the `all` board is in the store). */
export function partsForEvent(e: ChangeEvent, types: readonly TypeDef[], allLoaded: boolean): WorkPart[] {
  if (e.kind === 'work') return ['general']
  if (e.kind === 'workQueue') return ['agent']
  if (!OBJECT_EVENTS.has(e.kind)) return []
  const out: WorkPart[] = ['board', 'needsYou']
  if (allLoaded) out.push('all')
  if (e.kind === 'types') return out
  const paths = [e.path, e.oldPath].filter((p): p is string => typeof p === 'string' && p !== '')
  for (const p of paths) {
    if (p === '*') {
      out.push('focus', 'today', 'alerts')
      continue
    }
    const t = typeOfPath(p, types)
    if (!t) continue
    if (isDailyNoteType(t) || isMeetingType(t)) out.push('focus', 'today')
    if (isAlertType(t)) out.push('alerts')
  }
  return [...new Set(out)]
}

/** While mounted: reloads the parts each change event touches, once per 300 ms burst. */
export function useWorkEvents(): void {
  useEffect(() => {
    const pending = new Set<WorkPart>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = api.onChange((e) => {
      const types = useSpaceInfo.getState().space?.types ?? []
      const parts = partsForEvent(e, types, useWorkData.getState().all !== null)
      if (!parts.length) return
      for (const p of parts) pending.add(p)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const run = [...pending]
        pending.clear()
        void useWorkData.getState().load(run)
      }, EVENTS_DEBOUNCE_MS)
    })
    return () => {
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [])
}
