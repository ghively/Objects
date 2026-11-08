// One `api.calendar` range for the shown days, reloaded (debounced) when objects change and when
// the local day rolls over (today's Overdue group, Created Today and the Today pill move with it).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { CalendarRange, ChangeKind, DateValue } from '@/api/types'
import { dayReader, daySpan } from '@/views/dates'
import { todayYmd } from './dates'

export const RANGE_RELOAD_MS = 150
/** How often the hook looks for a new local day. */
export const DAY_CHECK_MS = 60_000

/** Events that always reload the range; a `changed` reloads only when it concerns the shown days. */
const RELOAD_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['created', 'deleted', 'renamed', 'types'])

/**
 * A date value (`{start, end?, resolution}`) touching `[from, to]` (days in the time-zone setting:
 * a timed value's instant is read as its day there, not as its UTC day).
 */
function dateInRange(v: unknown, from: string, to: string, dayOf: (iso: string) => string | null): boolean {
  if (!v || typeof v !== 'object') return false
  if (typeof (v as { start?: unknown }).start !== 'string') return false
  const span = daySpan(v as DateValue, dayOf)
  if (!span) return false
  return span.start <= to && (span.end ?? span.start) >= from
}

/**
 * Whether an object saved in place belongs in the shown range now: one of its date values falls
 * in it, or it recurs (an occurrence may). Read from its row, not from the whole range again.
 */
export async function concernsRange(path: string, from: string, to: string): Promise<boolean> {
  try {
    const [row] = await api.rows({ paths: [path], preview: false })
    if (!row) return false
    if (typeof row.values.repeat === 'string' && row.values.repeat.trim() !== '') return true
    const dayOf = dayReader()
    return Object.values(row.values).some((v) => dateInRange(v, from, to, dayOf))
  } catch {
    return false
  }
}

/**
 * Every path a range lists: daily notes, tasks, dated, created, updated, backlinks, references,
 * timeline and warnings. `summaries` holds only some of them (the server leaves out the created,
 * updated, backlinks, references and timeline paths), so membership is read from the days.
 */
export function rangePathSet(res: CalendarRange): Set<string> {
  const out = new Set<string>(Object.keys(res.summaries ?? {}))
  for (const cd of Object.values(res.days ?? {})) {
    if (!cd) continue
    if (cd.dailyNote) out.add(cd.dailyNote.path)
    for (const t of cd.tasks ?? []) out.add(t.path)
    for (const d of cd.dated ?? []) out.add(d.path)
    for (const p of cd.created ?? []) out.add(p)
    for (const p of cd.updated ?? []) out.add(p)
    const m = cd as { backlinks?: string[]; references?: { path: string }[]; timeline?: { path: string }[] }
    for (const p of m.backlinks ?? []) out.add(p)
    for (const r of m.references ?? []) out.add(r.path)
    for (const t of m.timeline ?? []) out.add(t.path)
  }
  for (const w of res.warnings ?? []) for (const p of w.paths ?? []) out.add(p)
  return out
}

export interface CalendarRangeState {
  data: CalendarRange | null
  loading: boolean
  reload(): void
}

export function useCalendarRange(range: { from: string; to: string } | null): CalendarRangeState {
  const from = range?.from ?? null
  const to = range?.to ?? null
  const key = from !== null && to !== null ? `${from}|${to}` : null
  // The last answer and the range it was for (a failed load counts as answered, with no data).
  const [state, setState] = useState<{ key: string | null; data: CalendarRange | null }>({ key: null, data: null })
  const seq = useRef(0)
  const day = useRef(todayYmd())
  /** The last answer, for telling whether a changed object is among the shown days' objects. */
  const latest = useRef<CalendarRange | null>(null)
  /** Every path the last answer lists. */
  const latestPaths = useRef<Set<string>>(new Set())

  const load = useCallback(() => {
    if (from === null || to === null) return
    const my = ++seq.current
    const forKey = `${from}|${to}`
    day.current = todayYmd()
    api
      .calendar(from, to)
      .then((res) => {
        if (my !== seq.current) return
        latest.current = res
        latestPaths.current = res ? rangePathSet(res) : new Set()
        setState({ key: forKey, data: res })
      })
      .catch((e: unknown) => {
        if (my !== seq.current) return
        console.warn('Could not load the calendar:', e)
        setState((s) => ({ key: forKey, data: s.key === forKey ? s.data : null }))
      })
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let alive = true
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        load()
      }, RANGE_RELOAD_MS)
    }
    const off = api.onChange((e) => {
      // Any event after midnight also reloads: the day the server answered for has passed.
      if (todayYmd() !== day.current || RELOAD_KINDS.has(e.kind)) return schedule()
      if (e.kind !== 'changed' || from === null || to === null) return
      // An object saved in place: reload when it is among the shown days' objects, or when today
      // is shown (its "Updated" list takes every save); another object only when its dates or
      // recurrence put it in the range now, which one small `/api/rows` call tells.
      const shown = latest.current
      const today = todayYmd()
      if (!shown || shown.from !== from || shown.to !== to || latestPaths.current.has(e.path) || (today >= from && today <= to)) return schedule()
      void concernsRange(e.path, from, to).then((yes) => {
        if (yes && alive) schedule()
      })
    })
    const tick = setInterval(() => {
      if (todayYmd() !== day.current) schedule()
    }, DAY_CHECK_MS)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      clearInterval(tick)
      off?.()
    }
  }, [load, from, to])

  // Data of another range is never shown for this one.
  const data = state.key === key ? state.data : null
  return { data, loading: key !== null && state.key !== key, reload: load }
}
