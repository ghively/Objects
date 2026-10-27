// "Date & Time": the start of the week (`ui.json` `calendar.weekStart`, shared with the calendar),
// 24-hour time and the date formatting (device settings; `properties/format.ts` reads them).
import { useState } from 'react'
import type { DeviceSettings } from '@/api/types'
import { saveCalendarUi } from '@/calendar/calendarUi'
import { useWeekStart } from '@/calendar/useCalendar'
import { useSettings } from '@/settings/useSettings'
import { OptionCards, SaveError, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

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
} as const

const T = DATE_TIME_TEXT

export const DATE_TIME_SEARCH: string[] = [
  T.startOfWeek,
  T.monday,
  T.sunday,
  T.twentyFour,
  T.dateFormatting,
  ...Object.values(T.formats),
]

const FORMATS = ['localized', 'DMY', 'MDY', 'YMD'] as const

export function DateTimeSection() {
  const settings = useSettings((s) => s.settings)
  const weekStart = useWeekStart()
  const [error, setError] = useState<string | null>(null)
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
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
