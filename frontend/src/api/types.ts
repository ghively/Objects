// TS mirrors of the back end's JSON: the M2 API contract
// (docs/superpowers/plans/2026-10-23-m2-types-properties.md, "API contract").
// Field names match the Python side exactly.

/** Every property kind, including the system kinds (`entity_*`). */
export type PropertyType =
  | 'text'
  | 'textBlock'
  | 'simpleTableBlock'
  | 'number'
  | 'boolean'
  | 'url'
  | 'datetime'
  | 'datetimeSimple'
  | 'entity'
  | 'label'
  | 'blocks'
  | 'coverImage'
  | 'color'
  | 'entity_title'
  | 'entity_icon'
  | 'entity_description'
  | 'entity_aliases'
  | 'entity_tags'
  | 'entity_type'
  | 'entity_collections'
  | 'entity_createdAt'
  | 'entity_lastUpdated'
  | 'entity_backlinks'

/** @deprecated M1 name; use `PropertyType`. */
export type PropertyKind = PropertyType

export const PROPERTY_TYPES: readonly PropertyType[] = [
  'text',
  'textBlock',
  'simpleTableBlock',
  'number',
  'boolean',
  'url',
  'datetime',
  'datetimeSimple',
  'entity',
  'label',
  'blocks',
  'coverImage',
  'color',
  'entity_title',
  'entity_icon',
  'entity_description',
  'entity_aliases',
  'entity_tags',
  'entity_type',
  'entity_collections',
  'entity_createdAt',
  'entity_lastUpdated',
  'entity_backlinks',
]

/**
 * The kinds a property can be changed to (Object's "Change property type"). Changing the kind
 * creates a new property and keeps the old one (Task 6). A kind is never listed as its own target.
 */
export const KIND_TRANSFORMS: Readonly<Record<PropertyType, readonly PropertyType[]>> = {
  text: ['textBlock', 'url', 'number', 'boolean', 'label'],
  textBlock: ['text', 'url', 'number', 'boolean', 'label'],
  url: ['text', 'textBlock'],
  number: ['text', 'textBlock', 'label'],
  boolean: ['text', 'textBlock'],
  label: ['text', 'textBlock'],
  entity: ['label', 'text', 'textBlock'],
  datetime: ['datetimeSimple', 'text', 'textBlock'],
  datetimeSimple: ['datetime', 'text', 'textBlock'],
  simpleTableBlock: [],
  blocks: [],
  coverImage: [],
  color: [],
  entity_title: [],
  entity_icon: [],
  entity_description: [],
  entity_aliases: [],
  entity_tags: [],
  entity_type: [],
  entity_collections: [],
  entity_createdAt: [],
  entity_lastUpdated: [],
  entity_backlinks: [],
}

/** An icon: an emoji, or any Iconify id (`ph-…`, `vscode-icons-…`) with an optional theme colour. */
export interface Icon {
  type: 'emoji' | 'iconify'
  val: string
  color?: string | null
}

export type Visibility = 'alwaysShow' | 'hideWhenEmpty' | 'hidden'

export type NumberFormatType = 'number' | 'currency' | 'percentage' | 'progress'

export interface NumberFormat {
  type: NumberFormatType
  options: {
    currency?: string
    decimals?: { min?: number; max?: number }
    progress?: { steps: number; color: string }
    separators?: { isGroupingThousands?: boolean; isRadixComma?: boolean }
  }
}

export type Resolution = 'day' | 'time'

export interface DateConstraints {
  resolutionConstraint?: Resolution | null
  resolutionPreference?: Resolution | null
  endTimeSettings?: 'required' | 'notAllowed' | null
  endTimePreference?: boolean | null
  /** ISO timestamp. */
  startTimeDefault?: string | null
  /** ISO timestamp. */
  endTimeDefault?: string | null
  hideDeleteOption?: boolean
  /** The Task `date`: reminders may be set on it (M4). */
  supportsReminders?: boolean
}

export type StatusCategory = 'not-started' | 'in-progress' | 'blocked' | 'done'

