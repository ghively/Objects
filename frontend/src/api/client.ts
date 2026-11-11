import type {
  AddRemoteAgentRequest,
  Agent,
  AgentChatSummary,
  AppInfo,
  AgentInput,
  AgentTranscript,
  AgentTrashItem,
  CreateAgentRequest,
  RemoteAuthInput,
  RemotePreview,
  RemoteRefreshResult,
  SaveRemoteAgentRequest,
  ToolGroup,
  ChatSearchHit,
  LearningSettings,
  LearningState,
  LedgerEntry,
  LedgerSummary,
  MemoryFile,
  ReviewStatus,
  SkillDetail,
  SkillSummary,
  RelationPairKind,
  RelationPairResult,
  SaveAiChatRequest,
  AiChat,
  AiChatRequest,
  AiEvent,
  AiModels,
  AiStatus,
  ApiTokenList,
  ApiTokenScope,
  CreatedApiToken,
  Attachment,
  AutomationCatchUpChoice,
  AutomationCatchUpItem,
  AutomationRule,
  AutomationRuleInput,
  AutomationRun,
  BlockInfo,
  CatchUp,
  DuplicatedObject,
  ImportBatch,
  ImportBatchItem,
  ImportJob,
  ImportPreview,
  ImportPreviewRequest,
  MergeResult,
  OccurrenceAction,
  OverdueInfo,
  RestoreVersionResult,
  SpaceSetup,
  StartImportRequest,
  StartImportResponse,
  TaskStats,
  VersionContent,
  VersionInfo,
  CalendarRange,
  CalendarUi,
  ChangeEvent,
  ChangeKind,
  ChangeKindResult,
  CounterpartEditRequest,
  CounterpartEditResult,
  FormulaPreviewRequest,
  FormulaPreviewResult,
  NumberExistingResult,
  Collection,
  FilingStatus,
  FilingVerdict,
  ImportProposalResponse,
  EntitiesReview,
  EntitiesView,
  ProposalReviewItem,
  CreatedDailyNote,
  GraphCustomization,
  GraphData,
  CreatedFile,
  DeleteCollectionResult,
  Icon,
  MappingRow,
  ObjectDetail,
  ObjectSummary,
  Query,
  References,
  RenameResult,
  RestoreResult,
  Row,
  RowsScope,
  SaveCollectionResult,
  SaveResult,
  SaveTypeResult,
  SearchResponse,
  SettingsResponse,
  DeviceSettings,
  SpaceEntry,
  SpaceInfo,
  SpacePatch,
  SyncResult,
  TasksUi,
  TrashItem,
  TypeDef,
  TypeTemplate,
  UiState,
  UpdateResult,
  UploadedAttachment,
  Views,
  McpServer,
  McpServerInput,
  McpServersAnswer,
  McpTestResult,
  SecretVar,
  AddWorkFieldsResult,
  StepOp,
  WorkFloorRequest,
  WorkItem,
  WorkItemSummary,
  WorkStep,
  WorkStepRequest,
  WorkWriteResult,
  AgentStatus,
  AlertScanReport,
  CaptureRequest,
  CaptureItem,
  CaptureSummary,
  DeskSyncStatus,
  ReadToolServer,
  WorkAgentSettings,
  FocusDay,
  GeneralFloor,
  WorkAlerts,
  WorkBoard,
  WorkToday,
  WorkWins,
} from './types'
import type { WhiteboardSettings } from './whiteboardTypes'
import { getMediaToken, withMediaToken } from '@/settings/mediaToken'

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

/**
 * M22: 409 from a step or floor-item action (`workStep`, `workSteps`, `workFloor`): the step (or
 * floor item) changed since its `rev` was read. Nothing was written. `message` is the server's
 * detail ("This step changed. Look again."); `step` is the step as it is now, when the server sends it.
 */
export class StepChangedError extends ConflictError {
  readonly step: WorkStep | null
  constructor(message: string, currentVersion: string, step: WorkStep | null = null) {
    super(currentVersion)
    this.name = 'StepChangedError'
    this.message = message
    this.step = step
  }
}

/**
 * M23: 501 from a seam M24 fills (the brain-dump save, the agent switch and retry) or from Keep on
 * top outside the Object window. `message` is the server's detail ("Saving a brain dump comes with
 * M24."). Nothing was written.
 */
export class UnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnavailableError'
  }
}

/** A call whose 501 becomes `UnavailableError` (other routes keep their `ApiError` 501). */
async function seamCall<T>(call: Promise<T>): Promise<T> {
  try {
    return await call
  } catch (e) {
    if (e instanceof ApiError && e.status === 501) throw new UnavailableError(e.message)
    throw e
  }
}

/** The `StepChangedError` a work action's 409 detail becomes. */
function stepChanged(d: Record<string, unknown>): Error {
  const message = typeof d.detail === 'string' ? d.detail : 'This step changed. Look again.'
  const step = d.step && typeof d.step === 'object' ? (d.step as WorkStep) : null
  return new StepChangedError(message, String(d.currentVersion ?? ''), step)
}

/** 428: the write needs `confirm: true`; `affected` files would change. Nothing was written. */
export class ConfirmRequiredError extends ApiError {
  readonly affected: number
  /** M8: the space folder's identity token (`POST /spaces/delete`), sent back with the confirm. */
  readonly folder: string | null
  constructor(message: string, affected: number, folder: string | null = null) {
    super(428, message)
    this.name = 'ConfirmRequiredError'
    this.affected = affected
    this.folder = folder
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

/**
 * 409 on `POST /api/daily-notes`; nothing was written. `reason` `'exists'`: the day's note is
 * at `path`. `'nameTaken'`: `path` is another file holding the note's name (not the day's note).
 */
export class DailyNoteExistsError extends ApiError {
  readonly path: string
  readonly reason: 'exists' | 'nameTaken'
  constructor(message: string, path: string, reason: 'exists' | 'nameTaken' = 'exists') {
    super(409, message)
    this.name = 'DailyNoteExistsError'
    this.path = path
    this.reason = reason
  }
}

/** The keys `PUT /api/ui` accepts (M3's, plus M4's `calendar`, `tasks` and `reminders`, M5's `graph` and M6's `whiteboard`). */
export type UiPatch = Partial<Pick<UiState, 'pinned' | 'sections' | 'allNotesLayout'>> & {
  calendar?: CalendarUi
  tasks?: TasksUi
  reminders?: { enabled: boolean }
  /** Replaces the whole `graph` value. */
  graph?: GraphCustomization
  /** Replaces the whole `whiteboard` value (the canvas display settings). */
  whiteboard?: WhiteboardSettings
  /** M9: the sidebar's section order. */
  workspaceOrder?: string[]
  /** The sidebar's Object Types sort. */
  objectsSectionSortOption?: 'alphabetical' | 'manual'
  /** Replaces the whole `workspace` value; `objects.ids` is the manual Object Types order. */
  workspace?: { objects?: { ids?: string[] } }
}

/** `api.search` options; `types`/`excludeTypes` are type ids, `tag` a tag name. */
export interface SearchOptions {
  types?: string[]
  excludeTypes?: string[]
  tag?: string
  limit?: number
  /** M8: `fullText` matches bodies only ("Text matches only"). */
  mode?: 'auto' | 'title' | 'fullText'
  signal?: AbortSignal
}

/** `api.linkMention` input: link the mention `text` at `[start, end)` of `path`'s body to `target`. */
export interface LinkMentionInput {
  /** The mentioning object. */
  path: string
  /** The mentioned object. */
  target: string
  start: number
  end: number
  text: string
  baseVersion: string
}

/** `api.exportObjectUrl` options (polish item 23); only `media` is required (Markdown). */
export interface ExportUrlOptions {
  media: boolean
  format?: 'md' | 'html' | 'docx' | 'latex'
  subpages?: boolean
  titleH1?: boolean
  wikilinks?: boolean
  style?: 'notes' | 'essay' | 'academic'
  paper?: 'A4' | 'Letter'
  embedded?: boolean
  outline?: boolean
  hideEmpty?: boolean
  typeLabels?: boolean
  /** Deselected property keys. */
  hide?: string[]
}

/** A property the Export dialog lists. */
export interface ExportProperty {
  key: string
  name: string
  empty: boolean
}

/** The export route's query: booleans as `1`/`0`, `hide` comma-separated, unset keys left out. */
function exportParams(path: string, opts: ExportUrlOptions): Record<string, string | undefined> {
  const { media, hide, ...rest } = opts
  const out: Record<string, string | undefined> = { path, media: media ? '1' : '0' }
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) out[k] = typeof v === 'boolean' ? (v ? '1' : '0') : v
  }
  out.hide = hide?.join(',')
  return out
}

const BASE = '/api'

/** A 409 from the spaces routes is not a revision conflict: keep the server's message. */
function spaceConflict(d: Record<string, unknown>): Error {
  return new ApiError(409, typeof d.detail === 'string' ? d.detail : 'conflict')
}

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

async function request<T>(path: string, init?: RequestInit, on409?: (d: Record<string, unknown>) => Error): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  })
  return answer<T>(res, path, on409)
}

/** A response's JSON body, or the error its status maps to. */
async function answer<T>(res: Response, path: string, on409?: (d: Record<string, unknown>) => Error): Promise<T> {
  const data = await readJson(res)
  if (res.ok) return data as T
  const d = detailOf(data)
  if (res.status === 409 && on409) throw on409(d)
  if (res.status === 409) {
    const current = String(d.currentVersion ?? d.currentRevision ?? '')
    if (path.startsWith('/types') || d.currentRevision !== undefined) throw new RevisionConflictError(current)
    throw new ConflictError(current)
  }
  if (res.status === 423) throw new ReadOnlyError(String(d.reason ?? (typeof d.detail === 'string' ? d.detail : 'read-only')))
  if (res.status === 428) {
    const message = typeof d.detail === 'string' ? d.detail : 'Confirmation required'
    throw new ConfirmRequiredError(message, Number(d.affected ?? 0), typeof d.folder === 'string' ? d.folder : null)
  }
  const detail = data && typeof data === 'object' ? (data as Record<string, unknown>).detail : undefined
  // 400/404 carry the server's message as {detail: "..."}; a request validation 422 a list of
  // {loc, msg}.
  const message =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail) && detail.length > 0
        ? detail.map(validationMessage).join('; ')
        : typeof data === 'string'
          ? data
          : res.statusText
  throw new ApiError(res.status, message)
}

