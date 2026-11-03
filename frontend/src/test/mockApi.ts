// A mock of the whole `api` object for component tests. Inject it with:
//
//   vi.mock('@/api/client', async (orig) => ({
//     ...(await orig()),
//     api: (await import('@/test/mockApi')).mockApi(),
//   }))
//
// and reach it as `vi.mocked(api)`. Every function is a `vi.fn()` whose default implementation
// is a sensible empty answer, so `mockReset()` brings a function back to that default.
import { vi } from 'vitest'
import type { Api } from '@/api/client'
import type {
  Attachment,
  CalendarDay,
  CalendarRange,
  Collection,
  DeviceSettings,
  GraphData,
  Layout,
  ObjectDetail,
  ObjectSummary,
  PropertyDef,
  Query,
  References,
  Row,
  SearchResult,
  SpaceEntry,
  TaskEntry,
  TypeDef,
  ViewState,
  Views,
} from '@/api/types'
import { settingsDefaults } from '@/settings/defaults'

/** A v2 type with every contract field; `partial` overrides. */
export function typeDef(partial: Partial<TypeDef> & Pick<TypeDef, 'id'>): TypeDef {
  const name = partial.name ?? partial.id.charAt(0).toUpperCase() + partial.id.slice(1)
  const pluralName = partial.pluralName ?? `${name}s`
  return {
    schemaVersion: 2,
    name,
    pluralName,
    folder: pluralName,
    formerNames: [],
    icon: { type: 'iconify', val: 'ph-file-text' },
    color: 'gray',
    description: '',
    basic: false,
    propertyDefinitions: [],
    collectionsPropertyPosition: 0,
    viewDesign: null,
    font: 'sans-serif',
    wideLayoutMode: false,
    wideCoverImage: false,
    cropCoverImage: true,
    templates: { ids: [], defaultTemplateId: null },
    readOnlyReason: null,
    revision: '',
    ...partial,
  }
}

/** A property definition with every contract field; `partial` overrides. */
export function propertyDef(partial: Partial<PropertyDef> & Pick<PropertyDef, 'id'>): PropertyDef {
  return {
    key: partial.id,
    name: partial.id,
    type: 'text',
    description: '',
    icon: null,
    visibility: 'alwaysShow',
    options: {},
    ...partial,
  }
}