export interface LabelOption {
  id: string
  /** At most 100 characters. */
  text: string
  color: string | null
  icon: Icon | null
  statusCategory?: StatusCategory
}

/**
 * A property's kind-specific options. Each kind reads only its own fields:
 * number → `numberFormat`; datetime* → `constraints`, `hideCalendarEvents`;
 * entity → `isArray` (default true), `allowedTypes`, `hasFixedSet`, `fixedSet`, `propertySyncing`;
 * label → `isArray` (default false), `set`, `isStatus`. Unknown keys are kept.
 */
export interface PropertyOptions {
  numberFormat?: NumberFormat
  constraints?: DateConstraints
  hideCalendarEvents?: boolean
  supportsReminders?: boolean
  isArray?: boolean
  allowedTypes?: string[]
  hasFixedSet?: boolean
  fixedSet?: string[]
  propertySyncing?: { propertyIds: string[] }
  set?: LabelOption[]
  isStatus?: boolean
  [extra: string]: unknown
}

export interface PropertyDef {
  id: string
  /** The frontmatter key. Never changes; renaming changes `name` only. */
  key: string
  name: string
  type: PropertyType
  description: string
  icon: Icon | null
  visibility: Visibility
  isNotSearchable?: boolean
  options: PropertyOptions
  [extra: string]: unknown
}

export type ViewDesign = 'indexCard' | 'profile' | 'encyclopedia'
export type TypeFont = 'sans-serif' | 'serif' | 'monospace'

export interface TypeDef {
  schemaVersion: 2
  id: string
  name: string
  pluralName: string
  /** Fixed when the type is created; renaming never moves files. */
  folder: string
  formerNames: string[]
  icon: Icon
  color: string
  description: string
  /** A basic type (Page, Tag, Task, DailyNote, media types): its properties can't be edited. */
  basic: boolean
  propertyDefinitions: PropertyDef[]
  collectionsPropertyPosition: number
  viewDesign: ViewDesign | null
  font: TypeFont
  wideLayoutMode: boolean
  wideCoverImage: boolean
  cropCoverImage: boolean
  templates: { ids: string[]; defaultTemplateId: string | null }
  /** Per-view card settings (store-only in M3 other than the small card). */
  structureViews?: Record<string, unknown>
  defaultViewType?: 'inline' | 'smallCard' | 'wideCard' | 'embed'
  smallCardViewConfig?: SmallCardViewConfig
  /** M4: absent = offered in the calendar's quick-create chips; `createOnce` = once per day. */
  createInCalendarOption?: 'disabled' | 'createOnce'
  /** M4: this type's objects stay out of the calendar's "objects with this date". */
  hideFromCalendarSidebar?: boolean
  /** M4, our key on the DailyNote type: hide the Reviewed flag. */
  hideReviewing?: boolean
  /** API only: set when the type file can't be read. */
  readOnlyReason: string | null
  /** API only: sha256 of the type file, `''` if unsaved. */
  revision: string
  [extra: string]: unknown
}

export interface ObjectSummary {
  path: string
  id: string | null
  type: string
  title: string
  /** `ph-…` (any Iconify id) or an emoji. */
  icon: string | null
  iconColor: string | null
  description: string | null
  aliases: string[]
  createdAt: string | null
  lastUpdated: string | null
  tags: string[]
  /** The template name when this file is a template. */
  template: string | null
  /** Tag objects: `bg-<c>`. */
  color: string | null
  coverImage: string | null
  readOnly: boolean
  /** Why the object opens read-only (absent or null when it can be saved). */
  readOnlyReason?: string | null
  /** Raw names from the `collections:` key; `[]` when absent. */
  collections?: string[]
}

/** GET /api/space */
export interface SpaceInfo {
  name: string
  root: string
  types: TypeDef[]
}

