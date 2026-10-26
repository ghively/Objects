// The Overview's sections: which exist for a type, in what order, which are also header tabs.
// Pure functions over the saved `Views`, the type, and the space's collections and queries.
import type { Collection, DashboardSection, DashboardSectionKey, Icon, Query, TypeDef, Views } from '@/api/types'

/** The built-in sections a type page can show (`noBacklinks` comes with M5, `pinned` is a collection's). */
export const BUILTIN_KEYS = ['recentlyAccessed', 'collections', 'queries', 'inNoCollection', 'notTagged'] as const
export type BuiltinKey = (typeof BUILTIN_KEYS)[number]

export const SECTION_TEXT = {
  overview: 'Overview',
  all: 'All',
  recentlyAccessed: 'Recently Opened',
  recentlyEmptyTitle: 'No recently accessed content',
  recentlyEmptyBody: 'Objects you recently accessed will appear here.',
  collections: 'Collections',
  collectionsEmptyTitle: 'No collections',
  collectionsEmptyBody: 'You can change this by creating a new collection.',
  createCollection: 'Create collection',
  queries: 'Queries',
  queriesEmptyTitle: 'No queries',
  queriesEmptyBody: 'Queries you create in this database will appear here.',
  createQuery: 'Create query',
  inNoCollection: 'Not in any collection',
  notTagged: 'Not tagged',
  openAll: 'Open all',
  customize: 'Customize Overview',
  visibleSections: 'Visible Sections',
  hiddenSections: 'Hidden Sections',
  addSection: 'Add a section',
  queriesAndViews: 'Queries & Views',
  dashboardOnly: ' (Overview only)',
  sectionEmpty: 'No content for this section available.',
}

const BUILTIN_META: Record<BuiltinKey, { label: string; icon: string; inFullView: boolean }> = {
  recentlyAccessed: { label: SECTION_TEXT.recentlyAccessed, icon: 'ph-clock-clockwise', inFullView: false },
  collections: { label: SECTION_TEXT.collections, icon: 'ph-stack', inFullView: false },
  queries: { label: SECTION_TEXT.queries, icon: 'ph-magnifying-glass', inFullView: false },
  inNoCollection: { label: SECTION_TEXT.inNoCollection, icon: 'ph-placeholder', inFullView: true },
  notTagged: { label: SECTION_TEXT.notTagged, icon: 'ph-tag', inFullView: true },
}

export const isBuiltin = (key: string): key is BuiltinKey => key in BUILTIN_META
export const isQueryKey = (key: string): key is `query:${string}` => key.startsWith('query:')
export const isCollectionKey = (key: string): key is `collection:${string}` => key.startsWith('collection:')
export const keyId = (key: string): string => key.slice(key.indexOf(':') + 1)

/** Whether a section is also a header tab, fixed per kind (reference RootEntity). */
export function sectionInFullView(key: string): boolean {
  if (isQueryKey(key) || isCollectionKey(key)) return true
  return isBuiltin(key) ? BUILTIN_META[key].inFullView : false
}

export const typeHasTags = (type: Pick<TypeDef, 'propertyDefinitions'>): boolean =>
  type.propertyDefinitions.some((d) => d.key === 'tags' || d.type === 'entity_tags')

export interface SectionCtx {
  collections: Collection[]
  queries: Query[]
}

export interface RenderedSection {
  key: DashboardSectionKey
  /** The tab and heading label: the saved `title`, else the kind's. */
  label: string
  /** Without the rename. */
  defaultLabel: string
  /** An Iconify id (ph-...). */
  icon: string
  /** The collection's or query's own icon, when it has one. */
  ownIcon: Icon | null
  collapsed: boolean
  viewDefinition?: DashboardSection['viewDefinition']
  title?: string
  inFullView: boolean
  /** In `removedSections`: shown under "Hidden Sections", no Overview section and no tab. */
  hidden: boolean
  /** The id of the collection or query behind a `collection:` or `query:` key. */
  refId?: string
}

type Described = Omit<RenderedSection, 'collapsed' | 'hidden' | 'viewDefinition' | 'title' | 'label'>

/** What `key` is for `type`, or null when it no longer names anything that can be shown. */
function describe(type: TypeDef, key: string, ctx: SectionCtx): Described | null {
  if (isBuiltin(key)) {
    if (key === 'notTagged' && !typeHasTags(type)) return null
    const m = BUILTIN_META[key]
    return { key, defaultLabel: m.label, icon: m.icon, ownIcon: null, inFullView: m.inFullView }
  }
  if (isCollectionKey(key)) {
    const c = ctx.collections.find((x) => x.id === keyId(key))
    if (!c || !c.typeIds.includes(type.id)) return null
    return { key, defaultLabel: c.name, icon: 'ph-stack', ownIcon: c.icon, inFullView: true, refId: c.id }
  }
  if (isQueryKey(key)) {
    const q = ctx.queries.find((x) => x.id === keyId(key))
    if (!q) return null
    return { key, defaultLabel: q.name || 'Query', icon: 'ph-magnifying-glass', ownIcon: q.icon, inFullView: true, refId: q.id }
  }
  return null
}

