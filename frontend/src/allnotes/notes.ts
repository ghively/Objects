// M32: what the notes lists hold (Home's "Recent" and the Notes view) and how they are ordered:
// every note by when it was last edited, daily notes included, tasks, tags and templates left
// out. Pure: the callers bring the summaries the app already holds.
import type { ObjectSummary, TypeDef } from '@/api/types'
import { addDays } from '@/calendar/dates'
import { formatInZone, zonedParts } from '@/lib/zonedTime'
import { formatDate } from '@/properties/format'
import { useSettings } from '@/settings/useSettings'

/** Notes shown under Home's "Recent". */
export const RECENT_NOTES = 12

type TypeLookup = Readonly<Record<string, TypeDef | undefined>> | ReadonlyMap<string, TypeDef>

function typeFor(types: TypeLookup, id: string): TypeDef | undefined {
  return types instanceof Map ? types.get(id) : (types as Record<string, TypeDef | undefined>)[id]
}

/** The Task type (the basic one, by flag and name or by id), as `tasks/useTaskRows` finds it. */
export function isTaskTypeOf(type: TypeDef | undefined, typeId: string): boolean {
  return type ? type.id === 'task' || (type.basic && type.name.toLowerCase() === 'task') : typeId === 'task'
}

/** The Tag type (id `tag`, or named Tag). */
export function isTagTypeOf(type: TypeDef | undefined, typeId: string): boolean {
  return type ? type.id === 'tag' || type.name.toLowerCase() === 'tag' : typeId === 'tag'
}

/** Whether a type's notes are listed: every type but Task and Tag. */
export function isListedType(type: TypeDef | undefined, typeId: string): boolean {
  return !isTaskTypeOf(type, typeId) && !isTagTypeOf(type, typeId)
}

/** Whether `o` is in the notes lists: not a task, not a tag, not a template. */
export function isListedNote(o: Pick<ObjectSummary, 'type' | 'template'>, types: TypeLookup): boolean {
  return o.template == null && isListedType(typeFor(types, o.type), o.type)
}

/** When a note was last edited: its `lastUpdated`, else when it was created, else ''. */
export function editedAt(o: Pick<ObjectSummary, 'lastUpdated' | 'createdAt'>): string {
  return o.lastUpdated || o.createdAt || ''
}

/** Newest edit first; notes with no time last, by title. */
export function byEditedDesc(a: ObjectSummary, b: ObjectSummary): number {
  const x = editedAt(a)
  const y = editedAt(b)
  if (x !== y) return x < y ? 1 : -1
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
}

/** Home's "Recent": the last `limit` notes edited, newest first. */
export function recentNotes(objects: readonly ObjectSummary[], types: readonly TypeDef[], limit = RECENT_NOTES): ObjectSummary[] {
  const byId = new Map(types.map((t) => [t.id, t]))
  return objects
    .filter((o) => isListedNote(o, byId) && editedAt(o) !== '')
    .sort(byEditedDesc)
    .slice(0, limit)
}

export type NotesGroupId = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

/** The Notes view's groups, in order. */
export const NOTES_GROUPS: readonly { id: NotesGroupId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'earlier', label: 'Earlier' },
]

/**
 * The group of a note edited on `day` (`YYYY-MM-DD`, '' when unknown), seen from `today`. "This
 * week" is the five days before yesterday (our call: the last seven days, so Monday's list still
 * shows Friday's notes as this week's).
 */
export function editedGroup(day: string, today: string): NotesGroupId {
  if (!day) return 'earlier'
  if (day >= today) return 'today'
  if (day === addDays(today, -1)) return 'yesterday'
  return day >= addDays(today, -6) ? 'thisWeek' : 'earlier'
}

/** The day (`YYYY-MM-DD`, in the Time zone setting) of an edit stamp; '' when it is no date. */
export function editedDay(at: string): string {
  if (!at) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : zonedParts(d).date
}

/** Our strings. */
export const EDITED_TEXT = { yesterday: 'Yesterday' } as const

/** When a note was edited, short: the time for today, "Yesterday", else the date. */
export function editedLabel(at: string, today: string): string {
  const day = editedDay(at)
  if (!day) return ''
  if (day === today && !/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const twentyFour = useSettings.getState().settings.twentyFourHourTime
    return formatInZone(at, { hour: 'numeric', minute: '2-digit', ...(twentyFour ? { hourCycle: 'h23' as const } : { hour12: true }) })
  }
  if (day === addDays(today, -1)) return EDITED_TEXT.yesterday
  return formatDate({ start: day, resolution: 'day' })
}
