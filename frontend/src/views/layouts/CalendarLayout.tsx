// M13 `calendar`: the view's rows (`props.flat`, every row that survives its filters and sorts) on
// a month grid or a week strip, placed by one date property (`state.viewDefinition.calendarConfig`;
// see docs/superpowers/plans/2026-11-05-m13-view-layouts.md, "Calendar"). A range sits on every day
// it covers. Dragging a chip to another day writes only that property (moved by whole days: a range
// keeps its length, a time its wall-clock time); clicking a day's empty space creates an object
// dated that day. Rows without the date are listed under "No date (N)". The rows come from the
// view, never from the Calendar page's range loader. Labels and defaults are our choices.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { api, ConflictError } from '@/api/client'
import type { Row, TypeDef, ViewState } from '@/api/types'
import { formatLong, todayYmd, type Day } from '@/calendar/dates'
import { useWeekStart } from '@/calendar/useCalendar'
import { Icon } from '@/components/Icon'
import { useZonedToday } from '@/lib/zonedShell'
import { cn } from '@/lib/utils'
import type { LayoutProps } from '../DataView'
import { MenuSelect, propertyOptions } from '../MenuSelect'
import { createRowWrites } from '../rowWrites'
import {
  calendarConfig,
  canDragRow,
  createType,
  dateChoices,
  dateValueOf,
  daysBetween,
  MONTH_DAY_CAP,
  monthWeeks,
  periodTitle,
  placeRows,
  resolveDateProperty,
  shiftDateValue,
  shownDays,
  stepAnchor,
  SYSTEM_DATE_KEYS,
  WEEK_DAY_CAP,
  weekdayHeaders,
  withCalendarConfig,
  CALENDAR_TEXT,
  chipTime,
  type CalendarMode,
} from './calendar/calendarModel'
import { Chip, ChipGhost, DayCell, RowsPopover } from './calendar/CalendarParts'

const NAV_BTN = 'flex h-7 items-center justify-center rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover hover:text-fg'
const MODES: readonly CalendarMode[] = ['month', 'week']
const modeLabel = (m: CalendarMode) => (m === 'month' ? CALENDAR_TEXT.month : CALENDAR_TEXT.week)

