import type { WhiteboardSettings } from './whiteboardTypes'

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
  /** M14: runs an automation on its object; holds no value (`options.ruleId`). */
  | 'button'

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
  'button',
]

/**
 * The kinds a property can be changed to ("Change property type"). Changing the kind
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
  button: [],
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
  /** M14 `button`: the id of the automation the button runs (`null`: none chosen yet). */
  ruleId?: string | null
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
  /** Polish item 20, our key: the "Default list view", the layout a type page with no saved
   *  views opens in. Absent: the built-in default. */
  defaultDataViewLayout?: Layout
  /** API only: set when the type file can't be read. */
  readOnlyReason: string | null
  /** API only: sha256 of the type file, `''` if unsaved. */
  revision: string
  [extra: string]: unknown
}

/** One template of the "Add new object type" gallery (`GET /api/type-gallery`, item 21). */
export interface TypeTemplate {
  key: string
  section: 'useCases' | 'research' | 'media' | 'planningAndReflection' | null
  name: string
  pluralName: string
  description: string
  icon: Icon
  color: string
  properties: { name: string; type: PropertyType }[]
  /** The space already has a type made from (or named like) it. */
  added: boolean
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
  /** `.object/space.json`'s `name`, else the folder name. */
  name: string
  root: string
  types: TypeDef[]
  /**
   * M7: `space.json` keys (null / false when absent). The server always sends these four;
   * they are optional here only so M1–M6 test fixtures that build a three-field `SpaceInfo`
   * still type-check. Read them as `icon ?? null`, `hideTaskManagement ?? false`, `revision ?? ''`.
   */
  icon?: string | null
  description?: string | null
  hideTaskManagement?: boolean
  /** M7: the revision of `space.json` (`''` when the file is absent). */
  revision?: string
}

/** M7 `PUT /api/space` patch: only these keys are written to `space.json`. */
export interface SpacePatch {
  name?: string
  icon?: string | null
  description?: string | null
  hideTaskManagement?: boolean
}

/** M7: the kind of an attachment file (Task 2's `media.py` kinds). */
export type AttachmentKind = 'image' | 'pdf' | 'audio' | 'video' | 'file'

/** M7 `GET /api/attachments` entry. */
export interface Attachment {
  path: string
  kind: AttachmentKind
  size: number
}

/** M7 `POST /api/attachments` → 201. */
export interface UploadedAttachment {
  path: string
  kind: AttachmentKind
}

export type OpenOnStartMode = 'lastOpenedPage' | 'today' | 'calendar' | 'specificObject'

/** M7: per-device settings (`<state dir>/settings.json`, defaults merged by the server). */
export interface DeviceSettings {
  themeMode: 'light' | 'dark'
  lightTheme: 'light' | 'lightDimmed'
  darkTheme: 'dark' | 'darkDimmed'
  font: 'sans-serif' | 'serif' | 'monospace'
  monochromeTags: boolean
  monochromeTypeLabels: boolean
  toggleStyle: 'toggle' | 'bullet'
  disableNumberedListTransformation: boolean
  disableSpellcheck: boolean
  alwaysOpenAsFullPage: boolean
  hideEntityIconsOnInlineLinks: boolean
  hideOutlinerLines: boolean
  twentyFourHourTime: boolean
  dateFormatting: 'localized' | 'DMY' | 'MDY' | 'YMD'
  /** Keyed by space root; a missing entry means `lastOpenedPage`. */
  openOnStart: { [spaceRoot: string]: { mode: OpenOnStartMode; path?: string } }
  startupSpace: 'lastOpened' | 'specific'
  startupSpacePath: string | null
  // ---- M8 (plan "API contract (M8)") ----
  /** Sets the formatting locale only; the interface stays English. */
  language: SettingsLanguage
  /** `automatic` follows the language. */
  decimalSeparator: 'automatic' | 'dot' | 'comma'
  /** IANA zone name; `null` = the device's zone. */
  timeZone: string | null
  backlinkSectionsDefault: { backlinks: Tri; relatedContent: Tri; unlinkedMentions: Tri }
  backlinkContentView: 'inline' | 'smallCard' | 'wideCard' | 'embed'
  /** Type ids whose objects related content leaves out. */
  relatedContentHiddenTypes: string[]
  nestedBacklinkView: 'showBlockContainingBacklink' | 'showFullPathAbove'
  presentation: PresentationSettings
  // ---- Polish 2026-11-03 ----
  /** Text size: the desktop zoom factor, 0.6–1.5 (`settings/zoom.ts`). */
  zoom: number
  /** Spellcheck language tag ("en-GB"); `null` = the device's. Sets `<html lang>`. */
  spellCheckLang: string | null
  /** `@` at the start of an empty block makes an inline link, not an object block. */
  alwaysCreateInlineLinks: boolean
  /** Hide the type-settings and property-editing entry points outside Settings. */
  hideStructureSettings: boolean
  /** How highlight blocks show (none exist in Object yet; stored only). */
  highlightStyle: 'default' | 'minimal'
}

