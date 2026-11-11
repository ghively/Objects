// The sidebar's Object Types order: 'alphabetical' | 'manual' and, for manual, the `objects`
// section's `ids`,
// both kept in `ui.json`.
import type { UiState } from '@/api/types'
import { saveSidebarUi } from './SidebarSections'

export const SORT_MANUALLY = 'Sort manually'
export const SORT_ALPHABETICALLY = 'Sort alphabetically'
/** Our string: the header `...` button's name. */
export const TYPES_MENU_LABEL = 'Types options'

export type TypeSort = 'alphabetical' | 'manual'

/**
 * The entries (type ids and 'queries') in sidebar order. Alphabetical (also when unset) sorts by
 * the shown name; manual follows `ids`, dropping unknown ids, with entries it lacks (a new type)
 * after them by name.
 */
export function orderTypeEntries(
  entries: string[],
  names: Record<string, string>,
  sort: TypeSort | undefined,
  ids: string[] | undefined,
): string[] {
  const byName = (a: string, b: string) => (names[a] ?? a).localeCompare(names[b] ?? b, undefined, { sensitivity: 'base' })
  const sorted = [...entries].sort(byName)
  if (sort !== 'manual' || !Array.isArray(ids)) return sorted
  const known = new Set(entries)
  const listed = [...new Set(ids.filter((id) => typeof id === 'string' && known.has(id)))]
  return [...listed, ...sorted.filter((id) => !listed.includes(id))]
}

export const typeSortOf = (ui: UiState): TypeSort => (ui.objectsSectionSortOption === 'manual' ? 'manual' : 'alphabetical')

/** Switch to manual, keeping the order on screen as the saved one. */
export function sortTypesManually(shown: string[]): Promise<void> {
  return saveSidebarUi({ objectsSectionSortOption: 'manual', workspace: { objects: { ids: shown } } })
}

/** Switch to alphabetical; the saved manual order stays for a switch back. */
export function sortTypesAlphabetically(): Promise<void> {
  return saveSidebarUi({ objectsSectionSortOption: 'alphabetical' })
}

/** Save a new manual order. */
export function saveTypeOrder(ids: string[]): Promise<void> {
  return saveSidebarUi({ workspace: { objects: { ids } } })
}