/** GET /api/object?path= */
export interface ObjectDetail {
  summary: ObjectSummary
  frontmatter: Record<string, unknown>
  body: string
  version: string
  /** Each entity property's values resolved from this file (`null` when a link doesn't resolve). */
  links: Record<string, (string | null)[]>
  /** M5: the distinct objects linking to this one, by title then path. */
  backlinks: EntityRef[]
}

/** PUT /api/object/body → 200 */
export interface SaveResult {
  version: string
}

/** A datetime value as the API reads and writes it. */
export interface DateValue {
  start: string
  end?: string | null
  resolution: Resolution
}

/** An entity value: read gives the resolved path; on write `path` wins and `target` is used verbatim when it's null. */
export interface EntityRef {
  target: string
  path: string | null
}

/** A file a cascading rewrite left alone (read-only, or it kept changing on disk). */
export interface SkippedFile {
  path: string
  reason: string
}

/** PUT /api/object/properties */
export interface UpdateResult {
  version: string
  frontmatter: Record<string, unknown>
  links: Record<string, (string | null)[]>
  synced: string[]
  skipped: SkippedFile[]
  /** M4: present only when a Task's status changed category (the status hook ran). */
  task?: TaskResult | null
}

/** POST /api/object/rename and POST /api/object/change-type */
export interface RenameResult {
  path: string
  version: string
  relinked: string[]
  skipped: SkippedFile[]
}

export type ChangeTypeResult = RenameResult

/** GET /api/object/change-type → rows */
export interface MappingRow {
  fromKey: string
  toKey: string | null
  lossy: boolean
}

export interface CreatedFile {
  path: string
  version: string
}

export interface TrashItem {
  id: string
  kind: 'object' | 'type' | 'collection' | 'query'
  originalPath: string
  title: string
  type: string
  deletedAt: string
  typeTrashId?: string | null
  objectCount?: number
  /** Object entries trashed by a collection delete. */
  collectionTrashId?: string | null
  /** Collection and query entries. */
  collectionId?: string
  queryId?: string
  name?: string
}

export interface RestoreResult {
  paths: string[]
  typeIds: string[]
  collectionIds?: string[]
  queryIds?: string[]
  skipped?: SkippedFile[]
  /** Other files the restore wrote back (a collection's members); announced as `changed`. */
  rewritten?: string[]
}

export interface SaveTypeResult {
  type: TypeDef
  rewritten: string[]
  skipped: SkippedFile[]
}

export interface ChangeKindResult extends SaveTypeResult {
  newPropertyId: string
  lossy: number
}

export interface SyncResult {
  types: TypeDef[]
  rewritten: string[]
  skipped: SkippedFile[]
}

export type ChangeKind =
  | 'created'
  | 'changed'
  | 'deleted'
  | 'renamed'
  | 'types'
  | 'collections'
  | 'queries'
  | 'views'
  | 'ui'

/** SSE event `change` on GET /api/events */
export interface ChangeEvent {
  kind: ChangeKind
  /** The file's path; for `renamed` the new path; for `types` the type id. */
  path: string
  version: string | null
  /** For a write made through the API: the writing window's `CLIENT_ID`. */
  origin?: string | null
  /** `renamed` only: the path before the move. */
  oldPath?: string | null
}

// ---------------------------------------------------------------------------------------------
// M3: views, collections, queries (docs/superpowers/plans/2026-10-26-m3-views-collections-queries.md,
// "API contract (M3)").

/** One row of `POST /api/rows`: an object with its decoded values. */
export interface Row {
  summary: ObjectSummary
  version: string
  /** Every key of the type's propertyDefinitions, in the M2 API value form. */
  values: Record<string, unknown>
  /** Entity values' resolved paths. */
  links: Record<string, (string | null)[]>
  /** Plain text of the body, Markdown stripped, at most 280 characters. */
  preview: string
}

export type Layout = 'list' | 'grid' | 'wall' | 'table' | 'embed' | 'kanban' | 'gallery'

export type DateRelative =
  | 'overdue'
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'thisWeek'
  | 'thisMonth'
  | 'thisYear'
  | 'oneWeekAgo'
  | 'inOneWeek'
  | 'oneMonthAgo'
  | 'inOneMonth'

