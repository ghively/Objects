// Status categories of a Task (Capacities' `LabelOption.statusCategory`): the four groups in their
// order and labels (`RootTaskCheckbox.menu.statusGroup.*`), and what a row's status falls into.
import type { LabelOption, PropertyDef, Row, StatusCategory, TypeDef } from '@/api/types'

export const STATUS_CATEGORIES: readonly { key: StatusCategory; label: string }[] = [
  { key: 'not-started', label: 'Not started' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
]

/** The type's status property: the label marked `isStatus`, else a label keyed `status`. */
export function statusDef(type: TypeDef | undefined): PropertyDef | undefined {
  const defs = type?.propertyDefinitions ?? []
  return (
    defs.find((d) => d.type === 'label' && d.options.isStatus) ??
    defs.find((d) => d.type === 'label' && d.key === 'status')
  )
}

/** An option's category; an option without one counts as not started. */
export const optionCategory = (o: Pick<LabelOption, 'statusCategory'>): StatusCategory => o.statusCategory ?? 'not-started'

/** The row's status text (the first one), or null when it has none. */
export function statusText(row: Row, type: TypeDef | undefined): string | null {
  const def = statusDef(type)
  const raw = row.values[def?.key ?? 'status']
  const first = Array.isArray(raw) ? raw[0] : raw
  return typeof first === 'string' && first.trim() ? first : null
}

/** The option the row's status names, if the type knows it. */
export function statusOption(row: Row, type: TypeDef | undefined): LabelOption | undefined {
  const text = statusText(row, type)
  if (text === null) return undefined
  return (statusDef(type)?.options.set ?? []).find((o) => o.text === text)
}

/** The row's status category. No status, or a status the type doesn't know, is not started. */
export function categoryOf(row: Row, type: TypeDef | undefined): StatusCategory {
  const opt = statusOption(row, type)
  return opt ? optionCategory(opt) : 'not-started'
}

/** Open: the status is not in the `done` category (a task without a status is open). */
export const isOpen = (row: Row, type: TypeDef | undefined): boolean => categoryOf(row, type) !== 'done'

/** The type's status options grouped by category, in category order; empty groups included. */
export function statusOptionsByCategory(type: TypeDef | undefined): { key: StatusCategory; label: string; options: LabelOption[] }[] {
  const set = statusDef(type)?.options.set ?? []
  return STATUS_CATEGORIES.map((c) => ({ ...c, options: set.filter((o) => optionCategory(o) === c.key) }))
}

/** The first option of a category (the checkbox toggles between first not-started and first done). */
export function firstOptionOf(type: TypeDef | undefined, category: StatusCategory): LabelOption | undefined {
  return (statusDef(type)?.options.set ?? []).find((o) => optionCategory(o) === category)
}