/** M8 `DeviceSettings.language`. */
export type SettingsLanguage = 'en' | 'en-gb' | 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pt-br' | 'hu'

/** M8 backlink section default: open, closed or hidden. */
export type Tri = 'open' | 'closed' | 'hidden'

/** M8 `DeviceSettings.presentation`. */
export interface PresentationSettings {
  hideCoverImage: boolean
  hideProgressIndicator: boolean
  hideTitle: boolean
  footerLeft: string
  footerRight: string
}

/** M7 `GET`/`PUT /api/settings` → 200. */
export interface SettingsResponse {
  settings: DeviceSettings
  revision: string
}

/** M7 `GET /api/spaces` entry (registry order; the current space is always listed). */
export interface SpaceEntry {
  path: string
  name: string
  icon: string | null
  current: boolean
  /** The folder no longer exists. */
  missing: boolean
  lastOpened: string | null
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
  kind: 'object' | 'type' | 'collection' | 'query' | 'automation'
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
  /** M14 automation entries. */
  automationId?: string
  name?: string
}

export interface RestoreResult {
  paths: string[]
  typeIds: string[]
  collectionIds?: string[]
  queryIds?: string[]
  /** M14: restored automation rules. */
  automationIds?: string[]
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
  /** M6: a whiteboard's canvas or ink file changed; `path` is the board's `.md`. */
  | 'whiteboard'
  /** M14: an automation rule file changed; `path` is the rule id (`*`: resync). */
  | 'automations'
  /** M14: a run was logged (`path` the rule id), or (`path` `catch-up`) the catch-up list changed. */
  | 'automationRuns'

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
  /** Words in the body (the table's "Content" column); absent from an older server. */
  words?: number
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
  /** M5: the graph's filters. */
  graph?: GraphCustomization
  /** M6: the whiteboard "Canvas display" settings (user-level names). */
  whiteboard?: WhiteboardSettings
  /** M9: the sidebar's top-level section order: 'objects', 'pinned', section ids. */
  workspaceOrder?: string[]
  /** The sidebar's Object Types sort; unset sorts alphabetically. */
  objectsSectionSortOption?: 'alphabetical' | 'manual'
  /** The `objects` section's `ids` are the manual Object Types order (type ids, 'queries'). */
  workspace?: { objects?: { ids?: string[] } }
  [extra: string]: unknown
}

/**
 * M9: the per-object layout keys in an object's frontmatter (`wideLayoutMode`,
 * `wideCoverImage`, `coverImageOffset`). Absent means the type's default (offset 50); `null`
 * in a write removes the key.
 */
export interface ObjectFrontmatterLayout {
  wideLayoutMode?: boolean | null
  wideCoverImage?: boolean | null
  /** The cover's y position in percent, 0–100. */
  coverImageOffset?: number | null
}

/** M9: `POST /api/object/duplicate` response. */
export interface DuplicatedObject {
  path: string
  version: string
  summary: ObjectSummary
}

/** `POST /api/rows` request. */
export interface RowsScope {
  typeIds?: string[]
  collectionIds?: string[]
  paths?: string[]
  search?: { terms: string[]; mode: 'auto' | 'fullText' | 'semantic' | 'title' }
  /** False leaves `Row.preview` empty; a view fetches the visible rows' previews after. */
  preview?: boolean
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
  /** M8: a custom rule's anchor (by due date only). */
  on?: RepeatOn
}

/** M8 weekday names in the `repeat` text form. */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/** M8: the `on` part of a custom repeat rule. */
export type RepeatOn =
  | { weekdays?: Weekday[] }
  | { monthDay: number | 'last'; month?: number }
  | { weekdayPos: 1 | 2 | 3 | 4 | 'last'; weekday: Weekday; month?: number }

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
  /** M8 (Task 15): objects linking to the day. Optional: read with `?? []`. */
  backlinks?: string[]
  /** M8 (Task 15): objects holding date tokens for the day. */
  references?: { path: string; count: number }[]
  /** M8 (Task 15): the day's timed items. */
  timeline?: CalendarTimelineItem[]
}