/** An object summary with every contract field; `partial` overrides. */
export function objectSummary(partial: Partial<ObjectSummary> & Pick<ObjectSummary, 'path'>): ObjectSummary {
  const stem = partial.path.replace(/^.*\//, '').replace(/\.md$/i, '')
  return {
    id: null,
    type: 'page',
    title: stem,
    icon: null,
    iconColor: null,
    description: null,
    aliases: [],
    createdAt: null,
    lastUpdated: null,
    tags: [],
    template: null,
    color: null,
    coverImage: null,
    readOnly: false,
    ...partial,
  }
}

/** An object as `GET /api/object` returns it. */
export function objectDetail(partial: Partial<ObjectDetail> & { summary: ObjectSummary }): ObjectDetail {
  return {
    frontmatter: {},
    body: '',
    version: 'v1',
    links: {},
    backlinks: [],
    ...partial,
  }
}

/** A search result with every contract field; `partial` overrides. */
export function searchResult(partial: Partial<SearchResult> & Pick<SearchResult, 'path'>): SearchResult {
  const stem = partial.path.replace(/^.*\//, '').replace(/\.md$/i, '')
  return {
    title: stem,
    type: 'page',
    icon: null,
    tags: [],
    score: 0,
    titleMatches: [],
    highlights: [],
    ...partial,
  }
}

/** A references payload with every contract field; `partial` overrides. */
export function references(partial: Partial<References> = {}): References {
  return {
    tabs: ['all', 'backlinks', 'related', 'mentions'],
    backlinks: [],
    mentions: [],
    related: [],
    relatedTags: [],
    summaries: {},
    ...partial,
  }
}

/** Graph data with every contract field; `partial` overrides. */
export function graphData(partial: Partial<GraphData> = {}): GraphData {
  return { nodes: [], links: [], tagged: [], ...partial }
}

const emptyGroup = () => ({ type: 'filterGroup' as const, operator: 'and' as const, elements: [] })

function viewState(layout: Layout = 'list'): ViewState {
  return { viewDefinition: { dataViewLayout: layout }, filterGroup: emptyGroup(), sorts: [], groupBy: null }
}

/** Default type-page views, as the server returns them when none are saved. */
export function defaultViews(): Views {
  return { activeTab: 'all', all: viewState(), dashboard: { sections: [], removedSections: [] } }
}

/** A row with every contract field; `partial` overrides (`path` is shorthand for a default summary). */
export function row(partial: Partial<Row> & { path?: string } = {}): Row {
  const { path, ...rest } = partial
  const summary = rest.summary ?? objectSummary({ path: path ?? 'Pages/Untitled.md' })
  return { summary, version: 'v1', values: {}, links: {}, preview: '', ...rest }
}

/** A collection with every contract field; `partial` overrides. */
export function collection(partial: Partial<Collection> & Pick<Collection, 'id'>): Collection {
  return {
    schemaVersion: 1,
    name: partial.id,
    formerNames: [],
    icon: null,
    color: null,
    description: '',
    typeIds: [],
    views: {
      activeTab: 'all',
      all: viewState(),
      dashboard: { sections: [{ key: 'pinned', collapsed: false }], removedSections: [] },
    },
    pinned: { ids: [], isHidden: false },
    templates: { ids: [], defaultTemplateId: null },
    readOnlyReason: null,
    revision: '',
    ...partial,
  }
}

/** A query with every contract field; `partial` overrides. */
export function query(partial: Partial<Query> & Pick<Query, 'id'>): Query {
  const name = partial.name ?? ''
  return {
    schemaVersion: 1,
    name,
    titleIsCustom: name !== '',
    icon: null,
    description: '',
    definition: { structures: [], filterGroup: emptyGroup(), sorts: [], groupBy: null },
    view: { viewDefinition: { dataViewLayout: 'list' } },
    readOnlyReason: null,
    revision: '',
    ...partial,
  }
}

/** A calendar day with every contract field; `partial` overrides. */
export function calendarDay(partial: Partial<CalendarDay> = {}): CalendarDay {
  return { dailyNote: null, tasks: [], dated: [], created: [], updated: [], ...partial }
}

/** A calendar range with every contract field; `partial` overrides. */
export function calendarRange(partial: Partial<CalendarRange> = {}): CalendarRange {
  const from = partial.from ?? '2026-10-01'
  return {
    from,
    to: partial.to ?? from,
    today: partial.today ?? from,
    days: {},
    summaries: {},
    warnings: [],
    ...partial,
  }
}

/** A task entry with every contract field; `partial` overrides. */
export function taskEntry(partial: Partial<TaskEntry> = {}): TaskEntry {
  return { path: 'Tasks/Untitled.md', kind: 'date', day: '2026-10-01', done: false, ...partial }
}

/** Device settings: the contract defaults; `partial` overrides. */
export function deviceSettings(partial: Partial<DeviceSettings> = {}): DeviceSettings {
  return { ...settingsDefaults, openOnStart: {}, ...partial }
}

/** A spaces-registry entry with every contract field; `partial` overrides. */
export function spaceEntry(partial: Partial<SpaceEntry> = {}): SpaceEntry {
  const path = partial.path ?? '/spaces/Space'
  return {
    path,
    name: path.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, ''),
    icon: null,
    current: false,
    missing: false,
    lastOpened: null,
    ...partial,
  }
}

/** An attachment with every contract field; `partial` overrides. */
export function attachment(partial: Partial<Attachment> = {}): Attachment {
  return { path: 'Attachments/file.pdf', kind: 'pdf', size: 1024, ...partial }
}

type Fn =(...args: never[]) => unknown

function defaults(): Api {
  return {
    space: async () => ({
      name: 'space',
      root: '/space',
      types: [],
      icon: null,
      description: null,
      hideTaskManagement: false,
      revision: '',
    }),
    objects: async () => [],
    object: async (path: string) => objectDetail({ summary: objectSummary({ path }) }),
    saveBody: async (_path: string, _body: string, baseVersion: string) => ({ version: `${baseVersion}+1` }),
    updateProperties: async (_path: string, updates: Record<string, unknown>, baseVersion: string) => ({
      version: `${baseVersion}+1`,
      frontmatter: { ...updates },
      links: {},
      synced: [],
      skipped: [],
    }),
    ensureId: async () => ({ id: '01MOCKID0000000000000000', version: 'v1+1' }),
    renameObject: async (path: string, title: string, baseVersion: string) => ({
      path: `${path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''}${title}.md`,
      version: `${baseVersion}+1`,
      relinked: [],
      skipped: [],
    }),
    suggestMapping: async () => [],
    changeType: async (path: string, _typeId: string, _mapping: Record<string, string | null>, baseVersion: string) => ({
      path,
      version: `${baseVersion}+1`,
      relinked: [],
      skipped: [],
    }),
    createObject: async (typeId: string, opts: { title?: string } = {}) => ({
      path: `${typeId}/${opts.title || 'Untitled'}.md`,
      version: 'v1',
    }),
    duplicateObject: async (path: string) => {
      const copy = path.replace(/\.md$/, ' (Copy).md')
      const title = copy.slice(copy.lastIndexOf('/') + 1).replace(/\.md$/, '')
      return { path: copy, version: 'v1', summary: objectSummary({ path: copy, title }) }
    },
    exportProperties: async () => [],
    typeGallery: async () => [],
    exportObjectUrl: (path: string, opts: { media: boolean }) =>
      `/api/object/export?path=${encodeURIComponent(path)}&media=${opts.media ? 1 : 0}`,
    createDailyNote: async (date: string) => ({ path: `DailyNotes/${date}.md`, version: 'v1', typeIds: [] }),
    calendar: async (from: string, to: string) => calendarRange({ from, to, today: from }),
    deleteObject: async () => ({ trashId: 'trash-1' }),
    trash: async () => [],
    restore: async () => ({ paths: [], typeIds: [], collectionIds: [], queryIds: [], skipped: [] }),
    purge: async () => ({ purged: 1 }),
    emptyTrash: async () => ({ purged: 0 }),
    createType: async (input: { name: string; pluralName: string }) =>
      typeDef({ id: input.name.toLowerCase(), name: input.name, pluralName: input.pluralName, revision: 'r1' }),
    saveType: async (type: TypeDef) => ({ type: { ...type, revision: `${type.revision}+1` }, rewritten: [], skipped: [] }),
    changePropertyKind: async (typeId: string) => ({
      type: typeDef({ id: typeId }),
      newPropertyId: 'p-new',
      rewritten: [],
      skipped: [],
      lossy: 0,
    }),
    setPropertySync: async () => ({ types: [], rewritten: [], skipped: [] }),
    deleteType: async () => ({ trashId: 'trash-type-1' }),
    templates: async () => [],
    createTemplate: async (typeId: string, name?: string) => ({
      path: `Templates/${typeId}/${name ?? 'New template'}.md`,
      version: 'v1',
    }),
    applyTemplate: async (_path: string, _templateId: string, baseVersion: string) => ({ version: `${baseVersion}+1` }),
    ensureTag: async (name: string) => ({ path: `Tags/${name}.md`, created: false }),
    images: async () => [],
    importImage: async (name: string) => ({ path: `Attachments/${name}` }),
    fileUrl: (path: string) => `/api/file?path=${encodeURIComponent(path)}`,
    resolve: async () => null,
    reveal: async () => undefined,
    rows: async () => [],
    views: async () => ({ views: defaultViews(), revision: '' }),
    saveViews: async () => ({ revision: 'r1' }),
    collections: async () => [],
    createCollection: async (name: string, typeIds: string[]) =>
      collection({ id: name.toLowerCase().replace(/\s+/g, '-'), name, typeIds, revision: 'r1' }),
    saveCollection: async (c: Collection) => ({ collection: { ...c, revision: `${c.revision}+1` }, rewritten: [], skipped: [] }),
    deleteCollection: async () => ({ trashId: 'trash-collection-1', removedFrom: [], skipped: [] }),
    queries: async () => [],
    createQuery: async (init: Partial<Query> = {}) => query({ ...init, id: 'new-query', name: init.name ?? '', revision: 'r1' }),
    saveQuery: async (q: Query) => ({ query: { ...q, revision: `${q.revision}+1` } }),
    deleteQuery: async () => ({ trashId: 'trash-query-1' }),
    ui: async () => ({ ui: { pinned: [], sections: [], allNotesLayout: 'list' as const }, revision: '' }),
    patchUi: async (patch: Record<string, unknown>) => ({
      ui: { pinned: [], sections: [], allNotesLayout: 'list' as const, ...patch },
      revision: 'r1',
    }),
    search: async () => ({ results: [], partial: false }),
    reindex: async () => ({ started: true }),
    references: async () => references(),
    linkMention: async (input: { baseVersion: string }) => ({ version: `${input.baseVersion}+1` }),
    graph: async () => graphData(),
    attachments: async () => [],
    uploadAttachment: async (_blob: Blob | ArrayBuffer, name: string) => ({ path: `Attachments/${name}`, kind: 'file' as const }),
    openAttachment: async () => ({ ok: true as const }),
    patchSpace: async (patch: Record<string, unknown>) => ({
      name: 'space',
      root: '/space',
      types: [],
      icon: null,
      description: null,
      hideTaskManagement: false,
      ...patch,
      revision: 'r1',
    }),
    settings: async () => ({ settings: deviceSettings(), revision: '' }),
    patchSettings: async (patch: Partial<DeviceSettings>) => ({ settings: deviceSettings(patch), revision: 'r1' }),
    spaces: async () => [spaceEntry({ path: '/space', name: 'space', current: true })],
    createSpace: async (name: string, location: string) => ({ path: `${location.replace(/[\\/]+$/, '')}/${name}` }),
    openSpace: async (path: string) => ({ path }),
    removeSpace: async () => ({ ok: true as const }),
    switchSpace: async (path: string) => ({ path }),
    // M8
    overdue: async () => ({ count: 0, capped: false, missed: [], current: null, today: '2026-10-27' }),
    occurrence: async (_path: string, _action: string, opts: { baseVersion: string }) => ({
      version: `${opts.baseVersion}+1`,
      frontmatter: {},
      links: {},
      synced: [],
      skipped: [],
    }),
    taskStats: async () => ({
      unit: 'day' as const,
      currentStreak: 0,
      bestStreak: 0,
      completions: 0,
      completionRate: null,
      atRisk: false,
      cells: [],
    }),
    setReminder: async (_path: string, _key: string, _remind: string | null, opts: { baseVersion: string }) => ({
      version: `${opts.baseVersion}+1`,
      frontmatter: {},
      links: {},
      synced: [],
      skipped: [],
    }),
    block: async (path: string, id: string) => ({ path, id, markdown: '', version: 'v1' }),
    blockReferences: async () => ({ paths: [] }),
    history: async () => [],
    historyVersion: async (_path: string, id: string) => ({ id, text: '' }),
    restoreVersion: async (_path: string, _id: string, opts: { baseVersion: string }) => ({ version: `${opts.baseVersion}+1` }),
    mergeObject: async (_source: string, target: string, opts: { targetVersion: string }) => ({
      target,
      version: `${opts.targetVersion}+1`,
      relinked: [],
      skipped: [],
      dropped: [],
      trashId: 'trash-merge-1',
    }),
    deleteSpace: async () => ({ trashed: true }),
    onChange: () => () => undefined,
  } as unknown as Api
}

/** A mocked `api`: every function a `vi.fn()` with a default implementation; `overrides` replace defaults. */
export function mockApi(overrides: Partial<Api> = {}): Api {
  const base = defaults() as unknown as Record<string, Fn>
  const extra = overrides as unknown as Record<string, Fn | undefined>
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(extra)])) {
    const impl = extra[key] ?? base[key]
    out[key] = vi.isMockFunction(impl) ? impl : vi.fn(impl)
  }
  return out as unknown as Api
}
