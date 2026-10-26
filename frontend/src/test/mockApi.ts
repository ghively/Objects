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
  Collection,
  Layout,
  ObjectDetail,
  ObjectSummary,
  PropertyDef,
  Query,
  Row,
  TypeDef,
  ViewState,
  Views,
} from '@/api/types'

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
    ...partial,
  }
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

type Fn =(...args: never[]) => unknown

function defaults(): Api {
  return {
    space: async () => ({ name: 'space', root: '/space', types: [] }),
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