/** text: string, number: number, label: option ids, entity and tags: object ids, entity_type: type ids,
 *  entity_collections: collection ids, dates: relative or exact. */
export type FilterReference = string | number | string[] | { relative: DateRelative } | { exactDate: string }

export interface Filter {
  type: 'filter'
  /** The property key. */
  propertyId: string
  option: string
  referenceValue?: FilterReference
  /** A type id: the filter applies to rows of that type only. */
  structureId?: string
}

export interface FilterGroup {
  type: 'filterGroup'
  operator: 'and' | 'or'
  elements: (Filter | FilterGroup)[]
}

export type SortOption = 'ascending' | 'descending' | 'ascendingExists' | 'descendingExists'

export interface Sort {
  propertyId: string
  option: SortOption
  structureId?: string
}

export type GroupSortOption =
  | 'default'
  | 'defaultDescending'
  | 'ascending'
  | 'descending'
  | 'createdAscending'
  | 'createdDescending'
  | 'sizeAscending'
  | 'sizeDescending'
  | 'manual'

export interface GroupByEntry {
  propertyId: string
  option: string
  structureId?: string
  numberRangeConfig?: { min?: number; max?: number; step?: number }
}

export interface GroupBy {
  groups: GroupByEntry[]
  sortOption?: GroupSortOption
}

export type CalcKind = string

export interface TableColumn {
  id: string
  type: string
  isHidden: boolean
  wrapContent: boolean
  /** rem, 2..50 */
  colWidth: number
  calculation?: CalcKind
}

export interface TableViewConfig {
  wrapAllContent: boolean
  pinnedColumnIndex?: number
  properties: TableColumn[]
}

export interface SmallCardViewConfig {
  entityViewType: 'smallCard'
  /** `propertyId` `'computed_preview'` is the body preview. */
  properties: { propertyType: string; propertyId: string }[]
}

export interface DataViewDefinition {
  dataViewLayout: Layout
  tableConfigs?: Record<string, TableViewConfig>
  groupByConfig?: {
    groups: { id: string; isHidden: boolean; isClosed: boolean }[]
    hideByDefault?: boolean
    hideEmptyGroups?: boolean
  }
  calculations?: { propertyId: string; structureId: string; kind: CalcKind }[]
  smallCardViewConfigs?: Record<string, SmallCardViewConfig>
}

export interface ViewState {
  viewDefinition: DataViewDefinition
  filterGroup: FilterGroup
  sorts: Sort[]
  groupBy: GroupBy | null
  showDataViewDetails?: boolean
}

export type DashboardSectionKey =
  | 'allContent'
  | 'recentlyAccessed'
  | 'collections'
  | 'queries'
  | 'inNoCollection'
  | 'notTagged'
  | 'noBacklinks'
  | 'pinned'
  | 'unreviewed'
  | `query:${string}`
  | `collection:${string}`

export interface DashboardSection {
  key: DashboardSectionKey
  collapsed: boolean
  viewDefinition?: DataViewDefinition
  /** A tab rename (our addition). */
  title?: string
}

export interface Views {
  /** 'overview' | 'all' | a full-view section key */
  activeTab: string
  all: ViewState
  dashboard: { sections: DashboardSection[]; removedSections: string[] }
}

export interface Collection {
  schemaVersion: 1
  id: string
  name: string
  formerNames: string[]
  icon: Icon | null
  color: string | null
  description: string
  typeIds: string[]
  views: Views
  pinned: { ids: string[]; isHidden: boolean }
  templates: { ids: string[]; defaultTemplateId: string | null }
  /** API only. */
  readOnlyReason?: string | null
  /** API only. */
  revision: string
  [extra: string]: unknown
}

