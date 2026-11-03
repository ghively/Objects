// "Date & Time": the start of the week (`ui.json` `calendar.weekStart`, shared with the calendar),
// 24-hour time, the date formatting and the time zone (device settings; `properties/format.ts`
// and `lib/zonedTime.ts` read them; the server applies `timeZone` to `Space.tz`).
import { useMemo, useState } from 'react'
import type { DeviceSettings } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { saveCalendarUi } from '@/calendar/calendarUi'
import { useWeekStart } from '@/calendar/useCalendar'
import { formatDate } from '@/properties/format'
import { useSettings } from '@/settings/useSettings'
import { OptionCards, SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

export const DATE_TIME_TEXT = {
  heading: 'Date & Time', // DateAndTimeSettings.heading
  description: 'Manage your preferences for how time and dates get displayed.', // DateAndTimeSettings.description
  startOfWeek: 'Start of the week', // DateAndTimeSettings.startOfWeek.label
  startOfWeekDescription: 'Select whether a week should start on a Monday or on a Sunday.',
  monday: 'Monday', // DateAndTimeSettings.startOfWeek.optionMonday
  sunday: 'Sunday', // DateAndTimeSettings.startOfWeek.optionSunday
  twentyFour: '24-hour time', // DateAndTimeSettings.twentyFourHourTime.label
  twentyFourDescription: 'Displays time in 24-hour time format (e.g. 16:24).',
  dateFormatting: 'Date formatting', // DateAndTimeSettings.dateFormatting.label
  dateFormattingDescription: 'Choose between date formatting based on your language or explicit formatting.',
  formats: {
    localized: 'Localized',
    DMY: 'day-month-year',
    MDY: 'month/day/year',
    YMD: 'year-month-day (ISO 8601)',
  }, // DateAndTimeSettings.dateFormatting.*
  timeZone: 'Time zone', // DateAndTimeSettings.timeZone.label
  timeZoneDescription: 'Select your preferred time zone.', // DateAndTimeSettings.timeZone.description
  timeZoneMismatch: 'Your time zone in Object does not match the time zone of your device.', // our string, adapted from DateAndTimeSettings.timeZone.missmatch
  timeZoneReset: 'Set to local time zone', // DateAndTimeSettings.timeZone.resetButton
  timeZoneSearch: 'Search time zones', // our string
  noResults: 'No results', // AppSettings.search.noResults
  preview: 'Preview', // Object's `preview` string, as the live preview's accessible name
} as const

const T = DATE_TIME_TEXT

export const DATE_TIME_SEARCH: string[] = [
  T.startOfWeek,
  T.monday,
  T.sunday,
  T.twentyFour,
  T.dateFormatting,
  ...Object.values(T.formats),
  T.timeZone,
  T.timeZoneReset,
]

/** The device's IANA zone (`Intl`'s resolved zone). */
export function deviceTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Every IANA zone `Intl` knows, plus the device's zone (some engines leave it out). */
export function timeZoneList(): string[] {
  let list: string[] = []
  try {
    list = Intl.supportedValuesOf('timeZone')
  } catch {
    list = []
  }
  const device = deviceTimeZone()
  return list.includes(device) ? list : [device, ...list].sort()
}

/** The time zone picker: a button naming the zone, a searchable list in a popover. */
function TimeZoneSelect({ value, onSelect }: { value: string; onSelect(zone: string): void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const zones = useMemo(() => timeZoneList(), [])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s+/g, '_')
    return zones.filter((z) => !needle || z.toLowerCase().includes(needle)).slice(0, 200)
  }, [zones, q])
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={T.timeZone}
          className="inline-flex h-8 w-fit max-w-full items-center gap-1.5 rounded-md border border-line bg-raised px-3 text-[14px] text-fg hover:bg-hover"
        >
          <Icon name="ph-globe" size={14} />
          <span className="truncate">{value}</span>
          <Icon name="ph-caret-down" size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] border-line bg-raised p-2 text-fg">
        <input
          autoFocus
          type="search"
          aria-label={T.timeZoneSearch}
          placeholder={T.timeZoneSearch}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-1 h-8 w-full rounded-md border border-line bg-transparent px-2 text-[14px] outline-none focus:border-fg-muted"
        />
        <ul role="listbox" aria-label={T.timeZone} className="max-h-[260px] overflow-y-auto">
          {shown.map((z) => (
            <li key={z}>
              <button
                type="button"
                role="option"
                aria-selected={z === value}
                onClick={() => {
                  onSelect(z)
                  setOpen(false)
                  setQ('')
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate">{z}</span>
                {z === value && <Icon name="ph-check" size={14} />}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1.5 text-[13px] text-fg-muted">{T.noResults}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

const FORMATS = ['localized', 'DMY', 'MDY', 'YMD'] as const

export function DateTimeSection() {
  const settings = useSettings((s) => s.settings)
  const weekStart = useWeekStart()
  const [error, setError] = useState<string | null>(null)
  // No setting (`null`) is the device's zone; picking the device's zone stores `null` again, so
  // the setting keeps following the device (our choice).
  const device = deviceTimeZone()
  const zone = settings.timeZone || device
  const mismatch = zone !== device
  const set = (p: Partial<DeviceSettings>) => {
    setError(null)
    useSettings
      .getState()
      .patch(p)
      .catch((e: unknown) => setError(errorText(e)))
  }
  return (
    <div>
      <SectionHeader icon="ph-calendar-blank" heading={T.heading} description={T.description} />
      <SettingGroup title={T.startOfWeek} help={T.startOfWeekDescription}>
        <OptionCards
          label={T.startOfWeek}
          value={weekStart}
          options={[
            { value: 'monday', label: T.monday },
            { value: 'sunday', label: T.sunday },
          ]}
          onChange={(v) => {
            setError(null)
            saveCalendarUi({ weekStart: v }).catch((e: unknown) => setError(errorText(e)))
          }}
        />
      </SettingGroup>
      <SwitchRow title={T.twentyFour} help={T.twentyFourDescription} checked={settings.twentyFourHourTime} onChange={(v) => set({ twentyFourHourTime: v })} />
      <SettingGroup title={T.dateFormatting} help={T.dateFormattingDescription}>
        <OptionCards
          label={T.dateFormatting}
          value={settings.dateFormatting}
          columns={2}
          options={FORMATS.map((f) => ({ value: f, label: T.formats[f] }))}
          onChange={(dateFormatting) => set({ dateFormatting })}
        />
        {/* Object shows a live preview of the chosen formatting: now, as dates display. */}
        <p role="status" aria-label={T.preview} className="text-[13px] text-fg-muted">
          {formatDate({ start: new Date().toISOString(), resolution: 'time' })}
        </p>
      </SettingGroup>
      <SettingGroup title={T.timeZone} help={T.timeZoneDescription}>
        <TimeZoneSelect value={zone} onSelect={(z) => set({ timeZone: z === device ? null : z })} />
        {mismatch && (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-[13px] text-fg-muted">
              {T.timeZoneMismatch}
            </p>
            <SecondaryButton onClick={() => set({ timeZone: null })}>{T.timeZoneReset}</SecondaryButton>
          </div>
        )}
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
