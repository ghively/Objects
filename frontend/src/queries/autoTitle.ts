// A query's automatic title, used while `titleIsCustom` is false.
import type { Query, QueryDefinition, TypeDef } from '@/api/types'
import { typePlural } from '@/lib/typeLabel'
import { searchTermsOf } from './runQuery'

export const ALL_NOTES_TITLE = 'All notes'

export interface TitleCtx {
  /** With `name` (and `basic`) given, the built-in Page and DailyNote read "Notes" and "Daily notes" (M32). */
  types: (Pick<TypeDef, 'id' | 'pluralName'> & Partial<Pick<TypeDef, 'name' | 'basic'>>)[]
  /** Tag object id → title. */
  tagIdsToTitles: Record<string, string>
}

/** The plural a title names a type by: as the screen shows it when the type's name is known. */
function pluralOf(t: TitleCtx['types'][number] | undefined): string | undefined {
  if (!t) return undefined
  return t.name === undefined ? t.pluralName : typePlural({ ...t, name: t.name })
}

/** "Tasks, Notes tagged work not tagged old "term"": plural names, or "All notes" with no types. */
export function autoTitle(def: QueryDefinition, ctx: TitleCtx): string {
  const names = def.types.map((s) => pluralOf(ctx.types.find((t) => t.id === s.id))).filter((n): n is string => !!n)
  let out = names.length > 0 ? names.join(', ') : ALL_NOTES_TITLE
  const tagNames = (ids: string[] | undefined) => (ids ?? []).map((id) => ctx.tagIdsToTitles[id]).filter((n): n is string => !!n)
  const tagged = tagNames(def.tags?.ids)
  if (tagged.length > 0) out += ` tagged ${tagged.join(', ')}`
  const not = tagNames(def.excludeTags?.ids)
  if (not.length > 0) out += ` not tagged ${not.join(', ')}`
  const terms = searchTermsOf(def)
  if (terms.length > 0) out += ` ${terms.map((t) => `"${t}"`).join(', ')}`
  return out
}

/** A loaded query whose `titleIsCustom` is absent counts as custom when its name is non-empty. */
export function titleIsCustom(q: Pick<Query, 'name' | 'titleIsCustom'>): boolean {
  return q.titleIsCustom ?? q.name.trim() !== ''
}

/** The title to show: the name when custom, else the automatic one. */
export function queryTitle(q: Pick<Query, 'name' | 'titleIsCustom' | 'definition'>, ctx: TitleCtx): string {
  return titleIsCustom(q) ? q.name : autoTitle(q.definition, ctx)
}
