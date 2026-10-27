// `ui.calendar`: the week start, the sidebar switch (M7) and `daily` (the Day view's section flags
// and section views), saved to `ui.json`. `PUT /api/ui` replaces top-level keys, so every save
// sends the whole `calendar` object. Edits are optimistic and saved in order with the latest `baseRevision`; on a 409 the fresh
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
  const out: CalendarUi = { weekStart, daily }
  if (typeof c?.hideCalendarSidebar === 'boolean') out.hideCalendarSidebar = c.hideCalendarSidebar
  return out
}

type CalendarEdit = (cal: CalendarUi) => CalendarUi

/** The saved `ui.calendar.daily` (an empty object until `ui.json` loads or when it has none). */
export function useCalendarDaily(): CalendarDaily {
  return useUiStore((s) => s.ui.calendar?.daily) ?? EMPTY_DAILY
}

let queue: Promise<void> = Promise.resolve()

async function save(edit: CalendarEdit): Promise<void> {
  const base = useUiStore.getState()
  const next = edit(calendarOf(base.ui))
  try {
    const res = await api.patchUi({ calendar: next }, { baseRevision: base.revision })
    useUiStore.setState({ revision: res?.revision ?? useUiStore.getState().revision })
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e
    const fresh = await api.ui()
    const again = edit(calendarOf(fresh?.ui))
    const res = await api.patchUi({ calendar: again }, { baseRevision: fresh?.revision ?? '' })
    const ui = { ...(fresh?.ui ?? useUiStore.getState().ui), calendar: again }
    useUiStore.setState({ ui, revision: res?.revision ?? fresh?.revision ?? '' })
  }
}

/** Apply `edit` to `ui.calendar` now and save it after the edits before it. */
function enqueue(edit: CalendarEdit): Promise<void> {
  const cur = useUiStore.getState().ui
  useUiStore.setState({ ui: { ...cur, calendar: edit(calendarOf(cur)) } })
  const done = queue.then(() =>
    save(edit).catch((e: unknown) => {
      console.warn('Could not save the calendar settings:', e)
    }),
  )
  queue = done
  return done
}

/** Merge `patch` into `ui.calendar.daily` now and save it after the edits before it. */
export function saveCalendarDaily(patch: Partial<CalendarDaily>): Promise<void> {
  return enqueue((cal) => ({ ...cal, daily: { ...cal.daily, ...patch } }))
}

/** Set `ui.calendar.weekStart` and/or `hideCalendarSidebar`, keeping the rest of `calendar`. */
export function saveCalendarUi(patch: Partial<Pick<CalendarUi, 'weekStart' | 'hideCalendarSidebar'>>): Promise<void> {
  return enqueue((cal) => ({ ...cal, ...patch }))
}
