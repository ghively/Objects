import type {
  ChangeEvent,
  ChangeKindResult,
  Collection,
  CreatedFile,
  DeleteCollectionResult,
  Icon,
  MappingRow,
  ObjectDetail,
  ObjectSummary,
  Query,
  RenameResult,
  RestoreResult,
  Row,
  RowsScope,
  SaveCollectionResult,
  SaveResult,
  SaveTypeResult,
  SpaceInfo,
  SyncResult,
  TrashItem,
  TypeDef,
  UiState,
  UpdateResult,
  Views,
} from './types'

/** Any non-2xx response that is not a conflict or a read-only refusal. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * 409: the file changed on disk since `baseVersion` (for a type, since `baseRevision`).
 * Nothing was written. `currentVersion` is the server's `currentVersion ?? currentRevision`.
 */
export class ConflictError extends ApiError {
  readonly currentVersion: string
  constructor(currentVersion: string) {
    super(409, 'conflict')
    this.name = 'ConflictError'
    this.currentVersion = currentVersion
  }
}

/** 409 on a type route: the type file changed since `baseRevision`. */
export class RevisionConflictError extends ConflictError {
  constructor(currentRevision: string) {
    super(currentRevision)
    this.name = 'RevisionConflictError'
  }
  get currentRevision(): string {
    return this.currentVersion
  }
}

/** 428: the write needs `confirm: true`; `affected` files would change. Nothing was written. */
export class ConfirmRequiredError extends ApiError {
  readonly affected: number
  constructor(message: string, affected: number) {
    super(428, message)
    this.name = 'ConfirmRequiredError'
    this.affected = affected
  }
}

/** 423: the object is read-only (for example, broken frontmatter). Nothing was written. */
export class ReadOnlyError extends ApiError {
  readonly reason: string
  constructor(reason: string) {
    super(423, reason)
    this.name = 'ReadOnlyError'
    this.reason = reason
  }
}

const BASE = '/api'