export function CalendarLayout(props: LayoutProps) {
  const { flat, state, onState, viewTypes, typesById, multiType, onOpen, patchRow, onWritten, isSelected, onCreate } = props
  const config = calendarConfig(state.viewDefinition.calendarConfig)
  const { mode, dateProperty } = config
  const key = useMemo(() => resolveDateProperty({ dateProperty, mode }, viewTypes), [dateProperty, mode, viewTypes])
  const system = SYSTEM_DATE_KEYS.has(key)
  const weekStart = useWeekStart()
  const today = useZonedToday()
  // The calendar opens on today; the shown period is the viewer's own and isn't saved.
  const [anchor, setAnchor] = useState<Day>(() => todayYmd())
  const month = anchor.slice(0, 7)
  const title = periodTitle(mode, anchor, weekStart)

  const days = useMemo(() => shownDays(mode, anchor, weekStart), [mode, anchor, weekStart])
  const placement = useMemo(() => placeRows(flat, key, days[0], days[days.length - 1]), [flat, key, days])

  // Drops write one property of one row, each from the newest version known (the rows may lag).
  const writes = useMemo(() => createRowWrites(), [])
  const [notice, setNotice] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const say = (text: string) => {
    setNotice(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setNotice(null), 4000)
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [dragging, setDragging] = useState<Row | null>(null)

  const reload = async (row: Row) => {
    try {
      const [fresh] = await api.rows({ paths: [row.summary.path] })
      if (fresh) {
        writes.seen(fresh, row)
        patchRow?.(row.summary.path, fresh)
      }
    } catch (err) {
      console.warn('Could not reload row:', err)
    }
  }

  const dragData = (e: { active: { id: string | number; data?: { current?: unknown } } }) => {
    const data = e.active.data?.current as { path?: string; day?: string } | undefined
    const [idDay, idPath] = String(e.active.id).split('\n')
    return { path: data?.path ?? idPath, from: data?.day ?? idDay }
  }

  const onDragStart = (e: DragStartEvent) => {
    const { path } = dragData(e)
    setDragging(flat.find((r) => r.summary.path === path) ?? null)
  }

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null)
    const over = e.over ? String(e.over.id) : ''
    if (!over.startsWith('day:')) return
    const { path, from } = dragData(e)
    const row = flat.find((r) => r.summary.path === path)
    if (!row || !from || !canDragRow(row, key, typesById)) return
    // The day the chip was picked up from lands on the drop day (a range moves as a whole).
    const delta = daysBetween(from, over.slice(4))
    const value = dateValueOf(row, key)
    if (delta === 0 || !value) return
    try {
      const result = await writes.run(row, (version, cur) =>
        api.updateProperties(row.summary.path, { [key]: shiftDateValue(dateValueOf(cur, key) ?? value, delta) }, version),
      )
      await reload(row)
      onWritten?.(row, result)
    } catch (err) {
      if (err instanceof ConflictError) {
        await reload(row)
        say(CALENDAR_TEXT.changed)
      } else say(err instanceof Error ? err.message : CALENDAR_TEXT.saveFailed)
    }
  }

  // A click on a day: a new object of the first view type that has the property, dated that day.
  // Not for Created at / Last updated, which a new object can't be given.
  const target = createType(viewTypes, key)
  const targetId = target?.id
  const create = useCallback(
    (day: Day) => {
      if (targetId) onCreate?.({ [key]: { start: day, resolution: 'day' } }, targetId)
    },
    [onCreate, targetId, key],
  )
  const canCreate = !!onCreate && !!targetId && !system

  const cap = mode === 'week' ? WEEK_DAY_CAP : MONTH_DAY_CAP
  const dayBody = (day: Day) => {
    const rows = placement.byDay.get(day) ?? []
    const shown = rows.length > cap ? rows.slice(0, cap) : rows
    return (
      <>
        {shown.map((r) => {
          const v = dateValueOf(r, key)
          // A time value shows its start time on its first day.
          const time = v?.resolution === 'time' && v.start.includes('T') && placement.startOf.get(r.summary.path) === day ? chipTime(v.start) : undefined
          return (
            <Chip
              key={r.summary.path}
              row={r}
              day={day}
              type={typesById[r.summary.type]}
              draggable={canDragRow(r, key, typesById)}
              selected={isSelected?.(r.summary.path) ?? false}
              time={time || undefined}
              onOpen={onOpen}
            />
          )
        })}
        {rows.length > shown.length && (
          <RowsPopover
            testId="calendar-more"
            label={CALENDAR_TEXT.more(rows.length - shown.length)}
            heading={formatLong(day)}
            rows={rows}
            typesById={typesById}
            multiType={multiType}
            onOpen={onOpen}
            className="h-6 self-start rounded-md px-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
          />
        )}
      </>
    )
  }

  const headers = weekdayHeaders(weekStart)
  const cell = (day: Day, heading: string, tall: boolean, outside: boolean) => (
    <DayCell key={day} day={day} outside={outside} today={day === today} tall={tall} heading={heading} onCreate={canCreate ? create : undefined}>
      {dayBody(day)}
    </DayCell>
  )
  return (
    <div data-testid="calendar-layout" data-mode={mode} data-property={key} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 data-testid="calendar-title" className="mr-auto text-[15px] font-semibold text-fg">
          {title}
        </h3>
        {placement.undated.length > 0 && (
          <RowsPopover
            testId="calendar-no-date"
            label={
              <>
                <Icon name="ph-tray" size={14} />
                {CALENDAR_TEXT.noDate(placement.undated.length)}
              </>
            }
            heading={CALENDAR_TEXT.noDateHeading}
            rows={placement.undated}
            typesById={typesById}
            multiType={multiType}
            onOpen={onOpen}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
          />
        )}
        <div role="group" aria-label={CALENDAR_TEXT.mode} className="flex items-center rounded-md border border-line p-0.5">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => mode !== m && onState(withCalendarConfig(state, { mode: m }))}
              className="h-6 rounded px-2 text-[13px] text-fg-muted hover:text-fg aria-pressed:bg-hover aria-pressed:text-fg"
            >
              {modeLabel(m)}
            </button>
          ))}
        </div>
        <div className="flex items-center">
          <button type="button" aria-label={CALENDAR_TEXT.previous} title={CALENDAR_TEXT.previous} className={NAV_BTN} onClick={() => setAnchor((a) => stepAnchor(mode, a, -1))}>
            <Icon name="ph-caret-left" size={14} />
          </button>
          <button type="button" className={cn(NAV_BTN, 'text-fg')} onClick={() => setAnchor(todayYmd())}>
            {CALENDAR_TEXT.today}
          </button>
          <button type="button" aria-label={CALENDAR_TEXT.next} title={CALENDAR_TEXT.next} className={NAV_BTN} onClick={() => setAnchor((a) => stepAnchor(mode, a, 1))}>
            <Icon name="ph-caret-right" size={14} />
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={() => setDragging(null)}>
        <div role="grid" aria-label={title} className="overflow-hidden rounded-lg border-t border-l border-line">
          {mode === 'month' ? (
            <>
              <div role="row" className="grid grid-cols-7">
                {headers.map((h) => (
                  <div key={h} role="columnheader" className="border-r border-b border-line px-2 py-1 text-[12px] text-fg-muted">
                    {h}
                  </div>
                ))}
              </div>
              {monthWeeks(anchor, weekStart).map((week) => (
                <div key={week[0]} role="row" className="grid grid-cols-7">
                  {week.map((day) => cell(day, String(Number(day.slice(8, 10))), false, !day.startsWith(month)))}
                </div>
              ))}
            </>
          ) : (
            <div role="row" className="grid grid-cols-7">
              {days.map((day, i) => cell(day, `${headers[i]} ${Number(day.slice(8, 10))}`, true, false))}
            </div>
          )}
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <ChipGhost row={dragging} type={typesById[dragging.summary.type]} /> : null}</DragOverlay>
      </DndContext>
      {notice && (
        <div role="status" className="text-[13px] text-fg-muted">
          {notice}
        </div>
      )}
    </div>
  )
}