/** The last body and `ETag` per conditional GET path (`/graph`). */
const etagged = new Map<string, { etag: string; body: unknown }>()

/**
 * A GET that revalidates: with a cached `ETag` it sends `If-None-Match`, and a `304` answers the
 * cached body itself (the same object, so callers can skip work on identity). A server that sends
 * no `ETag` gets a plain request each time.
 */
async function conditionalGet<T>(path: string): Promise<T> {
  const cached = etagged.get(path)
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', ...(cached ? { 'If-None-Match': cached.etag } : {}) },
  })
  if (res.status === 304 && cached) return cached.body as T
  if (res.status === 304) return request<T>(path)
  let data: T
  try {
    data = await answer<T>(res, path)
  } catch (e) {
    etagged.delete(path)
    throw e
  }
  const etag = res.headers.get('ETag')
  if (etag) etagged.set(path, { etag, body: data })
  else etagged.delete(path)
  return data
}

/** Forget the cached conditional GET bodies (tests; a space switch reloads the page). */
export function resetGraphCache(): void {
  etagged.clear()
}

/** One FastAPI validation error, `field: message`. */
function validationMessage(e: unknown): string {
  if (!e || typeof e !== 'object') return String(e)
  const { loc, msg } = e as { loc?: unknown; msg?: unknown }
  const field = Array.isArray(loc) && loc.length > 0 ? String(loc[loc.length - 1]) : ''
  const text = typeof msg === 'string' ? msg : JSON.stringify(e)
  return field ? `${field}: ${text}` : text
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

/**
 * M32: the most bytes of body saves sent with `keepalive` at one time. Browsers allow 64 KiB over
 * all the keepalive requests in flight and refuse one that would go over, so a save that does not
 * fit (a longer note, or one sent while others are in flight) goes as a normal request, which a
 * closing page may cut off (the editor keeps its text for the next open: `editor/unsaved.ts`).
 */
export const KEEPALIVE_MAX_BYTES = 60 * 1024
/** The bytes of the keepalive body saves that have no answer yet. */
let keepaliveInFlight = 0

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

/**
 * Announce a `changed` for `path` that this window's own write caused but `api` didn't make: a
 * whiteboard or ink save's stamp of the board `.md`'s `lastUpdated` (M9). The server's own
 * `changed` for it carries our `CLIENT_ID` and is dropped as an echo.
 */
export function announceLocalChange(path: string, version: string | null): void {
  emitLocal([changed(path, version)])
}

function changed(path: string, version: string | null = null, linked?: string[]): ChangeEvent {
  const e: ChangeEvent = { kind: 'changed', path, version, origin: CLIENT_ID }
  if (linked) e.linked = linked
  return e
}

function created(path: string, version: string | null = null): ChangeEvent {
  return { kind: 'created', path, version, origin: CLIENT_ID }
}

function typesEvent(id: string, revision: string | null = null): ChangeEvent {
  return { kind: 'types', path: id, version: revision, origin: CLIENT_ID }
}

function defEvent(kind: 'collections' | 'queries' | 'views' | 'ui' | 'automations', path: string, version: string | null = null): ChangeEvent {
  return { kind, path, version, origin: CLIENT_ID }
}

/** M22: a work write's `changed` events: the item, then each relation-synced object. */
function workEvents(path: string, res: WorkWriteResult): ChangeEvent[] {
  return [changed(path, res.version ?? null), ...(res.synced ?? []).map((p) => changed(p))]
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

/**
 * The events every listener resyncs from after the stream dropped: the server keeps no replay
 * (no `Last-Event-ID`), so whatever happened while disconnected is announced as "everything
 * may have changed". `types` with path `*` reloads summaries, types, rows, references, the
 * calendar and the graph, and makes the open object, board and ink documents re-check their
 * versions; `views` reloads a type page's saved views; the others reload `ui.json` and the
 * definitions. The origin is no window's, so nothing takes them for its own echo.
 */
export const RESYNC_PATH = '*'
const RESYNC_EVENTS: readonly ChangeEvent[] = [
  { kind: 'types', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'views', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'ui', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'collections', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'queries', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'automations', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'agents', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'agentChats', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'agentLearning', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'work', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'workQueue', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'mcpServers', path: RESYNC_PATH, version: null, origin: null },
  { kind: 'settings', path: RESYNC_PATH, version: null, origin: null },
]

/**
 * Announce to this window that every object and type may have changed: the same `types` resync a
 * reconnect sends (and the server sends when an import into the open space ends, M15 review
 * finding 2). The import dialog calls it when its job ends into this space, so this window reloads
 * its index and types even if it missed the server's event.
 */
export function announceResync(): void {
  emitLocal([{ kind: 'types', path: RESYNC_PATH, version: null, origin: null }])
}

/** Whether `e` is the synthetic "everything of `kind` may have changed" event sent after a reconnect. */
export function isResync(e: ChangeEvent, kind: ChangeKind): boolean {
  return e.kind === kind && e.path === RESYNC_PATH
}

/** `EventSource.CLOSED`: the browser gave up on the stream and will not reconnect it by itself. */
const STREAM_CLOSED = 2
/** The first wait before the stream is made again after the browser closed it, doubled up to the max. */
const STREAM_RETRY_MS = 1_000
const STREAM_RETRY_MAX_MS = 30_000
let retryMs = STREAM_RETRY_MS
let retryTimer: ReturnType<typeof setTimeout> | null = null

function ensureSource(resyncOnOpen = false) {
  if (source || typeof EventSource === 'undefined') return
  if (retryTimer) {
    // A new subscription while a closed stream waits to be made again: make it now, still a resync.
    clearTimeout(retryTimer)
    retryTimer = null
    resyncOnOpen = true
  }
  const es = new EventSource(`${BASE}/events`)
  source = es
  // The browser reconnects an `EventSource` by itself after a drop (server restart, sleep), but
  // the events published in between are gone: `open` after an `error` resyncs every consumer.
  let dropped = resyncOnOpen
  es.onerror = () => {
    dropped = true
    // Audit 2026-11-07 #39: some drops (an HTTP error answer, a refused connection) close the
    // stream for good; it is made again after a growing wait, and its `open` resyncs.
    if (es.readyState !== STREAM_CLOSED || source !== es) return
    es.close()
    source = null
    const wait = retryMs
    retryMs = Math.min(retryMs * 2, STREAM_RETRY_MAX_MS)
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (listeners.size > 0) ensureSource(true)
    }, wait)
  }
  es.onopen = () => {
    retryMs = STREAM_RETRY_MS
    if (!dropped) return
    dropped = false
    for (const e of RESYNC_EVENTS) emit({ ...e })
  }
  es.addEventListener('change', (msg) => {
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
  /** The app's version, for the Settings nav's footer. */
  appInfo(): Promise<AppInfo> {
    return request<AppInfo>('/app')
  },

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
   *
   * M32: every save that fits is sent with `keepalive`, so the browser completes it even when
   * the window is closed or reloaded right after (whatever asked for it: a pause in typing, a
   * blur, `pagehide`). One that does not fit `KEEPALIVE_MAX_BYTES` with the saves already in
   * flight is a normal request.
   */
  async saveBody(path: string, body: string, baseVersion: string): Promise<SaveResult> {
    const payload = JSON.stringify({ path, body, baseVersion, clientId: CLIENT_ID })
    const bytes = new TextEncoder().encode(payload).length
    const keepalive = keepaliveInFlight + bytes <= KEEPALIVE_MAX_BYTES
    if (keepalive) keepaliveInFlight += bytes
    let res: SaveResult
    try {
      res = await request<SaveResult>('/object/body', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        ...(keepalive ? { keepalive: true } : {}),
      })
    } finally {
      if (keepalive) keepaliveInFlight -= bytes
    }
    if (res && res.version && res.version !== baseVersion) {
      // `linked` lets a backlink-keyed view in this window (the Tasks dashboard) refresh
      // only the rows this save may have linked, as the SSE event does for other windows.
      const event: ChangeEvent = { kind: 'changed', path, version: res.version, origin: CLIENT_ID }
      if (res.linked) event.linked = res.linked
      // Next task: the saving view adopts the new version first, so it ignores this.
      setTimeout(() => emit(event), 0)
    }
    return res
  },

  /**
   * Set (or clear with `null`) frontmatter properties; `remove` deletes keys. Announces `changed`
   * for the object and for each relation-synced object. A Task `status` change that crosses a
   * category also returns `task` (completed, reopened or advanced; M4).
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
    if (res.version !== baseVersion) events.push(changed(path, res.version, res.linked))
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

  /**
   * M28: add or remove other objects on one of `req.path`'s counterpart rows. The server writes
   * only the stored side of each other object; each written one is announced as `changed`, naming
   * `req.path` as linked (its counterparts changed). 404 no object; 422 a bad key or type; 423.
   */
  async editCounterpart(req: CounterpartEditRequest): Promise<CounterpartEditResult> {
    const res = await request<CounterpartEditResult>(
      '/object/counterpart',
      json('POST', { ...req, clientId: req.clientId ?? CLIENT_ID }),
    )
    emitLocal((res.written ?? []).map((w) => changed(w.path, w.version, [req.path])))
    return res
  },

  /** M9: duplicate an object as "<Title> (Copy)" in the same folder. */
  async duplicateObject(path: string): Promise<DuplicatedObject> {
    const res = await request<DuplicatedObject>('/object/duplicate', json('POST', { path, clientId: CLIENT_ID }))
    emitLocal([created(res.path, res.version)])
    return res
  },

  /**
   * M9: the same-origin download URL of an object's export: its `.md`, or a zip with its media.
   * Polish item 23: `format` (`html` is the printable PDF page, `docx`, `latex`) and the
   * dialog's other options; booleans are sent as `1`/`0`, `hide` as comma-separated keys.
   */
  exportObjectUrl(path: string, opts: ExportUrlOptions): string {
    return `${BASE}/object/export${qs(exportParams(path, opts))}`
  },

  /** Polish item 23: the properties the Export dialog lists (`{key, name, empty}`, type order). */
  async exportProperties(path: string): Promise<ExportProperty[]> {
    return request<ExportProperty[]>(`/object/export/properties${qs({ path })}`)
  },

  /** Create an object. `templateId`: an id, `null` for the type's default, `"none"` for no template. */
  /**
   * Create an object. `body` replaces the body it would get (its `# title` or its template's);
   * `appendBody` is added below that body. Both are written in the creating write, so no rule
   * that fires on the creation can come between the object and its text (M14).
   */
  async createObject(
    typeId: string,
    opts: {
      title?: string
      templateId?: string | null
      values?: Record<string, unknown>
      body?: string
      appendBody?: string
    } = {},
  ): Promise<CreatedFile> {
    const body: Record<string, unknown> = { typeId }
    if (opts.title !== undefined) body.title = opts.title
    if (opts.templateId !== undefined) body.templateId = opts.templateId
    if (opts.values !== undefined) body.values = opts.values
    if (opts.body !== undefined) body.body = opts.body
    if (opts.appendBody !== undefined) body.appendBody = opts.appendBody
    body.clientId = CLIENT_ID
    const res = await request<CreatedFile & { typeIds?: string[] }>('/objects', json('POST', body))
    // An inferred type saved for the first time: the server's `types` event is our own echo.
    emitLocal([created(res.path, res.version), ...(res.typeIds ?? []).map((t) => typesEvent(t))])
    return { path: res.path, version: res.version }
  },

  /**
   * Create the daily note for `date` (YYYY-MM-DD). `templateId`: an id, `null` for the type's
   * default, `"none"` for no template. A 409 throws `DailyNoteExistsError` carrying the path and
   * whether it is the day's note (`reason: 'exists'`) or another file with its name (`'nameTaken'`).
   */
  async createDailyNote(date: string, opts: { templateId?: string | null } = {}): Promise<CreatedDailyNote> {
    const body: Record<string, unknown> = { date }
    if (opts.templateId !== undefined) body.templateId = opts.templateId
    body.clientId = CLIENT_ID
    const res = await request<CreatedDailyNote>('/daily-notes', json('POST', body), (d) =>
      new DailyNoteExistsError(
        typeof d.detail === 'string' ? d.detail : 'A daily note for this day exists',
        String(d.path ?? ''),
        d.reason === 'nameTaken' ? 'nameTaken' : 'exists',
      ),
    )
    // M32: the server answers 200 with `existing: true` for a day whose note is already there. To callers that is
    // still "exists": nothing was created, so no `created` event, and nobody may treat it as a fresh note (the
    // slot would otherwise write its tags over the note's own).
    if (res.existing) throw new DailyNoteExistsError('A daily note for this day exists', res.path, 'exists')
    emitLocal([created(res.path, res.version), ...(res.typeIds ?? []).map((t) => typesEvent(t))])
    return { path: res.path, version: res.version, typeIds: res.typeIds ?? [] }
  },

  /** The calendar's days from `from` to `to` (YYYY-MM-DD, inclusive; at most 100 days). */
  calendar(from: string, to: string): Promise<CalendarRange> {
    return request<CalendarRange>(`/calendar${qs({ from, to })}`)
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
      ...(res.automationIds ?? []).map((a) => defEvent('automations', a)),
      // Members whose `collections:` item a collection restore wrote back.
      ...(res.rewritten ?? []).map((p) => changed(p)),
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

  /** The "Add new object type" gallery (item 21). */
  typeGallery(): Promise<TypeTemplate[]> {
    return request<TypeTemplate[]>('/type-gallery')
  },

  /** Create a type; with `template` (a gallery key) the server fills in what isn't given. */
  async createType(input: {
    name: string
    pluralName: string
    icon?: Icon
    color?: string
    template?: string
  }): Promise<TypeDef> {
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

  /**
   * M13: add the "Parent item"/"Sub-items" or "Blocked by"/"Blocking" relation pair to a type
   * (two-way, targeting the type itself), or reuse the pair it already has.
   */
  async createRelationPair(typeId: string, kind: RelationPairKind, baseRevision: string): Promise<RelationPairResult> {
    const res = await request<RelationPairResult>(
      `/types/${seg(typeId)}/relation-pair`,
      json('POST', { kind, baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([typesEvent(res.type?.id ?? typeId, res.type?.revision ?? null)])
    return res
  },

  /** M12: parse a formula and, with `path`, evaluate it against that object. Writes nothing. */
  async formulaPreview(req: FormulaPreviewRequest): Promise<FormulaPreviewResult> {
    return request<FormulaPreviewResult>('/formula/preview', json('POST', req))
  },

  /** M12: give every object of the type without an ID value the next number, oldest first. */
  async numberExistingObjects(typeId: string, propertyId: string, baseRevision: string): Promise<NumberExistingResult> {
    const res = await request<NumberExistingResult>(
      `/types/${seg(typeId)}/properties/${seg(propertyId)}/number-existing`,
      json('POST', { baseRevision, clientId: CLIENT_ID }),
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

  /** Move a type, its objects, its templates and its only-this-type queries to the Trash. Rejects with 428 unless `confirm`. */
  async deleteType(id: string, opts: { confirm?: boolean } = {}): Promise<{ trashId: string }> {
    const res = await request<{ trashId: string; paths?: string[]; typeIds?: string[]; queryIds?: string[] }>(
      `/types/${seg(id)}${qs({ confirm: opts.confirm ? 'true' : undefined, clientId: CLIENT_ID })}`,
      { method: 'DELETE' },
    )
    // The type's objects, templates and saved queries of only this type went to the Trash, other
    // types may have dropped it from their relations and other queries from their types: announce
    // each, since the server's events for them are our echoes.
    const typeIds = res.typeIds?.length ? res.typeIds : [id]
    emitLocal([
      ...typeIds.map((t) => typesEvent(t)),
      ...(res.paths ?? []).map((p): ChangeEvent => ({ kind: 'deleted', path: p, version: null, origin: CLIENT_ID })),
      ...(res.queryIds ?? []).map((q) => defEvent('queries', q)),
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

  /**
   * URL of an image file in the space (`GET /api/file`), with the media token "Clear media cache"
   * bumps once it has been cleared (`settings/mediaToken.ts`; the server ignores it).
   */
  fileUrl(path: string): string {
    return withMediaToken(`${BASE}/file${qs({ path })}`, getMediaToken())
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
    // Sole members went to the Trash (`deleted`, so a view open on one holds its edits) and the
    // others lost one `collections:` item (`changed`); the collection event reloads every view.
    const skipped = new Set((res.skipped ?? []).map((s) => s.path))
    emitLocal([
      defEvent('collections', id),
      ...(res.deleted ?? []).map((p): ChangeEvent => ({ kind: 'deleted', path: p, version: null, origin: CLIENT_ID })),
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

  /** Pinned items, custom sidebar sections, the All notes layout and (M4) calendar, tasks and reminders. */
  ui(): Promise<{ ui: UiState; revision: string }> {
    return request<{ ui: UiState; revision: string }>('/ui')
  },

  /** Rejects with `ConflictError` (409, `currentRevision`) when `baseRevision` is stale. */
  async patchUi(
    patch: UiPatch,
    opts: { baseRevision: string },
  ): Promise<{ ui: UiState; revision: string }> {
    const res = await request<{ ui: UiState; revision: string }>(
      '/ui',
      json('PUT', { patch, baseRevision: opts.baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([defEvent('ui', 'ui.json', res.revision ?? null)])
    return res
  },

  // ---- M5: search, references, graph ----

  /** Search titles, aliases and full text. Repeats `type`/`excludeType` once per id. */
  search(q: string, opts: SearchOptions = {}): Promise<SearchResponse> {
    const sp = new URLSearchParams()
    sp.append('q', q)
    for (const t of opts.types ?? []) sp.append('type', t)
    for (const t of opts.excludeTypes ?? []) sp.append('excludeType', t)
    if (opts.tag) sp.append('tag', opts.tag)
    if (opts.limit !== undefined) sp.append('limit', String(opts.limit))
    if (opts.mode) sp.append('mode', opts.mode)
    return request<SearchResponse>(`/search?${sp.toString()}`, opts.signal ? { signal: opts.signal } : undefined)
  },

  /** M10: whether the Claude Code CLI is there and signed in. */
  aiStatus(): Promise<AiStatus> {
    return request<AiStatus>('/ai/status')
  },

  /** M16: the model choices (the back end's one list) and the model-name pattern. */
  aiModels(): Promise<AiModels> {
    return request<AiModels>('/ai/models')
  },

  /**
   * M10: one AI turn. Calls `onEvent` for each server-sent event until `done` or `error`;
   * aborting `signal` closes the stream, which stops the CLI. Resolves when the stream ends.
   */
  async aiChat(req: AiChatRequest, onEvent: (e: AiEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${BASE}/ai/chat`, {
      ...json('POST', { ...req, clientId: req.clientId ?? CLIENT_ID }),
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      signal,
    })
    if (!res.ok || !res.body) {
      await answer(res, '/ai/chat')
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let cut: number
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n')
        if (!data) continue
        try {
          onEvent(JSON.parse(data) as AiEvent)
        } catch {
          // a malformed frame: skip it
        }
      }
    }
  },

  /** M10: a saved AI chat and its messages. */
  aiChatLoad(path: string): Promise<AiChat> {
    return request<AiChat>(`/ai/chat${qs({ path })}`)
  },

  /** M10: create or update an AI chat object; rejects with `ConflictError` on a stale version. */
  saveAiChat(req: SaveAiChatRequest): Promise<{ path: string; version: string }> {
    return request<{ path: string; version: string }>('/ai/chat/save', json('POST', { ...req, clientId: req.clientId ?? CLIENT_ID }))
  },

  /** M11: the local API tokens of this space and an MCP config template. */
  apiTokens(): Promise<ApiTokenList> {
    return request<ApiTokenList>('/integrations/tokens')
  },

  /** M11: make a token; the answer holds its secret, shown this once. */
  createApiToken(name: string, scope: ApiTokenScope): Promise<CreatedApiToken> {
    return request<CreatedApiToken>('/integrations/tokens', json('POST', { name, scope }))
  },

  /** M11: revoke a token; programs using it lose access at once. */
  revokeApiToken(id: string): Promise<{ revoked: string }> {
    return request<{ revoked: string }>(`/integrations/tokens/${seg(id)}`, { method: 'DELETE' })
  },

  /** Drop and rebuild the search index in the background (`partial` until done). */
  reindex(): Promise<{ started: boolean }> {
    return request<{ started: boolean }>('/search/reindex', json('POST', { clientId: CLIENT_ID }))
  },

  /** An object's references section: tabs, backlinks in context, mentions, related content and tags. */
  references(path: string, opts: { relatedLimit?: number } = {}): Promise<References> {
    const relatedLimit = opts.relatedLimit !== undefined ? String(opts.relatedLimit) : undefined
    return request<References>(`/references${qs({ path, relatedLimit })}`)
  },

  /**
   * Turn an unlinked mention into a link (one write to the mentioning object `path`).
   * Rejects with `ConflictError` (409) when `baseVersion` is stale; announces `changed` for `path`.
   */
  async linkMention(input: LinkMentionInput): Promise<{ version: string }> {
    const res = await request<{ version: string }>('/references/link', json('POST', { ...input, clientId: CLIENT_ID }))
    if (res && res.version !== input.baseVersion) emitLocal([changed(input.path, res.version)])
    return res
  },

  /** Every object as a graph node, with link and tag pairs. */
  graph(): Promise<GraphData> {
    return conditionalGet<GraphData>('/graph')
  },

  // ---- M7: attachments, space settings, device settings, spaces ----

  /** Every attachment in the space (images, PDFs, audio, video, and any file under `Attachments/`). */
  attachments(): Promise<Attachment[]> {
    return request<Attachment[]>('/attachments')
  },

  /**
   * Copy a file into `Attachments/` (never overwrites: `name (2).ext` when taken). Sends the raw
   * bytes, as `importImage` does. 413 over 100 MiB, 422 for an empty or unusable name.
   */
  async uploadAttachment(blob: Blob | ArrayBuffer, name: string): Promise<UploadedAttachment> {
    const res = await request<UploadedAttachment>(`/attachments${qs({ name })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob,
    })
    emitLocal([created(res.path)])
    return res
  },

  /** Open an attachment with the OS default app. 415 for executables and scripts. */
  openAttachment(path: string): Promise<{ ok: true }> {
    return request<{ ok: true }>('/attachments/open', json('POST', { path }))
  },

  /** Write `space.json`'s name, icon, description or hide-task-management. 409 stale, 422, 423. */
  patchSpace(patch: SpacePatch, opts: { baseRevision: string }): Promise<SpaceInfo> {
    return request<SpaceInfo>('/space', json('PUT', { patch, baseRevision: opts.baseRevision, clientId: CLIENT_ID }))
  },

  /** This device's settings, defaults merged (revision `''` when no file exists). */
  settings(): Promise<SettingsResponse> {
    return request<SettingsResponse>('/settings')
  },

  /** Patch device settings. Rejects with `ConflictError` (409) on a stale `baseRevision`. */
  patchSettings(patch: Partial<DeviceSettings>, opts: { baseRevision: string }): Promise<SettingsResponse> {
    return request<SettingsResponse>('/settings', json('PUT', { patch, baseRevision: opts.baseRevision, clientId: CLIENT_ID }))
  },

  /** The spaces registry (unwrapped from `{spaces}`), in registry order. */
  async spaces(): Promise<SpaceEntry[]> {
    const res = await request<{ spaces: SpaceEntry[] }>('/spaces')
    return res?.spaces ?? []
  },

  /**
   * Create `<location>/<safe name>/` with `space.json` and register it. 409 (`ApiError`) when the folder exists.
   * M8: `setup` `'basic'` also writes the Person, Meeting, Project and Book types.
   */
  createSpace(name: string, location: string, setup?: SpaceSetup): Promise<{ path: string }> {
    const body: Record<string, unknown> = { name, location }
    if (setup !== undefined) body.setup = setup
    return request<{ path: string }>('/spaces', json('POST', body), spaceConflict)
  },

  /**
   * Fix pass H2: apply "Pick a starting point" to the open (new or empty) space; returns the fresh
   * space info. 409 when the space already has one.
   */
  spaceSetup(setup: SpaceSetup): Promise<SpaceInfo> {
    return request<SpaceInfo>('/space/setup', json('POST', { setup }))
  },

  /** Register an existing folder as a space. 404 when it is not a folder. */
  openSpace(path: string): Promise<{ path: string }> {
    return request<{ path: string }>('/spaces/open', json('POST', { path }))
  },

  /** Remove a space from the list (its folder is never touched). 409 (`ApiError`) for the current space. */
  removeSpace(path: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/spaces${qs({ path })}`, { method: 'DELETE' }, spaceConflict)
  },

  /** Ask the launcher to restart on `path` (202). 404 not a folder; 503 without the launcher. */
  switchSpace(path: string): Promise<{ path: string }> {
    return request<{ path: string }>('/spaces/switch', json('POST', { path }))
  },

  // ---- M8: tasks, blocks, history, merge, spaces ----

  /** A recurring by-due-date task's missed occurrences. 422 when it isn't one. */
  overdue(path: string): Promise<OverdueInfo> {
    return request<OverdueInfo>(`/tasks/overdue?path=${seg(path)}`)
  },

  /** Complete, skip or excuse the current occurrence (`catchUp` for overdue ones). 409 stale. */
  async occurrence(
    path: string,
    action: OccurrenceAction,
    opts: { catchUp?: CatchUp; baseVersion: string },
  ): Promise<UpdateResult> {
    const body: Record<string, unknown> = { path, action }
    if (opts.catchUp) body.catchUp = opts.catchUp
    Object.assign(body, { baseVersion: opts.baseVersion, clientId: CLIENT_ID })
    const res = await request<UpdateResult>('/tasks/occurrence', json('POST', body))
    if (res.version !== opts.baseVersion) emitLocal([changed(path, res.version)])
    return res
  },

  /** A recurring task's streaks, completion rate and occurrence grid. */
  taskStats(path: string): Promise<TaskStats> {
    return request<TaskStats>(`/tasks/stats?path=${seg(path)}`)
  },

  /** Set (or clear with `null`) the reminder of date property `key`. 409 stale, 422. */
  async setReminder(path: string, key: string, remind: string | null, opts: { baseVersion: string }): Promise<UpdateResult> {
    const res = await request<UpdateResult>(
      '/tasks/reminder',
      json('PUT', { path, key, remind, baseVersion: opts.baseVersion, clientId: CLIENT_ID }),
    )
    if (res.version !== opts.baseVersion) emitLocal([changed(path, res.version)])
    return res
  },

  /** One block of an object by its `^id`. 404 when the object or block is missing. */
  block(path: string, id: string): Promise<BlockInfo> {
    return request<BlockInfo>(`/block?path=${seg(path)}&id=${seg(id)}`)
  },

  /** The objects referencing block `id` of `path`, title then path. */
  blockReferences(path: string, id: string): Promise<{ paths: string[] }> {
    return request<{ paths: string[] }>(`/block/references?path=${seg(path)}&id=${seg(id)}`)
  },

  /** An object's (or board's) saved versions, newest first. */
  async history(path: string): Promise<VersionInfo[]> {
    const res = await request<{ versions: VersionInfo[] }>(`/history?path=${seg(path)}`)
    return res?.versions ?? []
  },

  /** One version's content (`text` null for whiteboards). */
  historyVersion(path: string, id: string): Promise<VersionContent> {
    return request<VersionContent>(`/history/version?path=${seg(path)}&id=${seg(id)}`)
  },

  /** Restore a version (the current state is kept as a version first). 409 stale. */
  async restoreVersion(path: string, id: string, opts: { baseVersion: string }): Promise<RestoreVersionResult> {
    const res = await request<RestoreVersionResult>(
      '/history/restore',
      json('POST', { path, id, baseVersion: opts.baseVersion, clientId: CLIENT_ID }),
    )
    // A board's restore rewrites its sidecars: the canvas, ink layer and notes reload on the
    // `whiteboard` event (the server's copy carries our origin and is dropped in `ensureSource`).
    emitLocal([
      ...(res?.revision !== undefined
        ? [{ kind: 'whiteboard', path, version: res.revision || null, origin: CLIENT_ID } as ChangeEvent]
        : []),
      changed(path, res?.version ?? null),
    ])
    return res
  },

  /**
   * Merge `source` into `target` ("Merge into object" / "Merge into tag"); the source goes to the
   * Trash. Always sends `confirm: true` (the dialog is the confirmation). 409 stale, 413, 422.
   */
  async mergeObject(
    source: string,
    target: string,
    opts: { sourceVersion: string; targetVersion: string },
  ): Promise<MergeResult> {
    const res = await request<MergeResult>(
      '/object/merge',
      json('POST', {
        source,
        target,
        sourceVersion: opts.sourceVersion,
        targetVersion: opts.targetVersion,
        confirm: true,
        clientId: CLIENT_ID,
      }),
    )
    const target_ = res?.target ?? target
    emitLocal([
      changed(target_, res?.version ?? null),
      ...(res?.relinked ?? []).filter((p) => p !== target_).map((p) => changed(p)),
      { kind: 'deleted', path: source, version: null, origin: CLIENT_ID },
    ])
    return res
  },

  /**
   * Delete a space folder that is not the current one: to the OS trash, or (`permanent`, after a
   * 428 `ConfirmRequiredError` said the trash is unavailable) for good. Pass the 428's `folder`
   * token back as `folder`: the server answers 409 when the folder was replaced in between.
   * 404, 409 the current space.
   */
  deleteSpace(path: string, opts: { permanent?: boolean; folder?: string } = {}): Promise<{ trashed: boolean }> {
    const body: Record<string, unknown> = { path }
    if (opts.permanent) body.permanent = true
    if (opts.folder) body.folder = opts.folder
    return request<{ trashed: boolean }>('/spaces/delete', json('POST', body), spaceConflict)
  },

  // ---- M15 importers (docs/superpowers/plans/2026-11-05-m15-importers.md) ----

  /**
   * Read a Notion export, Obsidian vault or Anytype export (a `.zip` or a folder, by absolute path)
   * into a dry-run preview. Writes nothing. 404 no such file or folder, 415 neither a zip nor a
   * folder, 413 over the limits, 422 a bad mapping.
   */
  importPreview(req: ImportPreviewRequest): Promise<ImportPreview> {
    return request<ImportPreview>('/import/preview', json('POST', req))
  },

  /**
   * Start writing a previewed import (202). 409 (`ApiError`) the new space's folder exists, another
   * import runs or the source changed since the preview; 422 bad name or a target inside the
   * source; 404 unknown or expired preview, or the location is not a folder. No `clientId`: the
   * server announces an import's end as one resync from no window (review finding 2), and the
   * dialog announces it to this window itself (`announceResync`).
   */
  startImport(req: StartImportRequest): Promise<StartImportResponse> {
    return request<StartImportResponse>(
      '/import/start',
      json('POST', req),
      (d) => new ApiError(409, typeof d.detail === 'string' ? d.detail : 'conflict'),
    )
  },

  /** An import job's progress and, once over, its result. 404 unknown job. */
  importJob(jobId: string): Promise<ImportJob> {
    return request<ImportJob>(`/import/jobs/${encodeURIComponent(jobId)}`)
  },

  /** M25: the open space's import batches, newest first. */
  async importBatches(): Promise<ImportBatch[]> {
    const res = await request<{ batches: ImportBatch[] }>('/import/batches')
    return res?.batches ?? []
  },

  /** M25: one batch with its items. 404 unknown. */
  importBatch(batchId: string): Promise<{ batch: ImportBatch; items: ImportBatchItem[] }> {
    return request<{ batch: ImportBatch; items: ImportBatchItem[] }>(`/import/batches/${encodeURIComponent(batchId)}`)
  },

  // ---- M27 the agent workflow: schema proposal, filing pass (trial, normalise) ----

  /** The batch's schema proposal and Gene's review of it (`proposal` is null until an agent writes one). */
  importProposal(batchId: string): Promise<ImportProposalResponse> {
    return request<ImportProposalResponse>(`/import/batches/${seg(batchId)}/proposal`)
  },

  saveProposalReview(batchId: string, items: ProposalReviewItem[]): Promise<{ ok?: boolean }> {
    return request<{ ok?: boolean }>(`/import/batches/${seg(batchId)}/proposal/review`, json('PUT', { items }))
  },

  /** "Apply": creates and extends the accepted types. App only, never an MCP tool. */
  async applyProposal(
    batchId: string,
  ): Promise<{ created: string[]; extended: string[]; skipped?: { id: string; reason: string }[] }> {
    const res = await request<{ created: string[]; extended: string[]; skipped?: { id: string; reason: string }[] }>(
      `/import/batches/${seg(batchId)}/proposal/apply`,
      json('POST', {}),
    )
    announceResync()
    return res
  },

  startFiling(batchId: string, trial: boolean): Promise<{ ok?: boolean }> {
    return request<{ ok?: boolean }>(`/import/batches/${seg(batchId)}/filing/start`, json('POST', { trial }))
  },

  filingStatus(batchId: string): Promise<FilingStatus> {
    return request<FilingStatus>(`/import/batches/${seg(batchId)}/filing`)
  },

  markFiling(batchId: string, path: string, verdict: FilingVerdict): Promise<{ ok?: boolean }> {
    return request<{ ok?: boolean }>(`/import/batches/${seg(batchId)}/filing/mark`, json('POST', { path, verdict }))
  },

  continueFiling(batchId: string): Promise<{ ok?: boolean }> {
    return request<{ ok?: boolean }>(`/import/batches/${seg(batchId)}/filing/continue`, json('POST', {}))
  },

  normaliseFiling(batchId: string, merges: { from: string[]; to: string }[]): Promise<{ ok?: boolean }> {
    return request<{ ok?: boolean }>(`/import/batches/${seg(batchId)}/filing/normalise`, json('POST', { merges }))
  },

  // ---- M30 entity extraction: the Entities step of a batch kept as Sources ----

  /** The batch's entity list with Gene's decisions (computed on read; writes nothing). 404 no batch; 409 not kept as Sources. */
  importEntities(batchId: string): Promise<EntitiesView> {
    return request<EntitiesView>(`/import/batches/${seg(batchId)}/entities`)
  },

  /** Save the whole review; answers the view the server computes from it. 422 an invalid review; 409 written already. */
  saveEntitiesReview(batchId: string, review: EntitiesReview): Promise<{ ok?: boolean; view: EntitiesView }> {
    return request<{ ok?: boolean; view: EntitiesView }>(`/import/batches/${seg(batchId)}/entities/review`, json('PUT', review))
  },

  /** "Write" (202): writes the accepted entities in the filing worker; poll `filingStatus`. App only, never an MCP tool. */
  writeEntities(batchId: string): Promise<{ ok?: boolean }> {
    return request<{ ok?: boolean }>(`/import/batches/${seg(batchId)}/entities/write`, json('POST', {}))
  },

  /** M25 "Move batch to Trash": every object the batch created goes to the Trash (restorable). 409 while an import runs. */
  trashImportBatch(batchId: string): Promise<{ trashed: number; missing: number }> {
    return request<{ trashed: number; missing: number }>(`/import/batches/${encodeURIComponent(batchId)}/trash`, json('POST', {}))
  },

  /** M25 "Take source" / "Keep mine" for a batch's changed-in-both items (all, or the named objects). */
  resolveImportBatch(
    batchId: string,
    action: 'take' | 'keep',
    paths?: string[],
  ): Promise<{ resolved: string[]; failed: string[]; pending: number }> {
    return request<{ resolved: string[]; failed: string[]; pending: number }>(
      `/import/batches/${encodeURIComponent(batchId)}/resolve`,
      json('POST', { action, paths: paths ?? null }),
    )
  },

  /** M25 "Show file": a kept original in the OS file manager. */
  revealImportOriginal(path: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>('/import/original/reveal', json('POST', { path }))
  },

  /** Stop an import after the file being written (what was written stays). */
  cancelImport(jobId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/import/jobs/${encodeURIComponent(jobId)}/cancel`, json('POST', {}))
  },

  // ---- M14: automations (docs/superpowers/plans/2026-11-05-m14-automations.md) ----

  /** Every rule, by name, each with its newest run (`lastRun`). */
  automations(): Promise<AutomationRule[]> {
    return request<AutomationRule[]>('/automations')
  },

  /** One rule. 404. */
  automation(id: string): Promise<AutomationRule> {
    return request<AutomationRule>(`/automations/${seg(id)}`)
  },

  /** Create a rule (201). 422 names the problem (an unknown property, a bad schedule...). */
  async createAutomation(rule: AutomationRuleInput): Promise<AutomationRule> {
    const res = await request<AutomationRule>('/automations', json('POST', { rule, clientId: CLIENT_ID }))
    emitLocal([defEvent('automations', res.id, res.revision ?? null)])
    return res
  },

  /** Save a rule over its file. 409 (`RevisionConflictError`) stale, 422, 423 unreadable, 404. */
  async saveAutomation(rule: AutomationRule, opts: { baseRevision: string }): Promise<{ rule: AutomationRule }> {
    const res = await request<{ rule: AutomationRule }>(
      `/automations/${seg(rule.id)}`,
      json('PUT', { rule, baseRevision: opts.baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([defEvent('automations', res.rule?.id ?? rule.id, res.rule?.revision ?? null)])
    return res
  },

  /** Move a rule to the Trash (restorable; its run log is kept until it is purged). 404, 423. */
  async deleteAutomation(id: string): Promise<{ trashId: string }> {
    const res = await request<{ trashId: string }>(`/automations/${seg(id)}${qs({ clientId: CLIENT_ID })}`, {
      method: 'DELETE',
    })
    emitLocal([defEvent('automations', id)])
    return res
  },

  /**
   * Press a button: run button rule `id` on the object at `path` now, and answer the logged run.
   * Its writes are announced by the server with origin `automation:<id>`. 404, 422 (not a button
   * rule, turned off, or the object is out of its scope), 423.
   */
  runAutomation(id: string, path: string): Promise<AutomationRun> {
    return request<AutomationRun>(`/automations/${seg(id)}/run`, json('POST', { path, clientId: CLIENT_ID }))
  },

  /**
   * "Run now" for a schedule rule: one run outside its schedule. A plain rule's run comes back;
   * an agent schedule's is handed to the agent jobs (`{queued: true}`). 404, 422 (not a schedule,
   * turned off), 423.
   */
  runScheduleNow(id: string): Promise<AutomationRun | { queued: true }> {
    return request<AutomationRun | { queued: true }>(`/automations/${seg(id)}/run-now`, json('POST', {}))
  },

  /** A rule's run log, newest first (at most 200). 404. */
  async automationRuns(id: string, limit?: number): Promise<AutomationRun[]> {
    const res = await request<{ runs: AutomationRun[] }>(
      `/automations/${seg(id)}/runs${qs({ limit: limit === undefined ? undefined : String(limit) })}`,
    )
    return res?.runs ?? []
  },

  /** The schedule runs missed while Object was closed (or the computer slept), per rule. */
  async automationCatchUp(): Promise<AutomationCatchUpItem[]> {
    const res = await request<{ items: AutomationCatchUpItem[] }>('/automations/catch-up')
    return res?.items ?? []
  },

  /** Answer one rule's catch-up: run all missed, only the latest, or none. 404 nothing pending. */
  async confirmAutomationCatchUp(ruleId: string, choice: AutomationCatchUpChoice): Promise<AutomationRun[]> {
    const res = await request<{ runs: AutomationRun[] }>(
      '/automations/catch-up',
      json('POST', { ruleId, choice, clientId: CLIENT_ID }),
    )
    return res?.runs ?? []
  },

  // ---- M17: agents ("Contract (T1)", routes filled by the plan's T7) ----

  /** Every agent: the default agent first, then the registry's order. Never writes. */
  async agents(): Promise<Agent[]> {
    const res = await request<{ agents: Agent[] }>('/agents')
    return res?.agents ?? []
  },

  /** One agent. 404 when it isn't listed. */
  agent(id: string): Promise<Agent> {
    return request<Agent>(`/agents/${seg(id)}`)
  },

  /** Make an agent (blank or a duplicate). 404, 409 (a folder exists at the location), 422. */
  createAgent(req: CreateAgentRequest): Promise<Agent> {
    return request<Agent>('/agents', json('POST', { ...req, clientId: req.clientId ?? CLIENT_ID }), spaceConflict)
  },

  /** Register an existing agent folder; never writes into it. 404, 409 (its id is listed), 422. */
  addAgentFolder(path: string): Promise<Agent> {
    return request<Agent>('/agents/add-folder', json('POST', { path, clientId: CLIENT_ID }), spaceConflict)
  },

  /** Save an agent's fields. Rejects with `RevisionConflictError` (409) or `ReadOnlyError` (423). */
  saveAgent(id: string, input: AgentInput, baseRevision: string | null): Promise<Agent> {
    return request<Agent>(`/agents/${seg(id)}`, json('PUT', { agent: input, baseRevision, clientId: CLIENT_ID }))
  },

  /** Delete an agent: its folder goes to the agent trash; `trashId` null = only unregistered. */
  deleteAgent(id: string): Promise<{ trashId: string | null }> {
    return request<{ trashId: string | null }>(`/agents/${seg(id)}${qs({ clientId: CLIENT_ID })}`, { method: 'DELETE' })
  },

  /** Remove an agent from the list; its folder is left as it is. */
  unregisterAgent(id: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/agents/${seg(id)}/unregister`, json('POST', { clientId: CLIENT_ID }))
  },

  /** The deleted agents, newest first. */
  async agentTrash(): Promise<AgentTrashItem[]> {
    const res = await request<{ items: AgentTrashItem[] }>('/agent-trash')
    return res?.items ?? []
  },

  /** Put a deleted agent's folder back. 404; 409 when its id is listed again. */
  restoreAgent(trashId: string): Promise<Agent> {
    return request<Agent>(`/agent-trash/${seg(trashId)}/restore`, json('POST', { clientId: CLIENT_ID }), spaceConflict)
  },

  /** The agent's CLAUDE.md (`""` and `null` when there is none). */
  agentInstructions(id: string): Promise<{ text: string; revision: string | null }> {
    return request<{ text: string; revision: string | null }>(`/agents/${seg(id)}/instructions`)
  },

  /** Save the agent's CLAUDE.md. Rejects with `RevisionConflictError` (409) or `ReadOnlyError` (423). */
  saveAgentInstructions(id: string, text: string, baseRevision: string | null): Promise<{ revision: string }> {
    return request<{ revision: string }>(
      `/agents/${seg(id)}/instructions`,
      json('PUT', { text, baseRevision, clientId: CLIENT_ID }),
    )
  },

  /** The tool catalogue with its default states (the New agent form). */
  async agentToolDefaults(): Promise<ToolGroup[]> {
    const res = await request<{ groups: ToolGroup[] }>('/agent-tools')
    return res?.groups ?? []
  },

  /** One agent's tool switches, with a group per folder MCP server. */
  async agentTools(id: string): Promise<ToolGroup[]> {
    const res = await request<{ groups: ToolGroup[] }>(`/agents/${seg(id)}/tools`)
    return res?.groups ?? []
  },

  /** One agent's chats, newest first. */
  async agentChats(id: string): Promise<AgentChatSummary[]> {
    const res = await request<{ chats: AgentChatSummary[] }>(`/agents/${seg(id)}/chats`)
    return res?.chats ?? []
  },

  /** One chat's transcript. */
  agentChat(id: string, chatId: string): Promise<AgentTranscript> {
    return request<AgentTranscript>(`/agents/${seg(id)}/chats/${seg(chatId)}`)
  },

  /** Show the agent's folder in the OS file manager. */
  revealAgentFolder(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/agents/${seg(id)}/reveal`, json('POST', {}))
  },

  // ---- M20: remote agents ("Contract (T1)", routes filled by the plan's T5) ----

  /** Fetch a remote agent's Agent Card without adding it. Writes nothing. 422, 502. */
  previewRemoteAgent(url: string, auth: RemoteAuthInput): Promise<RemotePreview> {
    return request<RemotePreview>('/remote-agents/preview', json('POST', { url, auth }))
  },

  /** Add a remote agent (its card is fetched again). 409 when it is already listed, 422, 502. */
  addRemoteAgent(req: AddRemoteAgentRequest): Promise<Agent> {
    return request<Agent>('/remote-agents', json('POST', { ...req, clientId: req.clientId ?? CLIENT_ID }), spaceConflict)
  },

  /** Save a remote agent's name, icon, colour and (when given) auth. Rejects with `RevisionConflictError` (409). */
  saveRemoteAgent(id: string, req: SaveRemoteAgentRequest): Promise<Agent> {
    return request<Agent>(`/remote-agents/${seg(id)}`, json('PUT', { ...req, clientId: req.clientId ?? CLIENT_ID }))
  },

  /** Fetch a remote agent's card again. An endpoint that moved to another host or scheme is not
   * switched to: it comes back as `remote.pendingEndpoint` with a `notice`. 404, 422, 502. */
  refreshRemoteAgent(id: string): Promise<RemoteRefreshResult> {
    return request<RemoteRefreshResult>(`/remote-agents/${seg(id)}/refresh`, json('POST', { clientId: CLIENT_ID }))
  },

  /** Switch a remote agent to its pending (moved) endpoint. 404, 422 (nothing pending). */
  confirmRemoteEndpoint(id: string): Promise<Agent> {
    return request<Agent>(`/remote-agents/${seg(id)}/confirm-endpoint`, json('POST', { clientId: CLIENT_ID }))
  },

  /** Forget a remote agent's pending (moved) endpoint; the stored one stays. 404, 422. */
  dismissRemoteEndpoint(id: string): Promise<Agent> {
    return request<Agent>(`/remote-agents/${seg(id)}/pending-endpoint${qs({ clientId: CLIENT_ID })}`, {
      method: 'DELETE',
    })
  },

  /** Record that Gene confirmed context leaves this computer for this remote agent (once per agent). */
  ackRemoteContext(id: string): Promise<{ contextNoticeAt: string }> {
    return request<{ contextNoticeAt: string }>(
      `/remote-agents/${seg(id)}/context-notice`,
      json('POST', { clientId: CLIENT_ID }),
    )
  },

  /** Show one of an agent's saved files ("<chatId>/<name>" under its files/) in the OS file manager. 404. */
  revealAgentFile(id: string, file: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/agents/${seg(id)}/files/reveal`, json('POST', { file }))
  },

  // ---- M18: learning ("Contract (T1)", routes filled by the plan's T6) ----

  /** The agent's MEMORY.md and USER.md. Never writes. */
  agentMemory(id: string): Promise<{ memory: MemoryFile; user: MemoryFile }> {
    return request<{ memory: MemoryFile; user: MemoryFile }>(`/agents/${seg(id)}/memory`)
  },

  /** Save a whole memory file. Rejects with `RevisionConflictError` (409) or `ReadOnlyError` (423). */
  saveAgentMemory(id: string, target: MemoryFile['target'], text: string, baseRevision: string | null): Promise<MemoryFile> {
    return request<MemoryFile>(
      `/agents/${seg(id)}/memory/${seg(target)}`,
      json('PUT', { text, baseRevision, clientId: CLIENT_ID }),
    )
  },

  /** The agent's skills (active and stale), or with `archived` the archived ones. */
  async agentSkills(id: string, archived?: boolean): Promise<SkillSummary[]> {
    const res = await request<{ skills: SkillSummary[] }>(
      `/agents/${seg(id)}/skills${qs({ archived: archived ? 'true' : undefined })}`,
    )
    return res?.skills ?? []
  },

  /** Write a new skill (`createdBy: 'user'`). 404, 409 (the name is taken), 422. */
  createAgentSkill(id: string, req: { name: string; description: string; body: string }): Promise<SkillDetail> {
    return request<SkillDetail>(`/agents/${seg(id)}/skills`, json('POST', { ...req, clientId: CLIENT_ID }))
  },

  /** One skill with its SKILL.md text and files. */
  agentSkill(id: string, name: string, archived?: boolean): Promise<SkillDetail> {
    return request<SkillDetail>(`/agents/${seg(id)}/skills/${seg(name)}${qs({ archived: archived ? 'true' : undefined })}`)
  },

  /** One file of a skill; `binary` (and `text` null) when it isn't UTF-8. */
  agentSkillFile(
    id: string,
    name: string,
    path: string,
    archived?: boolean,
  ): Promise<{ path: string; text: string | null; revision: string; binary: boolean }> {
    return request<{ path: string; text: string | null; revision: string; binary: boolean }>(
      `/agents/${seg(id)}/skills/${seg(name)}/file${qs({ path, archived: archived ? 'true' : undefined })}`,
    )
  },

  /** Save one file of a skill. Rejects with `ConflictError` (409); 413, 422. */
  saveAgentSkillFile(id: string, name: string, path: string, text: string, baseRevision: string | null): Promise<{ revision: string }> {
    return request<{ revision: string }>(
      `/agents/${seg(id)}/skills/${seg(name)}/file`,
      json('PUT', { path, text, baseRevision, clientId: CLIENT_ID }),
    )
  },

  /** Move a skill to the archive (restorable). */
  archiveAgentSkill(id: string, name: string): Promise<SkillSummary> {
    return request<SkillSummary>(`/agents/${seg(id)}/skills/${seg(name)}/archive`, json('POST', { clientId: CLIENT_ID }))
  },

  /** Bring an archived skill back. 409 when a skill with its name is active. */
  restoreAgentSkill(id: string, name: string): Promise<SkillSummary> {
    return request<SkillSummary>(`/agents/${seg(id)}/skills/${seg(name)}/restore`, json('POST', { clientId: CLIENT_ID }))
  },

  /** Pin or unpin a skill (the curator never touches a pinned one). */
  pinAgentSkill(id: string, name: string, pinned: boolean): Promise<SkillSummary> {
    return request<SkillSummary>(`/agents/${seg(id)}/skills/${seg(name)}/pin`, json('POST', { pinned, clientId: CLIENT_ID }))
  },

  /** The agent's changes, newest first; `more` when older ones exist. */
  async agentLedger(
    id: string,
    query?: { target?: string; skill?: string; run?: string; limit?: number; before?: string },
  ): Promise<{ entries: LedgerSummary[]; more: boolean }> {
    const res = await request<{ entries: LedgerSummary[]; more: boolean }>(
      `/agents/${seg(id)}/ledger${qs({
        target: query?.target,
        skill: query?.skill,
        run: query?.run,
        limit: query?.limit === undefined ? undefined : String(query.limit),
        before: query?.before,
      })}`,
    )
    return { entries: res?.entries ?? [], more: Boolean(res?.more) }
  },

  /** One change with its before and after text. */
  agentLedgerEntry(id: string, entryId: string): Promise<LedgerEntry> {
    return request<LedgerEntry>(`/agents/${seg(id)}/ledger/${seg(entryId)}`)
  },

  /** Undo one change; resolves with the new undo entry. Rejects with `ConflictError` (409) when it changed again since. */
  undoLedgerEntry(id: string, entryId: string): Promise<LedgerSummary> {
    return request<LedgerSummary>(`/agents/${seg(id)}/ledger/${seg(entryId)}/undo`, json('POST', { clientId: CLIENT_ID }))
  },

  /** The agent's learning settings, their defaults and the curator's state. */
  agentLearning(id: string): Promise<LearningState> {
    return request<LearningState>(`/agents/${seg(id)}/learning`)
  },

  /** Save the learning settings. Rejects with `RevisionConflictError` (409) or `ReadOnlyError` (423); 422. */
  saveAgentLearning(id: string, learning: Partial<LearningSettings>, baseRevision: string | null): Promise<LearningState> {
    return request<LearningState>(
      `/agents/${seg(id)}/learning`,
      json('PUT', { learning, baseRevision, clientId: CLIENT_ID }),
    )
  },

  /** "Tidy up now": the curator's consolidation run, once. 409 while one runs; 503 without claude. */
  tidyAgentSkills(id: string): Promise<{ runId: string }> {
    return request<{ runId: string }>(`/agents/${seg(id)}/curator/tidy`, json('POST', { clientId: CLIENT_ID }))
  },

  /** Full-text search over the agent's chats, best first. */
  async searchAgentChats(id: string, q: string): Promise<ChatSearchHit[]> {
    const res = await request<{ hits: ChatSearchHit[] }>(`/agents/${seg(id)}/chats/search${qs({ q })}`)
    return res?.hits ?? []
  },

  /** "Learn from this chat": a review on demand. 409 while one runs for the chat; 422; 503. */
  learnFromChat(id: string, chatId: string): Promise<ReviewStatus> {
    return request<ReviewStatus>(`/agents/${seg(id)}/chats/${seg(chatId)}/learn`, json('POST', { clientId: CLIENT_ID }))
  },

  /** A chat's reviews, oldest first. */
  async chatReviews(id: string, chatId: string): Promise<ReviewStatus[]> {
    const res = await request<{ reviews: ReviewStatus[] }>(`/agents/${seg(id)}/chats/${seg(chatId)}/reviews`)
    return res?.reviews ?? []
  },

  // ---- M19: the MCP gateway ("Contract (T1)", routes filled by the plan's T6) ----
  /** The outside MCP servers (file order) and why the list is read-only, if it is. Never a secret value. */
  mcpServers(): Promise<McpServersAnswer> {
    return request<McpServersAnswer>('/mcp-servers')
  },

  /** Add an MCP server. 409 `ApiError` with the server's message (name taken), 422, 423. */
  createMcpServer(input: McpServerInput): Promise<McpServer> {
    return request<McpServer>('/mcp-servers', json('POST', { server: input, clientId: CLIENT_ID }), spaceConflict)
  },

  /** Save an MCP server. Rejects with `RevisionConflictError` (409) or `ReadOnlyError` (423); 404, 422. */
  saveMcpServer(id: string, input: McpServerInput, baseRevision: string): Promise<McpServer> {
    return request<McpServer>(`/mcp-servers/${seg(id)}`, json('PUT', { server: input, baseRevision, clientId: CLIENT_ID }))
  },

  /** Delete an MCP server and its secrets. 404, 423. */
  deleteMcpServer(id: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/mcp-servers/${seg(id)}${qs({ clientId: CLIENT_ID })}`, { method: 'DELETE' })
  },

  /** "Test": list the server's tools (also for a disabled server). 404; 422 when a secret is missing. */
  testMcpServer(id: string): Promise<McpTestResult> {
    return request<McpTestResult>(`/mcp-servers/${seg(id)}/test`, json('POST', {}))
  },

  /** The secret variables: every one set, plus every `${NAME}` an agent folder's `.mcp.json` uses. */
  async mcpSecrets(): Promise<SecretVar[]> {
    const res = await request<{ vars: SecretVar[] }>('/mcp-secrets')
    return res?.vars ?? []
  },

  /** Set a secret variable; its value is never shown again. 422 (name rule, empty, too long). */
  setMcpSecret(name: string, value: string): Promise<{ name: string; set: true }> {
    return request<{ name: string; set: true }>(`/mcp-secrets/${seg(name)}`, json('PUT', { value, clientId: CLIENT_ID }))
  },

  /** Delete a secret variable. 404. */
  deleteMcpSecret(name: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/mcp-secrets/${seg(name)}${qs({ clientId: CLIENT_ID })}`, { method: 'DELETE' })
  },

  /** List the agent's outside servers' tools again; answers the same groups as `agentTools`. 404. */
  async refreshAgentTools(agentId: string): Promise<ToolGroup[]> {
    const res = await request<{ groups: ToolGroup[] }>(`/agents/${seg(agentId)}/tools/refresh`, json('POST', {}))
    return res?.groups ?? []
  },

  // ---- M22: the work model (every write goes through the server's one work service) ----

  /** The work items: `active` (default) = active items plus the recently done; `all` = every one. */
  async workItems(scope?: 'active' | 'all'): Promise<WorkItemSummary[]> {
    const res = await request<{ items: WorkItemSummary[] }>(`/work/items${qs({ scope })}`)
    return res?.items ?? []
  },

  /** One work item. 404; 422 when the object has no work fields. */
  workItem(path: string): Promise<WorkItem> {
    return request<WorkItem>(`/work/item${qs({ path })}`)
  },

  /**
   * Act on one step (answer, done, approve, decline, run, reopen). A stale `stepRev` rejects with
   * `StepChangedError` (409); a move the rules refuse is an `ApiError` 422 with the reason.
   */
  async workStep(req: WorkStepRequest): Promise<WorkWriteResult> {
    const res = await request<WorkWriteResult>('/work/step', json('POST', { ...req, clientId: CLIENT_ID }), stepChanged)
    emitLocal(workEvents(req.path, res))
    return res
  },

  /** Add, edit, move or remove steps: every op in one write, in order. 409 `StepChangedError`. */
  async workSteps(path: string, ops: StepOp[]): Promise<WorkWriteResult> {
    const res = await request<WorkWriteResult>('/work/steps', json('POST', { path, ops, clientId: CLIENT_ID }), stepChanged)
    emitLocal(workEvents(path, res))
    return res
  },

  /** Set (and `remove`) work and ticket fields with one Activity line. 409 `ConflictError`. */
  async workFields(
    path: string,
    set: Record<string, unknown>,
    remove: string[],
    baseVersion: string,
  ): Promise<WorkWriteResult> {
    const res = await request<WorkWriteResult>(
      '/work/fields',
      json('POST', { path, baseVersion, set, remove, clientId: CLIENT_ID }),
    )
    emitLocal(workEvents(path, res))
    return res
  },

  /** Add a note, or a request for the agent, to Activity and Work notes. */
  async workNote(path: string, kind: 'note' | 'request', text: string): Promise<WorkWriteResult> {
    const res = await request<WorkWriteResult>('/work/note', json('POST', { path, kind, text, clientId: CLIENT_ID }))
    emitLocal(workEvents(path, res))
    return res
  },

  /** Close the item: Object's own done status (Task Done, Project Completed). 409 `ConflictError`. */
  async workClose(path: string, baseVersion: string): Promise<WorkWriteResult> {
    const res = await request<WorkWriteResult>('/work/close', json('POST', { path, baseVersion, clientId: CLIENT_ID }))
    emitLocal(workEvents(path, res))
    return res
  },

  /** Add, edit, collect, un-tick or remove a floor item. A stale `itemRev` rejects with `StepChangedError`. */
  async workFloor(req: WorkFloorRequest): Promise<WorkWriteResult> {
    const res = await request<WorkWriteResult>('/work/floor', json('POST', { ...req, clientId: CLIENT_ID }), stepChanged)
    emitLocal(workEvents(req.path, res))
    return res
  },

  /** "Add work fields" to a type. 409 `RevisionConflictError`; 422 for a basic type. */
  async addWorkFields(typeId: string, baseRevision: string): Promise<AddWorkFieldsResult> {
    const res = await request<AddWorkFieldsResult>(
      `/types/${seg(typeId)}/work-fields`,
      json('POST', { baseRevision, clientId: CLIENT_ID }),
    )
    emitLocal([typesEvent(res.type?.id ?? typeId, res.type?.revision ?? null), defEvent('queries', 'work-tickets')])
    return res
  },

  // ---- M23: the Work section (reads write nothing; item writes stay M22's calls above) ----

  /** The board every Work view is computed from: `active` (default) or `all`. */
  workBoard(scope?: 'active' | 'all'): Promise<WorkBoard> {
    return request<WorkBoard>(`/work/board${qs({ scope })}`)
  },

  /** A day's focus lines (default today); reading never creates the daily note. */
  workFocus(day?: string): Promise<FocusDay> {
    return request<FocusDay>(`/work/focus${qs({ day })}`)
  },

  /**
   * Replace the day's focus lines (only the Focus section's list lines change; the daily note is
   * created when missing). A stale `baseVersion` rejects with `ConflictError` (409).
   */
  async saveWorkFocus(day: string, lines: string[], baseVersion: string | null): Promise<FocusDay> {
    const res = await request<FocusDay>('/work/focus', json('PUT', { day, lines, baseVersion, clientId: CLIENT_ID }))
    if (res?.notePath) {
      emitLocal([baseVersion === null ? created(res.notePath, res.version) : changed(res.notePath, res.version)])
    }
    return res
  },

  /** Today's (or `day`'s) meetings and the current local time. */
  workToday(day?: string): Promise<WorkToday> {
    return request<WorkToday>(`/work/today${qs({ day })}`)
  },

  /** Steps done, items closed and objects changed over the last `days` (1-31, default 14). */
  workWins(days?: number): Promise<WorkWins> {
    return request<WorkWins>(`/work/wins${qs({ days: days === undefined ? undefined : String(days) })}`)
  },

  /** The Alert objects and the monitoring folder's sources. */
  workAlerts(): Promise<WorkAlerts> {
    return request<WorkAlerts>('/work/alerts')
  },

  /** Scan the monitoring folder now (Check now). The watch announces its own writes. */
  scanAlerts(): Promise<{ report: AlertScanReport; alerts: WorkAlerts }> {
    return request<{ report: AlertScanReport; alerts: WorkAlerts }>('/work/alerts/scan', json('POST', { clientId: CLIENT_ID }))
  },

  /** "Add the Alert type" (idempotent: `created` is false when it exists). */
  async ensureAlertType(): Promise<{ type: TypeDef; created: boolean }> {
    const res = await request<{ type: TypeDef; created: boolean }>('/work/alert-type', json('POST', { clientId: CLIENT_ID }))
    if (res?.created) emitLocal([typesEvent(res.type.id, res.type.revision ?? null)])
    return res
  },

  /** The general floor list (floor items no work item owns). */
  generalFloor(): Promise<GeneralFloor> {
    return request<GeneralFloor>('/work/floor/general')
  },

  /** Add, edit, collect, un-tick or remove a general floor item. A stale `itemRev` rejects with `StepChangedError`. */
  async generalFloorOp(req: Omit<WorkFloorRequest, 'path'>): Promise<GeneralFloor> {
    const res = await request<GeneralFloor>('/work/floor/general', json('POST', { ...req, clientId: CLIENT_ID }), stepChanged)
    emitLocal([{ kind: 'work', path: 'floor', version: res?.revision ?? null, origin: CLIENT_ID }])
    return res
  },

  /** The work agent's status and queue (M23: `available: false`, `carrying` from the board). */
  workAgent(): Promise<AgentStatus> {
    return request<AgentStatus>('/work/agent')
  },

  /** "Agent acts on my approvals". 501 `UnavailableError` until M24. */
  async setAgentActs(on: boolean): Promise<AgentStatus> {
    const res = await seamCall(request<AgentStatus>('/work/agent/acts', json('PUT', { on, clientId: CLIENT_ID })))
    emitLocal([{ kind: 'workQueue', path: RESYNC_PATH, version: null, origin: CLIENT_ID }])
    return res
  },

  /** Retry one agent queue entry. 404; 501 `UnavailableError` until M24. */
  async retryAgentEntry(id: string): Promise<AgentStatus> {
    const res = await seamCall(request<AgentStatus>('/work/agent/retry', json('POST', { id, clientId: CLIENT_ID })))
    emitLocal([{ kind: 'workQueue', path: id, version: null, origin: CLIENT_ID }])
    return res
  },

  /** Save a brain dump. 501 `UnavailableError` ("Saving a brain dump comes with M24.") until M24. */
  async workCapture(req: CaptureRequest): Promise<CaptureSummary> {
    const res = await seamCall(
      request<{ capture: CaptureSummary }>('/work/captures', json('POST', { ...req, clientId: CLIENT_ID })),
    )
    if (res?.capture?.path) emitLocal([created(res.capture.path)])
    return res.capture
  },

  /** Saved brain dumps, newest first (M23: none). */
  async workCaptures(status?: 'new' | 'filed' | 'needsYou'): Promise<CaptureSummary[]> {
    const res = await request<{ captures: CaptureSummary[] }>(`/work/captures${qs({ status })}`)
    return res?.captures ?? []
  },

  // ---- M24: the work agent, captures and Desk sync ----

  /** The work agent's settings (Settings > Work). */
  workAgentSettings(): Promise<WorkAgentSettings> {
    return request<WorkAgentSettings>('/work/agent-settings')
  },

  /** Save some of the work agent's settings. 409 `ConflictError` on a stale `baseRevision`; 422 with the server's text. */
  async saveWorkAgentSettings(
    patch: { agentId?: string | null; acts?: boolean; autoRun?: boolean; readTools?: string[] },
    baseRevision: string,
  ): Promise<WorkAgentSettings> {
    const res = await request<WorkAgentSettings>(
      '/work/agent-settings',
      json('PUT', { ...patch, baseRevision, clientId: CLIENT_ID }),
      (d) => new ConflictError(String(d.currentRevision ?? '')),
    )
    emitLocal([{ kind: 'workQueue', path: RESYNC_PATH, version: null, origin: CLIENT_ID }])
    return res
  },

  /** The name "Create the Work agent" will use and the change-reviewer file found, if any. */
  workAgentCreateInfo(): Promise<{ name: string; changeReviewer: string | null }> {
    return request<{ name: string; changeReviewer: string | null }>('/work/agent/create-info')
  },

  /** "Create the Work agent". 409 when a usable one is already set. */
  async createWorkAgent(copyChangeReviewer: boolean): Promise<{ agent: Agent; settings: WorkAgentSettings }> {
    const res = await request<{ agent: Agent; settings: WorkAgentSettings }>(
      '/work/agent/create',
      json('POST', { copyChangeReviewer, clientId: CLIENT_ID }),
    )
    emitLocal([{ kind: 'workQueue', path: RESYNC_PATH, version: null, origin: CLIENT_ID }])
    return res
  },

  /** The work agent's folder servers and enabled gateway servers, with their tools. */
  async workReadTools(): Promise<ReadToolServer[]> {
    const res = await request<{ servers: ReadToolServer[] }>('/work/read-tools')
    return res?.servers ?? []
  },

  /** Brain dumps with their filing state, newest first. */
  async captureItems(status?: 'new' | 'filed' | 'needsYou'): Promise<CaptureItem[]> {
    const res = await request<{ captures: CaptureItem[] }>(`/work/captures${qs({ status })}`)
    return res?.captures ?? []
  },

  /** Reply to a brain dump that needs you: back to New with "Reply: <text>" added. */
  async replyCapture(path: string, version: string, text: string): Promise<CaptureItem> {
    const res = await request<{ capture: CaptureItem }>(
      '/work/captures/reply',
      json('POST', { path, version, text, clientId: CLIENT_ID }),
      (d) => new ConflictError(String(d.currentVersion ?? '')),
    )
    return res.capture
  },

  /** Mark a brain dump filed yourself. */
  async markCaptureFiled(path: string, version: string): Promise<CaptureItem> {
    const res = await request<{ capture: CaptureItem }>(
      '/work/captures/mark-filed',
      json('POST', { path, version, clientId: CLIENT_ID }),
      (d) => new ConflictError(String(d.currentVersion ?? '')),
    )
    return res.capture
  },

  /** Desk sync's schedule and last run. */
  deskSync(): Promise<DeskSyncStatus> {
    return request<DeskSyncStatus>('/work/desk-sync')
  },

  /** Set up Desk sync (off until turned on). 409 when it already is; 422 without a work agent. */
  setUpDeskSync(): Promise<DeskSyncStatus> {
    return request<DeskSyncStatus>('/work/desk-sync/setup', json('POST', { clientId: CLIENT_ID }))
  },

  /** Whether the Object window can open the keep-on-top window. */
  keepOnTopInfo(): Promise<{ window: boolean }> {
    return request<{ window: boolean }>('/work/keep-on-top')
  },

  /** Open the keep-on-top window (`/?mini=work`). 501 `UnavailableError` outside the Object window. */
  async openKeepOnTop(): Promise<void> {
    await seamCall(request<null>('/work/keep-on-top', json('POST', { clientId: CLIENT_ID })))
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
      if (listeners.size === 0 && retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }
  },
}

export type Api = typeof api