function qs(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function detailOf(data: unknown): Record<string, unknown> {
  // FastAPI wraps HTTPException payloads in {detail: ...}; accept both shapes.
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (d.detail && typeof d.detail === 'object') return d.detail as Record<string, unknown>
    return d
  }
  return {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await readJson(res)
  if (res.ok) return data as T
  const d = detailOf(data)
  if (res.status === 409) {
    const current = String(d.currentVersion ?? d.currentRevision ?? '')
    if (path.startsWith('/types') || d.currentRevision !== undefined) throw new RevisionConflictError(current)
    throw new ConflictError(current)
  }
  if (res.status === 423) throw new ReadOnlyError(String(d.reason ?? (typeof d.detail === 'string' ? d.detail : 'read-only')))
  if (res.status === 428) {
    const message = typeof d.detail === 'string' ? d.detail : 'Confirmation required'
    throw new ConfirmRequiredError(message, Number(d.affected ?? 0))
  }
  const detail = data && typeof data === 'object' ? (data as Record<string, unknown>).detail : undefined
  // 400/404 carry the server's message as {detail: "..."}.
  const message = typeof detail === 'string' ? detail : typeof data === 'string' ? data : res.statusText
  throw new ApiError(res.status, message)
}

type ChangeListener = (e: ChangeEvent) => void

const listeners = new Set<ChangeListener>()
let source: EventSource | null = null

function newClientId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * This window's id. Saves send it, and the server tags the change event it
 * announces for the save with it (`origin`), so this window can tell the
 * echo of its own save from another window's.
 */
export const CLIENT_ID = newClientId()

function emit(e: ChangeEvent) {
  for (const cb of [...listeners]) cb(e)
}

/**
 * Announce this window's own writes to its listeners, after the caller has handled the result.
 * The server tags its events with our `CLIENT_ID` and we drop those echoes (see `ensureSource`),
 * so every path a write touched is announced here instead, one event per path.
 */
function emitLocal(events: ChangeEvent[]) {
  if (events.length === 0) return
  setTimeout(() => {
    for (const e of events) emit(e)
  }, 0)
}

function changed(path: string, version: string | null = null): ChangeEvent {
  return { kind: 'changed', path, version, origin: CLIENT_ID }
}

function created(path: string, version: string | null = null): ChangeEvent {
  return { kind: 'created', path, version, origin: CLIENT_ID }
}

function typesEvent(id: string, revision: string | null = null): ChangeEvent {
  return { kind: 'types', path: id, version: revision, origin: CLIENT_ID }
}

function defEvent(kind: 'collections' | 'queries' | 'views' | 'ui', path: string, version: string | null = null): ChangeEvent {
  return { kind, path, version, origin: CLIENT_ID }
}

/** `renamed` when the write moved the file, else `changed`. */
function movedOrChanged(oldPath: string, path: string, version: string | null): ChangeEvent {
  if (path === oldPath) return changed(path, version)
  return { kind: 'renamed', path, oldPath, version, origin: CLIENT_ID }
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

const seg = encodeURIComponent

function ensureSource() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource(`${BASE}/events`)
  source.addEventListener('change', (msg) => {
    let e: ChangeEvent
    try {
      e = JSON.parse((msg as MessageEvent<string>).data) as ChangeEvent
    } catch {
      return
    }
    // Our own saves were already announced locally (see `saveBody`).
    if (e.origin && e.origin === CLIENT_ID) return
    emit(e)
  })
}

export const api = {
  space(): Promise<SpaceInfo> {
    return request<SpaceInfo>('/space')
  },

  objects(type?: string): Promise<ObjectSummary[]> {
    return request<ObjectSummary[]>(`/objects${qs({ type })}`)
  },

  object(path: string): Promise<ObjectDetail> {
    return request<ObjectDetail>(`/object${qs({ path })}`)
  },

  /**
   * Save an object's body. Resolves with the new version (unchanged if the body was identical).
   * Rejects with `ConflictError` (409) or `ReadOnlyError` (423); neither writes the file.
   *
   * A save that wrote is announced to this window's `onChange` listeners as a
   * `changed` event, after the caller has handled the result: the server doesn't
   * echo the app's own writes back to the window that made them, and other views
   * of the same object (a peek over its page) must not go stale.
   */
  async saveBody(path: string, body: string, baseVersion: string): Promise<SaveResult> {
    const res = await request<SaveResult>('/object/body', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, body, baseVersion, clientId: CLIENT_ID }),
    })
    if (res && res.version && res.version !== baseVersion) {
      const event: ChangeEvent = { kind: 'changed', path, version: res.version, origin: CLIENT_ID }
      // Next task: the saving view adopts the new version first, so it ignores this.
      setTimeout(() => emit(event), 0)
    }
    return res
  },

  /**
   * Set (or clear with `null`) frontmatter properties; `remove` deletes keys. Announces `changed`
   * for the object and for each relation-synced object.
   */
  async updateProperties(
    path: string,
    updates: Record<string, unknown>,
    baseVersion: string,
    remove?: string[],
  ): Promise<UpdateResult> {
    const body: Record<string, unknown> = { path, updates }
    if (remove && remove.length) body.remove = remove
    Object.assign(body, { baseVersion, clientId: CLIENT_ID })
    const res = await request<UpdateResult>('/object/properties', json('PUT', body))
    const events: ChangeEvent[] = []
    if (res.version !== baseVersion) events.push(changed(path, res.version))
    for (const p of res.synced ?? []) events.push(changed(p))
    emitLocal(events)
    return res
  },

  /** Give an object an `id` (inserted first in its frontmatter, unstamped) if it has none. */
  async ensureId(path: string): Promise<{ id: string; version: string }> {
    const res = await request<{ id: string; version: string }>('/object/ensure-id', json('POST', { path, clientId: CLIENT_ID }))
    emitLocal([changed(path, res.version)])
    return res
  },

  /** Retitle an object: renames its file and relinks every `[[link]]` to it. */
  async renameObject(path: string, title: string, baseVersion: string): Promise<RenameResult> {
    const res = await request<RenameResult>('/object/rename', json('POST', { path, title, baseVersion, clientId: CLIENT_ID }))
    emitLocal([movedOrChanged(path, res.path, res.version), ...(res.relinked ?? []).map((p) => changed(p))])
    return res
  },

  /** The suggested property mapping for moving an object to another type. */
  async suggestMapping(path: string, typeId: string): Promise<MappingRow[]> {
    const res = await request<{ rows: MappingRow[] }>(`/object/change-type${qs({ path, typeId })}`)
    return res?.rows ?? []
  },

  /** Move an object to another type, mapping its property keys (`to: null` maps to nothing; the key stays). */
  async changeType(
    path: string,
    typeId: string,
    mapping: Record<string, string | null>,
    baseVersion: string,
  ): Promise<RenameResult> {
    const res = await request<RenameResult>(
      '/object/change-type',
      json('POST', { path, typeId, mapping, baseVersion, clientId: CLIENT_ID }),
    )
    emitLocal([movedOrChanged(path, res.path, res.version), ...(res.relinked ?? []).map((p) => changed(p))])
    return res
  },

  /** Create an object. `templateId`: an id, `null` for the type's default, `"none"` for no template. */
  async createObject(typeId: string, opts: { title?: string; templateId?: string | null; values?: Record<string, unknown> } = {},
  ): Promise<CreatedFile> {
    const body: Record<string, unknown> = { typeId }
    if (opts.title !== undefined) body.title = opts.title
    if (opts.templateId !== undefined) body.templateId = opts.templateId
    if (opts.values !== undefined) body.values = opts.values
    body.clientId = CLIENT_ID
    const res = await request<CreatedFile & { typeIds?: string[] }>('/objects', json('POST', body))
    // An inferred type saved for the first time: the server's `types` event is our own echo.
    emitLocal([created(res.path, res.version), ...(res.typeIds ?? []).map((t) => typesEvent(t))])
    return { path: res.path, version: res.version }
  },

  /** Move an object to the Trash. */
  async deleteObject(path: string, opts: { baseVersion?: string } = {}): Promise<{ trashId: string }> {
    const res = await request<{ trashId: string; typeIds?: string[] }>(
      `/object${qs({ path, baseVersion: opts.baseVersion, clientId: CLIENT_ID })}`,
      { method: 'DELETE' },
    )
    // Deleting a template also drops it from its type (`typeIds`).
    emitLocal([
      { kind: 'deleted', path, version: null, origin: CLIENT_ID },
      ...(res.typeIds ?? []).map((t) => typesEvent(t)),
    ])
    return { trashId: res.trashId }
  },

  trash(): Promise<TrashItem[]> {
    return request<TrashItem[]>('/trash')
  },

  /** Restore a Trash entry. Announces `created` per restored file and `types` per restored type. */
  async restore(id: string): Promise<RestoreResult> {
    const res = await request<RestoreResult>(`/trash/${seg(id)}/restore${qs({ clientId: CLIENT_ID })}`, { method: 'POST' })
    emitLocal([
      ...(res.paths ?? []).map((p) => created(p)),
      ...(res.typeIds ?? []).map((t) => typesEvent(t)),
      ...(res.collectionIds ?? []).map((c) => defEvent('collections', c)),
      ...(res.queryIds ?? []).map((q) => defEvent('queries', q)),
    ])
    return res
  },

  /** Delete one Trash entry for good. */
  purge(id: string): Promise<{ purged: number }> {
    return request<{ purged: number }>(`/trash/${seg(id)}${qs({ clientId: CLIENT_ID })}`, { method: 'DELETE' })
  },

  /** "Empty Trash". */
  emptyTrash(): Promise<{ purged: number }> {
    return request<{ purged: number }>(`/trash${qs({ clientId: CLIENT_ID })}`, { method: 'DELETE' })
  },

  async createType(input: { name: string; pluralName: string; icon?: Icon; color?: string }): Promise<TypeDef> {
    const res = await request<TypeDef>('/types', json('POST', { ...input, clientId: CLIENT_ID }))
    emitLocal([typesEvent(res.id, res.revision ?? null)])
    return res
  },

  /**
   * Save a type definition. Rejects with `RevisionConflictError` (409) or `ConfirmRequiredError`
   * (428: retry with `confirm: true`). Announces `types` and `changed` per rewritten file.
   */
  async saveType(type: TypeDef, opts: { baseRevision: string; confirm?: boolean }): Promise<SaveTypeResult> {
    const body: Record<string, unknown> = { type, baseRevision: opts.baseRevision }
    if (opts.confirm !== undefined) body.confirm = opts.confirm
    body.clientId = CLIENT_ID
    const res = await request<SaveTypeResult>(`/types/${seg(type.id)}`, json('PUT', body))
    emitLocal([
      typesEvent(res.type?.id ?? type.id, res.type?.revision ?? null),
      ...(res.rewritten ?? []).map((p) => changed(p)),
    ])
    return res
  },

  /** Change a property's kind: creates a new property with converted values and keeps the old one. */
  async changePropertyKind(
    typeId: string,
    propertyId: string,
    toType: string,
    baseRevision: string,
  ): Promise<ChangeKindResult> {
    const res = await request<ChangeKindResult>(
      `/types/${seg(typeId)}/properties/${seg(propertyId)}/change-kind`,
      json('POST', { toType, baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([
      typesEvent(res.type?.id ?? typeId, res.type?.revision ?? null),
      ...(res.rewritten ?? []).map((p) => changed(p)),
    ])
    return res
  },

  /** Two-way link an entity property with `targetPropertyId` (or a new one named `createName`); `null` unlinks. */
  async setPropertySync(
    typeId: string,
    propertyId: string,
    targetPropertyId: string | null,
    baseRevision: string,
    createName?: string,
  ): Promise<SyncResult> {
    const body: Record<string, unknown> = { targetPropertyId }
    if (createName !== undefined) body.createName = createName
    Object.assign(body, { baseRevision, clientId: CLIENT_ID })
    const res = await request<SyncResult>(`/types/${seg(typeId)}/properties/${seg(propertyId)}/sync`, json('POST', body))
    emitLocal([
      ...(res.types ?? []).map((t) => typesEvent(t.id, t.revision ?? null)),
      ...(res.rewritten ?? []).map((p) => changed(p)),
    ])
    return res
  },

  /** Move a type, its objects and its templates to the Trash. Rejects with 428 unless `confirm`. */
  async deleteType(id: string, opts: { confirm?: boolean } = {}): Promise<{ trashId: string }> {
    const res = await request<{ trashId: string; paths?: string[]; typeIds?: string[] }>(
      `/types/${seg(id)}${qs({ confirm: opts.confirm ? 'true' : undefined, clientId: CLIENT_ID })}`,
      { method: 'DELETE' },
    )
    // The type's objects and templates went to the Trash, and other types may have dropped it
    // from their relations: announce each, since the server's events for them are our echoes.
    const typeIds = res.typeIds?.length ? res.typeIds : [id]
    emitLocal([
      ...typeIds.map((t) => typesEvent(t)),
      ...(res.paths ?? []).map((p): ChangeEvent => ({ kind: 'deleted', path: p, version: null, origin: CLIENT_ID })),
    ])
    return { trashId: res.trashId }
  },

  templates(typeId: string): Promise<ObjectSummary[]> {
    return request<ObjectSummary[]>(`/types/${seg(typeId)}/templates`)
  },

  /** Create a template for a type; announces the new file and the type (its `templates.ids` grew). */
  async createTemplate(typeId: string, name?: string): Promise<CreatedFile> {
    const body: Record<string, unknown> = name !== undefined ? { name } : {}
    body.clientId = CLIENT_ID
    const res = await request<CreatedFile>(`/types/${seg(typeId)}/templates`, json('POST', body))
    emitLocal([created(res.path, res.version), typesEvent(typeId)])
    return res
  },

  async applyTemplate(path: string, templateId: string, baseVersion: string): Promise<SaveResult> {
    const res = await request<SaveResult>(
      '/object/apply-template',
      json('POST', { path, templateId, baseVersion, clientId: CLIENT_ID }),
    )
    if (res.version !== baseVersion) emitLocal([changed(path, res.version)])
    return res
  },

  /** The Tag object named `name`, created in `Tags/` when it doesn't exist. */
  async ensureTag(name: string): Promise<{ path: string; created: boolean }> {
    const res = await request<{ path: string; created: boolean }>('/tags/ensure', json('POST', { name, clientId: CLIENT_ID }))
    if (res.created) emitLocal([created(res.path)])
    return res
  },

  /** Image files in the space (cover images). */
  images(): Promise<{ path: string }[]> {
    return request<{ path: string }[]>('/images')
  },

  /** Copy an image into `Attachments/`; resolves with its space path. */
  async importImage(name: string, data: Blob | ArrayBuffer): Promise<{ path: string }> {
    const res = await request<{ path: string }>(`/images${qs({ name })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    })
    emitLocal([created(res.path)])
    return res
  },

  /** URL of an image file in the space (`GET /api/file`). */
  fileUrl(path: string): string {
    return `${BASE}/file${qs({ path })}`
  },

  /** Resolve a `[[link]]` to a path, or `null` when nothing matches (404). */
  async resolve(link: string, from?: string): Promise<string | null> {
    try {
      const r = await request<{ path: string }>(`/resolve${qs({ link, from })}`)
      return r.path
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },

  /** Show the object's file in the OS file manager (Explorer on Windows). */
  async reveal(path: string): Promise<void> {
    await request<unknown>('/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  },

  // ---- M3: rows, views, collections, queries, ui ----

  /** Objects with decoded values and previews, scoped by type, collection, paths and search. */
  async rows(scope: RowsScope = {}): Promise<Row[]> {
    const res = await request<{ rows: Row[] }>('/rows', json('POST', scope))
    return res?.rows ?? []
  },

  /** A type page's views (defaults and revision `''` when none are saved). */
  views(typeId: string): Promise<{ views: Views; revision: string }> {
    return request<{ views: Views; revision: string }>(`/views/${seg(typeId)}`)
  },

  async saveViews(typeId: string, views: Views, baseRevision: string): Promise<{ revision: string }> {
    const res = await request<{ revision: string }>(
      `/views/${seg(typeId)}`,
      json('PUT', { views, baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([defEvent('views', typeId, res.revision ?? null)])
    return res
  },

  collections(): Promise<Collection[]> {
    return request<Collection[]>('/collections')
  },

  async createCollection(name: string, typeIds: string[], icon?: Icon | null): Promise<Collection> {
    const body: Record<string, unknown> = { name, typeIds, clientId: CLIENT_ID }
    if (icon !== undefined) body.icon = icon
    const res = await request<Collection>('/collections', json('POST', body))
    emitLocal([defEvent('collections', res.id, res.revision ?? null)])
    return res
  },

  /** Save a collection. A rename also announces `changed` for each rewritten member. */
  async saveCollection(c: Collection, opts: { baseRevision: string }): Promise<SaveCollectionResult> {
    const res = await request<SaveCollectionResult>(
      `/collections/${seg(c.id)}`,
      json('PUT', { collection: c, baseRevision: opts.baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([
      defEvent('collections', res.collection?.id ?? c.id, res.collection?.revision ?? null),
      ...(res.rewritten ?? []).map((p) => changed(p)),
    ])
    return res
  },

  /** Delete a collection (to the Trash). Rejects with 428 unless `confirm`. */
  async deleteCollection(id: string, opts: { confirm?: boolean } = {}): Promise<DeleteCollectionResult> {
    const res = await request<DeleteCollectionResult>(
      `/collections/${seg(id)}${qs({ confirm: opts.confirm ? 'true' : undefined, clientId: CLIENT_ID })}`,
      { method: 'DELETE' },
    )
    // Sole members went to the Trash and the others lost one `collections:` item; a collection
    // event makes every open view reload its rows, which covers both.
    const skipped = new Set((res.skipped ?? []).map((s) => s.path))
    emitLocal([
      defEvent('collections', id),
      ...(res.removedFrom ?? []).filter((p) => !skipped.has(p)).map((p) => changed(p)),
    ])
    return res
  },

  queries(): Promise<Query[]> {
    return request<Query[]>('/queries')
  },

  async createQuery(init: Partial<Pick<Query, 'name' | 'definition' | 'view'>> = {}): Promise<Query> {
    const res = await request<Query>('/queries', json('POST', { ...init, clientId: CLIENT_ID }))
    emitLocal([defEvent('queries', res.id, res.revision ?? null)])
    return res
  },

  async saveQuery(q: Query, opts: { baseRevision: string }): Promise<{ query: Query }> {
    const res = await request<{ query: Query }>(
      `/queries/${seg(q.id)}`,
      json('PUT', { query: q, baseRevision: opts.baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([defEvent('queries', res.query?.id ?? q.id, res.query?.revision ?? null)])
    return res
  },

  async deleteQuery(id: string): Promise<{ trashId: string }> {
    const res = await request<{ trashId: string }>(`/queries/${seg(id)}${qs({ clientId: CLIENT_ID })}`, { method: 'DELETE' })
    emitLocal([defEvent('queries', id)])
    return res
  },

  /** Pinned items, custom sidebar sections and the All notes layout. */
  ui(): Promise<{ ui: UiState; revision: string }> {
    return request<{ ui: UiState; revision: string }>('/ui')
  },

  /** Rejects with `ConflictError` (409, `currentRevision`) when `baseRevision` is stale. */
  async patchUi(
    patch: Partial<Pick<UiState, 'pinned' | 'sections' | 'allNotesLayout'>>,
    opts: { baseRevision: string },
  ): Promise<{ ui: UiState; revision: string }> {
    const res = await request<{ ui: UiState; revision: string }>(
      '/ui',
      json('PUT', { patch, baseRevision: opts.baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([defEvent('ui', 'ui.json', res.revision ?? null)])
    return res
  },

  /** Subscribe to file changes pushed over SSE. Returns an unsubscribe function. */
  onChange(cb: ChangeListener): () => void {
    listeners.add(cb)
    ensureSource()
    return () => {
      listeners.delete(cb)
      if (listeners.size === 0 && source) {
        source.close()
        source = null
      }
    }
  },
}

export type Api = typeof api