export interface CalendarSettingsProps {
  types: TypeDef[]
  state: ViewState
  onState(next: ViewState): void
}

/** The layout's page in "Customize view": the date property, and Month or Week. */
export function CalendarSettings({ types, state, onState }: CalendarSettingsProps) {
  const config = calendarConfig(state.viewDefinition.calendarConfig)
  const key = resolveDateProperty(config, types)
  return (
    <div data-testid="calendar-settings" className="flex flex-col gap-1 p-1">
      <div className="px-1 pt-1 text-[12px] text-fg-muted">{CALENDAR_TEXT.dateProperty}</div>
      <MenuSelect
        label={CALENDAR_TEXT.dateProperty}
        value={key}
        options={propertyOptions(dateChoices(types))}
        onChange={(dateProperty) => onState(withCalendarConfig(state, { dateProperty }))}
        className="h-8 w-full"
      />
      <div className="px-1 pt-2 text-[12px] text-fg-muted">{CALENDAR_TEXT.show}</div>
      <div className="flex gap-1 pb-1">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={config.mode === m}
            onClick={() => config.mode !== m && onState(withCalendarConfig(state, { mode: m }))}
            className="flex-1 rounded-md px-2 py-1 text-[13px] hover:bg-hover aria-pressed:bg-hover"
          >
            {modeLabel(m)}
          </button>
        ))}
      </div>
    </div>
  )
}