/** M8: one Timeline item; `at` a UTC instant, `key` the date property of a `dated` item. */
export interface CalendarTimelineItem {
  path: string
  at: string
  kind: 'created' | 'dated' | 'task'
  key?: string
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
  /** M7: the calendar's right sidebar is closed. */
  hideCalendarSidebar?: boolean
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
  | 'all'

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
  /** M8 (Task 18): the parent blocks' first lines, outermost first. */
  ancestors?: string[]
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
  /** One per `links` pair: 1 = a links to b, 2 = b links to a, 3 = both. Absent: both. */
  linkDirs?: number[]
  /** `[object0, tag0, …]`. */
  tagged: number[]
}

/** The graph's filters, keys as stored in `ui.json`. */
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

// ---------------------------------------------------------------------------------------------
// M8: deferred features (docs/superpowers/plans/2026-10-27-m8-deferred-features.md,
// "API contract (M8)").

export type OccurrenceAction = 'complete' | 'skip' | 'excuse'
export type CatchUp = 'advanceOne' | 'catchUpBeforeNow' | 'catchUpThroughNow'

export interface OccurrenceLogEntry {
  scheduled: DateValue
  action: 'completed' | 'skipped' | 'excused'
  /** UTC ISO instant. */
  at: string
}

/** GET /api/tasks/overdue */
export interface OverdueInfo {
  count: number
  capped: boolean
  /** Scheduled days or instants, oldest first, at most 99. */
  missed: string[]
  current: DateValue | null
  today: string
}

export type TaskStatsCellState = 'completed' | 'excused' | 'skipped' | 'missed' | 'future' | 'none'

/** GET /api/tasks/stats */
export interface TaskStats {
  unit: 'day' | 'week' | 'month' | 'year'
  currentStreak: number
  bestStreak: number
  completions: number
  completionRate: number | null
  atRisk: boolean
  cells: { scheduled: string; state: TaskStatsCellState }[]
}

/** GET /api/block */
export interface BlockInfo {
  path: string
  id: string
  markdown: string
  version: string
}

/** GET /api/history entry. */
export interface VersionInfo {
  id: string
  number: number
  at: string
  size: number
  kind: 'object' | 'whiteboard'
  title: string | null
}

/** GET /api/history/version */
export interface VersionContent {
  id: string
  /** null for whiteboards. */
  text: string | null
}

/** POST /api/history/restore: `version` for objects, `revision` for boards. */
export interface RestoreVersionResult {
  version?: string
  revision?: string
}

/** POST /api/object/merge */
export interface MergeResult {
  target: string
  version: string
  relinked: string[]
  skipped: SkippedFile[]
  dropped: string[]
  trashId: string
}

export type SpaceSetup = 'blank' | 'basic'

// ---------------------------------------------------------------------------------------------
// M14: local automations (docs/superpowers/plans/2026-11-05-m14-automations.md, "Contract (T1)").
// One rule per `.object/automations/<id>.json`; the back end's `automations_model.py` is the twin.

/** The objects a trigger watches: one type's, or one collection's. */
export interface AutomationScope {
  kind: 'type' | 'collection'
  id: string
}

/** An object is created in the scope (for a collection scope: also added to it by a write). */
export interface ObjectCreatedTrigger {
  kind: 'objectCreated'
  scope: AutomationScope
}

/**
 * `propertyKey` changes on an object in the scope: to any value (`to` null), or into matching
 * `to` (a filter on the same key; it didn't match before the write and does after).
 */
export interface PropertyChangedTrigger {
  kind: 'propertyChanged'
  scope: AutomationScope
  propertyKey: string
  to: Filter | null
}

/**
 * Runs at `time` (`HH:mm`, the space's time zone) on `start` (`YYYY-MM-DD`) and on every later
 * day the M8 repeat text reaches from it (`tasks/repeat.ts` `parseRepeat`; by due date only, so
 * never "after completion"). The server stores `repeat` in canonical form (`formatRepeat`).
 */
export interface ScheduleTrigger {
  kind: 'schedule'
  repeat: string
  time: string
  start: string
}

/** Run by hand on one object: a button block or a Button property. `scope` null: any object. */
export interface ButtonTrigger {
  kind: 'button'
  scope: AutomationScope | null
}

export type AutomationTrigger = ObjectCreatedTrigger | PropertyChangedTrigger | ScheduleTrigger | ButtonTrigger
export type AutomationTriggerKind = AutomationTrigger['kind']

/**
 * Set `key` to `value` (the `PUT /api/object/properties` value form), or with `now` to the run's
 * instant (date properties only; `value` is then null).
 */
