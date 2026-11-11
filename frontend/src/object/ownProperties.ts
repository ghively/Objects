/**
 * M32, item 11: whether a type has properties of its own, read from its definition. A type that
 * has none (the built-in Note and Daily note) shows only system rows in the properties pane
 * (Collections, Description, Created at, Last updated, Tags, Icon, Aliases), so its notes open
 * with the pane closed and the text gets the room.
 */
import type { PropertyDef, TypeDef } from '@/api/types'
import { isDailyNoteType } from './ObjectHeader'

/** The system properties that are not `entity_*` kinds (a type has them only once added). */
const SYSTEM_KEYS = new Set(['coverImage', 'color'])

/** A Daily note's own two fields: its title shows the date, its header the Reviewed button. */
const DAILY_NOTE_KEYS = new Set(['date', 'reviewed'])

/** A system property: one every note has (`entity_*`), or the Cover image / Color system rows. */
export function isSystemProperty(d: Pick<PropertyDef, 'key' | 'type'>): boolean {
  return d.type.startsWith('entity_') || (SYSTEM_KEYS.has(d.key) && d.type === d.key)
}

/**
 * Whether `type` has properties of its own: a definition that is not a system row, or a computed
 * other side. A Daily note's Date and Reviewed don't count (they show in its header). An unknown
 * type (not loaded yet) has none.
 */
export function typeHasOwnProperties(type: TypeDef | undefined): boolean {
  if (!type) return false
  if ((type.counterparts?.length ?? 0) > 0) return true
  const daily = isDailyNoteType(type)
  return type.propertyDefinitions.some((d) => !isSystemProperty(d) && !(daily && DAILY_NOTE_KEYS.has(d.key)))
}
