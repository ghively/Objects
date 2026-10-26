// `ui.calendar.daily`: the Day view's section flags and section views, saved to `ui.json`.
// Edits are optimistic and saved in order with the latest `baseRevision`; on a 409 the fresh
// state is fetched and the same edit is re-applied to it once (never a blind overwrite).
import { api, ConflictError } from '@/api/client'
import type { CalendarUi, UiState } from '@/api/types'
import { useUiStore } from '@/shell/usePinned'

export type CalendarDaily = CalendarUi['daily']

const EMPTY_DAILY: CalendarDaily = {}

function calendarOf(ui: UiState | undefined | null): CalendarUi {
  const c = ui?.calendar
  const weekStart = c?.weekStart === 'monday' ? 'monday' : 'sunday'
  const daily = c?.daily && typeof c.daily === 'object' ? c.daily : EMPTY_DAILY
  return { weekStart, daily }
}

/** The saved `ui.calendar.daily` (an empty object until `ui.json` loads or when it has none). */
export function useCalendarDaily(): CalendarDaily {
  return useUiStore((s) => s.ui.calendar?.daily) ?? EMPTY_DAILY
}

let queue: Promise<void> = Promise.resolve()

async function save(patch: Partial<CalendarDaily>): Promise<void> {
  const base = useUiStore.getState()
  const cal = calendarOf(base.ui)
  const next: CalendarUi = { ...cal, daily: { ...cal.daily, ...patch } }
  try {
    const res = await api.patchUi({ calendar: next }, { baseRevision: base.revision })
    useUiStore.setState({ revision: res?.revision ?? useUiStore.getState().revision })
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e
    const fresh = await api.ui()
    const freshCal = calendarOf(fresh?.ui)
    const again: CalendarUi = { ...freshCal, daily: { ...freshCal.daily, ...patch } }
    const res = await api.patchUi({ calendar: again }, { baseRevision: fresh?.revision ?? '' })
    const ui = { ...(fresh?.ui ?? useUiStore.getState().ui), calendar: again }
    useUiStore.setState({ ui, revision: res?.revision ?? fresh?.revision ?? '' })
  }
}

/** Merge `patch` into `ui.calendar.daily` now and save it after the edits before it. */
export function saveCalendarDaily(patch: Partial<CalendarDaily>): Promise<void> {
  const cur = useUiStore.getState().ui
  const cal = calendarOf(cur)
  useUiStore.setState({ ui: { ...cur, calendar: { ...cal, daily: { ...cal.daily, ...patch } } } })
  const done = queue.then(() =>
    save(patch).catch((e: unknown) => {
      console.warn('Could not save the calendar settings:', e)
    }),
  )
  queue = done
  return done
}