export interface QueryDefinition {
  structures: {
    id: string
    collectionIds?: string[]
    excludeCollectionIds?: string[]
    inAnyCollection?: boolean
    inNoCollection?: boolean
  }[]
  excludeStructureIds?: string[]
  tags?: { ids: string[]; operator: 'or' | 'and' }
  excludeTags?: { ids: string[] }
  search?: { searchTerms: { text: string }[]; searchMode: 'auto' | 'fullText' | 'semantic' | 'title' }
  filterGroup: FilterGroup
  sorts: Sort[]
  groupBy: GroupBy | null
  limit?: { size: number; random?: boolean }
}

export interface Query {
  schemaVersion: 1
  id: string
  name: string
  titleIsCustom: boolean
  icon: Icon | null
  description: string
  definition: QueryDefinition
  view: { viewDefinition: DataViewDefinition; showDataViewDetails?: boolean }
  readOnlyReason?: string | null
  revision: string
  [extra: string]: unknown
}

export interface PinRef {
  kind: 'object' | 'type' | 'collection' | 'query'
  id: string
}

/** A custom sidebar section such as "In Progress". */
export interface SidebarSection {
  id: string
  name: string
  icon: Icon | null
  items: PinRef[]
}

export interface UiState {
  pinned: PinRef[]
  sections: SidebarSection[]
  allNotesLayout: 'list' | 'grid' | 'wall' | 'embed'
  /** M4: Calendar preferences. */
  calendar?: CalendarUi
  /** M4: the Tasks page's tab and views. */
  tasks?: TasksUi
  /** M4: the reminder scheduler switch (default on). */
  reminders?: { enabled: boolean }
  /** M5: the graph's filters (`GraphViewCustomization`). */
  graph?: GraphCustomization
  [extra: string]: unknown
}

/** `POST /api/rows` request. */
export interface RowsScope {
  typeIds?: string[]
  collectionIds?: string[]
  paths?: string[]
  search?: { terms: string[]; mode: 'auto' | 'fullText' | 'semantic' | 'title' }
}

export interface DeleteCollectionResult {
  trashId: string
  removedFrom: string[]
  skipped: SkippedFile[]
  /** The sole members moved to the Trash. */
  deleted: string[]
}

export interface SaveCollectionResult {
  collection: Collection
  rewritten: string[]
  skipped: SkippedFile[]
}

// ---------------------------------------------------------------------------------------------
// M4: calendar, daily notes, tasks (docs/superpowers/plans/2026-10-26-m4-calendar-daily-tasks.md,
// "API contract (M4)").

/** The parsed `repeat` text form. */
export interface RepeatRule {
  every: number
  unit: 'day' | 'week' | 'weekday' | 'month' | 'year'
  mode: 'dueDate' | 'completionDate'
  /** YYYY-MM-DD */
  until?: string
}

/** The parsed `remind` text form. */
export interface ReminderRule {
  minutesBefore: number
  daysBefore: number
  /** HH:mm */
  timeOfDay?: string
}

/** One task on a calendar day. `day` is the date this entry stands for. */
export interface TaskEntry {
  path: string
  kind: 'date' | 'deadline' | 'occurrence' | 'overdue'
  /** YYYY-MM-DD */
  day: string
  done: boolean
}

/** An object whose date property covers a calendar day. */
export interface DatedEntry {
  path: string
  /** The date property's key. */
  key: string
  start: string
  end?: string | null
  resolution: Resolution
}

export interface CalendarDay {
  dailyNote: { path: string; reviewed: boolean } | null
  tasks: TaskEntry[]
  dated: DatedEntry[]
  created: string[]
  updated: string[]
}

/** GET /api/calendar?from=&to= (at most 100 days). */
export interface CalendarRange {
  /** YYYY-MM-DD, inclusive. */
  from: string
  /** YYYY-MM-DD, inclusive. */
  to: string
  /** The server's local day. */
  today: string
  days: Record<string, CalendarDay>
  summaries: Record<string, ObjectSummary>
  /** Days claimed by more than one daily note: the first by path wins, the others are listed. */
  warnings: { day: string; paths: string[] }[]
}

/** On `UpdateResult`, only when a Task's status changed category. */
export interface TaskResult {
  completed: boolean
  advanced: boolean
  /** The new date after a recurring advance. */
  date?: DateValue
}