export interface SetPropertyAction {
  kind: 'setProperty'
  key: string
  value: unknown
  now?: boolean
}
export interface ClearPropertyAction {
  kind: 'clearProperty'
  key: string
}
/** A Tag object, by its frontmatter `id`. */
export interface AddTagAction {
  kind: 'addTag'
  tagId: string
}
export interface RemoveTagAction {
  kind: 'removeTag'
  tagId: string
}
export interface AddToCollectionAction {
  kind: 'addToCollection'
  collectionId: string
}
export interface RemoveFromCollectionAction {
  kind: 'removeFromCollection'
  collectionId: string
}
/**
 * Create an object of `typeId`: `templateId` null applies the type's default template, `'none'`
 * none. `title` takes placeholders (empty: the template's title). `relateVia`: a relation
 * property key of the new object's type, set to the triggering object (null: not related).
 */
export interface CreateFromTemplateAction {
  kind: 'createFromTemplate'
  typeId: string
  templateId: string | null
  title: string
  relateVia: string | null
}
/** Append `text` (placeholders expanded, may be several lines) to the run day's daily note. */
export interface AppendToDailyNoteAction {
  kind: 'appendToDailyNote'
  text: string
}
/** A local notification; placeholders expanded. An empty title shows the rule's name. */
export interface NotifyAction {
  kind: 'notify'
  title: string
  body: string
}

export type AutomationAction =
  | SetPropertyAction
  | ClearPropertyAction
  | AddTagAction
  | RemoveTagAction
  | AddToCollectionAction
  | RemoveFromCollectionAction
  | CreateFromTemplateAction
  | AppendToDailyNoteAction
  | NotifyAction
export type AutomationActionKind = AutomationAction['kind']

/** The actions that edit the triggering object (not offered on a schedule). */
export const OBJECT_ACTION_KINDS: readonly AutomationActionKind[] = [
  'setProperty',
  'clearProperty',
  'addTag',
  'removeTag',
  'addToCollection',
  'removeFromCollection',
]

export type AutomationRunStatus = 'ok' | 'failed' | 'skipped'

/** One run in a rule's log (`<state dir>`, the newest 200 per rule). */
export interface AutomationRun {
  /** A ULID. */
  id: string
  ruleId: string
  /** ISO UTC instant the run started. */
  at: string
  trigger: {
    kind: AutomationTriggerKind
    /** The triggering object (null for a schedule). */
    path: string | null
    /** A schedule run: the occurrence's ISO UTC instant. */
    scheduledFor: string | null
    /** Run from the catch-up dialog. */
    catchUp: boolean
  }
  /** `skipped`: the object didn't meet the conditions (logged for button presses only). */
  status: AutomationRunStatus
  actions: {
    /** The action's index in the rule. */
    index: number
    kind: AutomationActionKind
    status: AutomationRunStatus
    /** The object the action wrote or created. */
    path: string | null
    /** Why it failed or was skipped. */
    detail: string | null
  }[]
  error: string | null
}

export interface AutomationRule {
  schemaVersion: 1
  /** API only: the file name (a ULID). */
  id: string
  /** At most 100 characters. */
  name: string
  description: string
  enabled: boolean
  trigger: AutomationTrigger
  /** The view filter group; empty passes. Always empty on a schedule. */
  conditions: FilterGroup
  /** 1 to 20, run in order (the object edits as one write, first). */
  actions: AutomationAction[]
  /** Set on the rule a template's "Repeat" made (one per template). */
  templateRepeat: { typeId: string; templateId: string } | null
  /** ISO UTC; set by the server on create. */
  createdAt: string | null
  /** API only: sha256 of the file. */
  revision: string
  /** API only: set when the file can't be read or has an unknown kind; such a rule never runs. */
  readOnlyReason: string | null
  /** API only: the newest logged run. */
  lastRun: AutomationRun | null
  [extra: string]: unknown
}

/** What `POST /api/automations` takes (the server sets the rest). */
export type AutomationRuleInput = Pick<
  AutomationRule,
  'name' | 'description' | 'enabled' | 'trigger' | 'conditions' | 'actions' | 'templateRepeat'
> & { [extra: string]: unknown }

/** GET /api/automations/catch-up entry: a schedule's runs missed while Object was closed. */
export interface AutomationCatchUpItem {
  ruleId: string
  /** The rule's name; for a template's repeat, the template's name. */
  name: string
  /** ISO UTC occurrence instants, oldest first, at most 50 (the newest ones). */
  missed: string[]
  count: number
  /** More than 50 were missed. */
  capped: boolean
  /** The rule creates objects (the dialog says "Create" rather than "Run"). */
  createsObjects: boolean
}

export type AutomationCatchUpChoice = 'all' | 'latest' | 'skip'
