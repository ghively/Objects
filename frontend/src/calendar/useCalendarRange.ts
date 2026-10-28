// One `api.calendar` range for the shown days, reloaded (debounced) when objects change and when
// the local day rolls over (today's Overdue group, Created Today and the Today pill move with it).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { CalendarRange, ChangeKind } from '@/api/types'
import { todayYmd } from './dates'

export const RANGE_RELOAD_MS = 150
/** How often the hook looks for a new local day. */
export const DAY_CHECK_MS = 60_000

const RELOAD_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['created', 'deleted', 'renamed', 'changed', 'types'])

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

  const load = useCallback(() => {
    if (from === null || to === null) return
    const my = ++seq.current
    const forKey = `${from}|${to}`
    day.current = todayYmd()
    api
      .calendar(from, to)
      .then((res) => {
        if (my === seq.current) setState({ key: forKey, data: res })
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
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        load()
      }, RANGE_RELOAD_MS)
    }
    const off = api.onChange((e) => {
      // Any event after midnight also reloads: the day the server answered for has passed.
      if (RELOAD_KINDS.has(e.kind) || todayYmd() !== day.current) schedule()
    })
    const tick = setInterval(() => {
      if (todayYmd() !== day.current) schedule()
    }, DAY_CHECK_MS)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(tick)
      off?.()
    }
  }, [load])

  // Data of another range is never shown for this one.
  const data = state.key === key ? state.data : null
  return { data, loading: key !== null && state.key !== key, reload: load }
}
