/**
 * Which of a type's property definitions are built-in rows, and (M33, choice 3) the order the
 * properties pane lists a type's definitions in. Kept apart from `ownProperties.ts` so the pane
 * can read it without a circle of imports through the note's header.
 */
import type { PropertyDef } from '@/api/types'

/** The system properties that are not `entity_*` kinds (a type has them only once added). */
const SYSTEM_KEYS = new Set(['coverImage', 'color'])

/** A system property: one every note has (`entity_*`), or the Cover image / Color system rows. */
export function isSystemProperty(d: Pick<PropertyDef, 'key' | 'type'>): boolean {
  return d.type.startsWith('entity_') || (SYSTEM_KEYS.has(d.key) && d.type === d.key)
}

/**
 * The built-in rows every type is saved with, in the order it is saved with them (the back end's
 * `_SYSTEM_DEFS`): a new type's list opens with these, and its own properties follow.
 */
const SAVED_FIRST: readonly string[] = ['title', 'collections', 'description', 'createdAt', 'lastUpdated', 'tags', 'icon', 'aliases']

/**
 * M33, choice 3: a typed note's own properties come first in the properties pane. A type's list
 * is saved built-in rows first (`SAVED_FIRST`, then any other built-in row it had), its own
 * properties after them, so a Task's pane opened with seven rows nobody fills in before Status.
 *
 * The pane shows the list with the run of built-in rows it opens with moved below the type's
 * own properties; everything else keeps its stored order (own properties among themselves, a
 * built-in row that sits between them, and built-in rows added later, after the own ones, which
 * stay last). Display only: the type's list is not changed.
 *
 * An order arranged by hand is kept. The list (Type settings: drag) is one list of built-in and
 * own rows together, so "arranged by hand" is read from it: the built-in rows still stand as
 * they are saved only when the list opens with `SAVED_FIRST`, as a block, in that order. An own
 * property dragged above or into the block, or the block's rows rearranged or one dragged out of
 * it, breaks that, and the stored order is shown exactly (null here).
 *
 * Null also when there is nothing to move: no property of its own (a plain Note), or no built-in
 * row on top.
 */
export function ownFirst(defs: readonly PropertyDef[]): PropertyDef[] | null {
  const block = SAVED_FIRST.filter((key) => defs.some((d) => d.key === key && isSystemProperty(d)))
  if (!block.every((key, i) => defs[i].key === key && isSystemProperty(defs[i]))) return null
  let lead = 0
  while (lead < defs.length && isSystemProperty(defs[lead])) lead++
  let lastOwn = defs.length - 1
  while (lastOwn >= lead && isSystemProperty(defs[lastOwn])) lastOwn--
  if (lead === 0 || lastOwn < lead) return null
  return [...defs.slice(lead, lastOwn + 1), ...defs.slice(0, lead), ...defs.slice(lastOwn + 1)]
}

/** The order the properties pane lists a type's definitions in (`ownFirst`, else as stored). */
export function paneOrder(defs: readonly PropertyDef[]): readonly PropertyDef[] {
  return ownFirst(defs) ?? defs
}