/**
 * Every section of the Overview in the saved order, then the removed ones (`hidden: true`).
 * A `collection:<id>` for each collection holding the type that is neither saved nor removed is
 * appended. Keys that no longer name anything (a deleted query, a collection of another type,
 * `notTagged` on a type without tags, `noBacklinks`, `pinned`) are dropped.
 */
export function buildSections(type: TypeDef, views: Views, ctx: SectionCtx): RenderedSection[] {
  const removed = new Set(views.dashboard.removedSections)
  const out: RenderedSection[] = []
  const seen = new Set<string>()
  const push = (s: { key: DashboardSectionKey; collapsed: boolean; viewDefinition?: DashboardSection['viewDefinition']; title?: string }, hidden: boolean) => {
    if (seen.has(s.key)) return
    const d = describe(type, s.key, ctx)
    if (!d) return
    seen.add(s.key)
    out.push({
      ...d,
      label: s.title?.trim() ? s.title : d.defaultLabel,
      collapsed: s.collapsed,
      viewDefinition: s.viewDefinition,
      title: s.title,
      hidden,
    })
  }
  for (const s of views.dashboard.sections) if (!removed.has(s.key)) push(s, false)
  for (const c of ctx.collections) {
    const key: DashboardSectionKey = `collection:${c.id}`
    if (c.typeIds.includes(type.id) && !removed.has(key)) push({ key, collapsed: false }, false)
  }
  for (const key of views.dashboard.removedSections) push({ key: key as DashboardSectionKey, collapsed: false }, true)
  return out
}

export const visibleSections = (all: RenderedSection[]): RenderedSection[] => all.filter((s) => !s.hidden)
export const hiddenSections = (all: RenderedSection[]): RenderedSection[] => all.filter((s) => s.hidden)

/** The header tabs: visible full-view sections, in order. */
export const tabSections = (all: RenderedSection[]): RenderedSection[] =>
  all.filter((s) => !s.hidden && s.inFullView)

/** What "Add a section" offers: removed built-ins, then the type's collections and queries not shown. */
export function addableSections(type: TypeDef, all: RenderedSection[], ctx: SectionCtx): RenderedSection[] {
  const present = new Set(all.filter((s) => !s.hidden).map((s) => s.key))
  const out: RenderedSection[] = []
  const offer = (key: DashboardSectionKey) => {
    if (present.has(key) || out.some((s) => s.key === key)) return
    const d = describe(type, key, ctx)
    if (d) out.push({ ...d, label: d.defaultLabel, collapsed: false, hidden: false })
  }
  for (const s of all) if (s.hidden && isBuiltin(s.key)) offer(s.key)
  for (const c of ctx.collections) if (c.typeIds.includes(type.id)) offer(`collection:${c.id}`)
  for (const q of ctx.queries) if (q.definition.structures.some((st) => st.id === type.id)) offer(`query:${q.id}`)
  return out
}

/** The saved form of a section: only what the file needs (key, collapsed, view, title). */
function toSaved(s: RenderedSection): DashboardSection {
  const out: DashboardSection = { key: s.key, collapsed: s.collapsed }
  if (s.viewDefinition) out.viewDefinition = s.viewDefinition
  if (s.title) out.title = s.title
  return out
}

/** `views` with `visible` as the dashboard's sections (in that order) and `removed` as its removed keys. */
export function withSections(views: Views, visible: RenderedSection[], removed: string[]): Views {
  return { ...views, dashboard: { ...views.dashboard, sections: visible.map(toSaved), removedSections: removed } }
}

/** Move a section to the removed list: no Overview section and no tab. */
export function removeSection(views: Views, all: RenderedSection[], key: string): Views {
  const visible = visibleSections(all).filter((s) => s.key !== key)
  const removed = [...views.dashboard.removedSections.filter((k) => k !== key), key]
  return withSections(views, visible, removed)
}

/** Bring a removed (or new) section back, at the end. */
export function showSection(views: Views, all: RenderedSection[], section: RenderedSection): Views {
  const visible = [...visibleSections(all).filter((s) => s.key !== section.key), { ...section, hidden: false }]
  return withSections(
    views,
    visible,
    views.dashboard.removedSections.filter((k) => k !== section.key),
  )
}

/** Append a section by key (a new query section), un-removing it when it was removed. */
export function appendSection(views: Views, all: RenderedSection[], key: DashboardSectionKey): Views {
  const base = withSections(views, visibleSections(all), views.dashboard.removedSections.filter((k) => k !== key))
  return { ...base, dashboard: { ...base.dashboard, sections: [...base.dashboard.sections, { key, collapsed: false }] } }
}

/** Change one visible section (collapse, rename, its view) and keep everything else. */
export function patchSection(views: Views, all: RenderedSection[], key: string, patch: Partial<DashboardSection>): Views {
  const visible = visibleSections(all).map((s) => (s.key === key ? { ...s, ...patch } : s))
  return withSections(views, visible, views.dashboard.removedSections)
}

/** Reorder the visible sections: move `key` to the position of `overKey`. */
export function moveSection(views: Views, all: RenderedSection[], key: string, overKey: string): Views {
  const visible = visibleSections(all)
  const from = visible.findIndex((s) => s.key === key)
  const to = visible.findIndex((s) => s.key === overKey)
  if (from < 0 || to < 0 || from === to) return views
  const next = [...visible]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return withSections(views, next, views.dashboard.removedSections)
}
