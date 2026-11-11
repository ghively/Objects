// M32 (notes first): the name a type shows on screen. The built-in Page type reads "Note" /
// "Notes" and the built-in DailyNote "Daily note" / "Daily notes", for as long as their stored
// names are the built-in ones; a type the user renamed, and every other type, shows its own name
// and plural. Display only: the type file, `type: Page` in front matter and the folder names are
// never changed.
import type { TypeDef } from '@/api/types'
import { DAILY_NOTE, DAILY_NOTES, NOTE, NOTES } from './words'

/** What the helpers read of a type (a whole `TypeDef` fits). */
export type TypeNames = Pick<TypeDef, 'name' | 'pluralName'> & { id?: string; basic?: boolean }

const PAGE = { id: 'page', name: 'Page', pluralName: 'Pages' } as const
const DAILY = { id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes' } as const

/** The built-in type `b` whose stored name is still the built-in one. */
const isBuiltIn = (t: TypeNames, b: typeof PAGE | typeof DAILY): boolean =>
  t.name === b.name && (t.basic === true || t.id === b.id)

/** The built-in Page type, its stored name still "Page". */
export function isBuiltInPage(t: TypeNames | null | undefined): boolean {
  return !!t && isBuiltIn(t, PAGE)
}

/** The built-in DailyNote type, its stored name still "DailyNote". */
export function isBuiltInDailyNote(t: TypeNames | null | undefined): boolean {
  return !!t && isBuiltIn(t, DAILY)
}

/** A type's name as the screen shows it ("Note", "Daily note", else its own name). */
export function typeLabel(t: TypeNames | null | undefined, fallback = ''): string {
  if (!t) return fallback
  if (isBuiltIn(t, PAGE)) return NOTE
  if (isBuiltIn(t, DAILY)) return DAILY_NOTE
  return t.name
}

/** A type's plural as the screen shows it ("Notes", "Daily notes", else its own plural). */
export function typePlural(t: TypeNames | null | undefined, fallback = ''): string {
  if (!t) return fallback
  // A plural the user changed is theirs, even while the name is the built-in one.
  if (isBuiltIn(t, PAGE) && t.pluralName === PAGE.pluralName) return NOTES
  if (isBuiltIn(t, DAILY) && t.pluralName === DAILY.pluralName) return DAILY_NOTES
  return t.pluralName
}