export interface CalendarUi {
  weekStart: 'sunday' | 'monday'
  daily: {
    hideDailyNote?: boolean
    hideTasks?: boolean
    hideDated?: boolean
    hideCreatedOnDay?: boolean
    hideUpdated?: boolean
    hideCreateObjects?: boolean
    tasksView?: ViewState
    createdView?: ViewState
    updatedView?: ViewState
    datedView?: ViewState
  }
}

export type TaskSectionKey =
  | 'status'
  | 'today'
  | 'inbox'
  | 'open'
  | 'deadline'
  | 'scheduled'
  | 'recurring'
  | 'reminders'
  | 'tags'
  | 'source'
  | 'completed'

export interface TasksUi {
  activeTab: TaskSectionKey
  views: Partial<Record<TaskSectionKey, ViewState>>
}

/** POST /api/daily-notes → 201 */
export interface CreatedDailyNote {
  path: string
  version: string
  /** The inferred DailyNote type when this write saved its JSON first. */
  typeIds: string[]
}

// ---- M5: search, references, graph ----

/** Where a search hit matched; each snippet wraps its matches in U+0002 … U+0003. */
export interface SearchHighlight {
  field: 'title' | 'aliases' | 'description' | 'properties' | 'blocksContent' | 'tags'
  snippets: string[]
}

export interface SearchResult {
  path: string
  title: string
  /** The type id. */
  type: string
  icon: Icon | null
  tags: string[]
  score: number
  /** `[start, end)` spans of the title the query matched. */
  titleMatches: [number, number][]
  highlights: SearchHighlight[]
}

/** GET /api/search → 200. `partial` until the start-up sync has finished. */
export interface SearchResponse {
  results: SearchResult[]
  partial: boolean
}

/** A block of text around a link; `start`/`end` are the link's span inside `context`. */
export interface BodyContext {
  context: string
  start: number
  end: number
}

export interface BacklinkEntry {
  path: string
  contexts: BodyContext[]
  /** The keys of the properties that link. */
  properties: string[]
}

/** An unlinked mention: `start`/`end` are offsets in the mentioning object's body. */
export interface Occurrence {
  start: number
  end: number
  text: string
  context: string
  /** Offset of `context` in the body. */
  contextStart: number
}

export interface MentionEntry {
  path: string
  version: string
  occurrences: Occurrence[]
}

export interface RelatedEntry {
  path: string
  score: number
}

export interface RelatedTagEntry {
  name: string
  path: string | null
  count: number
}

/** `ReferencesSectionTab` ids, in order. */
export type ReferencesTab = 'all' | 'backlinks' | 'related' | 'mentions' | 'relatedTags'

/** GET /api/references → 200 */
export interface References {
  tabs: ReferencesTab[]
  backlinks: BacklinkEntry[]
  mentions: MentionEntry[]
  related: RelatedEntry[]
  relatedTags: RelatedTagEntry[]
  summaries: Record<string, ObjectSummary>
}

export interface GraphNode {
  path: string
  title: string
  type: string
  icon: Icon | null
  degree: number
  tag: boolean
  daily: boolean
  done: boolean
}

/** GET /api/graph → 200. `links` and `tagged` are flat pairs of node indexes. */
export interface GraphData {
  nodes: GraphNode[]
  /** `[a0, b0, a1, b1, …]`, a < b, each pair once. */
  links: number[]
  /** `[object0, tag0, …]`. */
  tagged: number[]
}

/** `GraphViewCustomization` (RootSpace.model.ts), keys verbatim. */
export interface GraphCustomization {
  filterStructureIds?: string[]
  excludeStructureIds?: string[]
  showCompletedTasks?: boolean
  showMinimalNodes?: boolean
  hideLargeNodes?: boolean
  hideDates?: boolean
  hideIndirectLinks?: boolean
  showTagsNetwork?: boolean
  showSpaceTagsNetwork?: boolean
}
