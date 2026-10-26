import { z } from 'zod'

export const DATE_RESOLUTIONS = ['time', 'day'] as const
export const dateResolutionSchema = z.enum(DATE_RESOLUTIONS)
export type DateResolution = z.infer<typeof dateResolutionSchema>

export type DatePrecision = DateResolution | 'both'
export type DateVariables = Record<string, string | undefined>

const datestamp = z.object({
  dateResolution: dateResolutionSchema,
  date: z.string(),
})
export type Datestamp = z.infer<typeof datestamp>

export const occurrenceLogEntrySchema = z.object({
  scheduledDate: datestamp,
  actionDate: z.string(),
  action: z.union([
    z.object({ type: z.literal('task-completed'), statusId: z.string().optional() }),
    z.object({ type: z.literal('task-skipped') }),
    z.object({ type: z.literal('task-excused') }),
  ]),
})
export type OccurrenceLogEntry = z.infer<typeof occurrenceLogEntrySchema>

export const futureScheduleEntrySchema = z.object({
  scheduledDate: datestamp,
})
export type FutureScheduleEntry = z.infer<typeof futureScheduleEntrySchema>

const recurrenceBase = {
  originalStartDate: datestamp,
  endDate: z.string().optional(),
  occurrenceLog: z.array(occurrenceLogEntrySchema),
  exceptions: z.array(
    z.object({
      originalDate: datestamp,
      newDate: datestamp,
    })
  ),
}

export const dueDateRecurrence = z.object({
  schedulingMode: z.literal('dueDate'),
  rrule: z.string(),
  ...recurrenceBase,
})

export const RECURRENCE_INTERVAL_UNITS = ['day', 'week', 'month', 'year'] as const
export type RecurrenceIntervalUnit = (typeof RECURRENCE_INTERVAL_UNITS)[number]

const completionDateRecurrence = z.object({
  schedulingMode: z.literal('completionDate'),
  interval: z.object({
    amount: z.number().int().positive(),
    unit: z.enum(RECURRENCE_INTERVAL_UNITS),
  }),
  ...recurrenceBase,
})

const recurrence = z.discriminatedUnion('schedulingMode', [dueDateRecurrence, completionDateRecurrence])
export type Recurrence = z.infer<typeof recurrence>

export const SCHEDULING_MODES = ['dueDate', 'completionDate'] as const
export type SchedulingMode = (typeof SCHEDULING_MODES)[number]

export const TIME_OF_DAY_REGEX = /^\d{2}:\d{2}$/

export const reminderSchema = z.object({
  active: z.boolean(),
  /** Offset for time-resolution dates: fire this many minutes before startTime. */
  minutesBefore: z.number().int().nonnegative(),
  /** Offset for day-resolution dates: fire this many days before the calendar day. */
  daysBefore: z.number().int().nonnegative(),
  /** Local wall-clock time (HH:mm) for day-resolution reminders; required when the reminder is active on a day date. */
  timeOfDay: z.string().regex(TIME_OF_DAY_REGEX).optional(),
})
export type Reminder = z.infer<typeof reminderSchema>

export const dateObject = z.object({
  dateResolution: dateResolutionSchema,
  startTime: z.string(),
  endTime: z.string().optional(),
  recurrence: recurrence.optional(),
  reminder: reminderSchema.optional(),
})
export type DateObject = z.infer<typeof dateObject>

/** Template-only date fill. Lives on the entity datetime property, not on DateObject. */
export const DATE_TEMPLATE_VARIABLES = ['day', 'week', 'month', 'year'] as const
export type DateTemplateVariable = (typeof DATE_TEMPLATE_VARIABLES)[number]

export function isDateTemplateVariable(value: unknown): value is DateTemplateVariable {
  return typeof value === 'string' && (DATE_TEMPLATE_VARIABLES as readonly string[]).includes(value)
}

export type DateObjectConstraints = {
  // constraints
  resolutionConstraint?: DateResolution | undefined
  endTimeSettings?: 'required' | 'notAllowed' | undefined
  /** When true, the date picker exposes reminder configuration for this property. */
  supportsReminders?: boolean | undefined
  // initialization
  endTimePreference?: 'initialize' | undefined
  resolutionPreference: DateResolution
  startTimeDefault?: string // ISO string
  endTimeDefault?: string // ISO string
  // UI
  hideDeleteOption?: boolean | undefined
}

const scheduleOptions = ['today', 'tomorrow', 'nextWeek', 'nextMonth'] as const
export type ScheduleOption = (typeof scheduleOptions)[number]

export function isValidDateForResolution(date: string, resolution: DateResolution): boolean {
  if (resolution === 'time') return true
  else {
    const dateObj = new Date(date)
    const hour = dateObj.getUTCHours()
    const minute = dateObj.getUTCMinutes()
    const seconds = dateObj.getUTCSeconds()
    const milliseconds = dateObj.getUTCMilliseconds()
    if (hour !== 0 || minute !== 0 || seconds !== 0 || milliseconds !== 0) return false
    return true
  }
}

export function isValidDateObject(date: DateObject): boolean {
  if (date.endTime && new Date(date.endTime).getTime() < new Date(date.startTime).getTime()) return false
  if (date.dateResolution === 'time') {
    if (!date.startTime) return false
  }
  if (date.dateResolution === 'day') {
    if (!date.startTime) return false
    if (!isValidDateForResolution(date.startTime, date.dateResolution)) return false
    if (date.endTime && !isValidDateForResolution(date.endTime, date.dateResolution)) return false
  }
  if (date.reminder) {
    if (typeof date.reminder.active !== 'boolean') return false
    if (!Number.isInteger(date.reminder.minutesBefore) || date.reminder.minutesBefore < 0) return false
    if (!Number.isInteger(date.reminder.daysBefore) || date.reminder.daysBefore < 0) return false
    if (date.reminder.timeOfDay !== undefined && !TIME_OF_DAY_REGEX.test(date.reminder.timeOfDay)) return false
    if (date.reminder.active && date.dateResolution === 'day' && !date.reminder.timeOfDay) return false
  }
  return true
}
