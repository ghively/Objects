import type { WhiteboardSettings } from './whiteboardTypes'

// TS mirrors of the back end's JSON: the M2 API contract
// (docs/superpowers/plans/2026-10-23-m2-types-properties.md, "API contract").
// Field names match the Python side exactly.

/**
 * Every property kind, by family. Each id is the `type` written in a type's `.object/types/*.json`
 * and sent by the API, so ids never change.
 */
const PROPERTY_KIND_FAMILIES = {
  /** One plain value. `email`, `phone` and `color` are M12's. */
  value: ['text', 'number', 'boolean', 'url', 'email', 'phone', 'color'],
  /** Dates: `datetime`, and `datetimeSimple` (the kind the Task date fields use). */
  date: ['datetime', 'datetimeSimple'],
  /** Choices and references: label options, linked objects, attached files (M12). */
  choice: ['label', 'entity', 'files'],
  /** Rich content stored in the body: blocks, a text block, a simple table, the cover image. */
  content: ['blocks', 'textBlock', 'simpleTableBlock', 'coverImage'],
  /** Worked out, not typed in: M12's formula, rollup and unique id; M14's button (runs an automation, `options.ruleId`). */
  computed: ['formula', 'rollup', 'uniqueId', 'button'],
  /** M22: a work item's steps, a list of short texts and its floor items. */
  work: ['steps', 'textList', 'floorItems'],
  /** The fields every object has (`entity_*`). */
  system: [
    'entity_title',
    'entity_type',
    'entity_icon',
    'entity_description',
    'entity_tags',
    'entity_aliases',
    'entity_collections',
    'entity_backlinks',
    'entity_createdAt',
    'entity_lastUpdated',
  ],
} as const

export type PropertyType = (typeof PROPERTY_KIND_FAMILIES)[keyof typeof PROPERTY_KIND_FAMILIES][number]

/** @deprecated M1 name; use `PropertyType`. */
export type PropertyKind = PropertyType

export const PROPERTY_TYPES: readonly PropertyType[] = Object.values(PROPERTY_KIND_FAMILIES).flat()

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
  formula: [],
  rollup: [],
  uniqueId: [],
  email: [],
  phone: [],
  files: [],
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
  // M22: none is a source or target of "Change property type".
  steps: [],
  textList: [],
  floorItems: [],
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
  /** M12 formula: the expression (at most 2000 characters). */
  expression?: string
  /** M12 rollup: the `entity` property of this type whose related objects are rolled up. */
  relationId?: string
  /** M12 rollup: the property (id) of the related objects, or `title`. */
  targetId?: string
  /** M12 rollup: the calculation. */
  calc?: RollupCalc
  /** M12 ID: the text before the number (`TASK-`). */
  prefix?: string
  /** M12 ID: the number the next created object gets. The server never lets it go back. */
  nextNumber?: number
  [extra: string]: unknown
}

/** M12: a rollup's calculation (the `views/calc.ts` names, plus show original/unique). */
export type RollupCalc =
  | 'showOriginal'
  | 'showUnique'
  | 'countAll'
  | 'countValues'
  | 'countUnique'
  | 'countEmpty'
  | 'countNotEmpty'
  | 'percentEmpty'
  | 'percentNotEmpty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'earliestDate'
  | 'latestDate'
  | 'dateRange'

export const ROLLUP_CALCS: readonly RollupCalc[] = [
  'showOriginal',
  'showUnique',
  'countAll',
  'countValues',
  'countUnique',
  'countEmpty',
  'countNotEmpty',
  'percentEmpty',
  'percentNotEmpty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'earliestDate',
  'latestDate',
  'dateRange',
]

/** M12: the result type of a formula or rollup value. */
export type ComputedType = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'empty' | 'error'

/**
 * M12: a formula or rollup value, computed by the server per request and never stored.
 * `value` is a string (text), a finite number, a boolean, an ISO date (`YYYY-MM-DD`) or instant
 * (date), a string list (list) or `null` (empty, error).
 */
export interface ComputedValue {
  type: ComputedType
  value: string | number | boolean | string[] | null
  /** Only for `error`: what went wrong (shown on hover). */
  error?: string
}

/** M12: the property kinds whose values the server computes (never in frontmatter). */
export const COMPUTED_KINDS: ReadonlySet<PropertyType> = new Set<PropertyType>(['formula', 'rollup'])

/** M12: POST /api/formula/preview */
export interface FormulaPreviewRequest {
  typeId: string
  expression: string
  /** The object to evaluate against; without it the expression is only parsed. */
  path?: string | null
  /** The type's definitions as the editor has them (unsaved), replacing the stored ones. */
  properties?: PropertyDef[]
}

export interface FormulaPreviewResult {
  value: ComputedValue | null
  /** A parse or evaluation error. */
  error: string | null
}

/** M12: POST /api/types/{typeId}/properties/{pid}/number-existing */
export interface NumberExistingResult {
  type: TypeDef
  numbered: number
  rewritten: string[]
  skipped: string[]
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
  typeViews?: Record<string, unknown>
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

/** GET /api/app: the app's version (`"dev"` when the package is not installed). */
export interface AppInfo {
  version: string
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
  /** M22: the Jira site the browse links use (`https://…`), or null. Optional, as M7's keys are. */
  jiraSite?: string | null
  /**
   * Fix pass H2: a new or empty folder that was never asked "Pick a starting point" (no `setup`
   * in `space.json`, no basic types, no files). Optional, as M7's keys are.
   */
  needsSetup?: boolean
}

/** M7 `PUT /api/space` patch: only these keys are written to `space.json`. */
export interface SpacePatch {
  name?: string
  icon?: string | null
  description?: string | null
  hideTaskManagement?: boolean
  /** M22: `null` or an `http(s)://` address of at most 300 characters. */
  jiraSite?: string | null
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
  /** Whether the left sidebar is shown when Object opens (2026-11-09). */
  showSidebarOnStart: boolean
  /** Whether an object opens with its properties panel shown; off: only objects saved with
   *  `hideProperties: false` show it (2026-11-09). */
  showPropertiesByDefault: boolean
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
  hideTypeSettings: boolean
  /** How highlight blocks show (none exist in Object yet; stored only). */
  highlightStyle: 'default' | 'minimal'
  // ---- M10 (AI assistant) ----
  /** "Hide AI features": removes every AI entry from the app. */
  aiHidden: boolean
  /** Where the Claude Code CLI is; `null` = found on PATH. */
  claudePath: string | null
  /** The model passed to `claude --model`; `null` = Claude Code's default. */
  aiModel: string | null
  // ---- M22 (the work model) ----
  /** "Your name in Activity": who the Activity and Work notes lines name (1-60 characters). */
  activityName: string
  // ---- M23 (the Work section) ----
  /** The monitoring folder the folder watch reads (an absolute path, at most 500 characters); `null` = off. */
  workAlertFolder: string | null
  /** Per-source staleness intervals, whole minutes 1-10080 (at most 50 sources). */
  workAlertIntervals: Record<string, number>
  // ---- M24 (the work agent) ----
  /** The work agent (an M17 agent id); `null` = none yet. */
  workAgentId: string | null
  /** "Agent acts on my approvals". */
  workAgentActs: boolean
  /** "Agent runs by itself". */
  workAutoRun: boolean
  /** MCP tools (`mcp__<server>__<tool>`) a read-only run may use (at most 500). */
  workReadTools: string[]
  // ---- Import (2026-11-09) ----
  /** The languages the import's OCR reads: Tesseract codes joined with `+` (`eng+deu`); `''` = every
   *  installed language. */
  ocrLanguages: string
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
  /** M12: the object's formula and rollup values by property key (computed, never stored). */
  computed?: Record<string, ComputedValue>
}

/** PUT /api/object/body → 200 */
export interface SaveResult {
  version: string
  /** The paths whose backlinks this save may have changed (as `ChangeEvent.linked`); absent when unknown. */
  linked?: string[]
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
  /** As `SaveResult.linked`. */
  linked?: string[]
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
  /** M17: an agent was created, saved, deleted, unregistered or restored (`path` its id, or `trash`). */
  | 'agents'
  /** M17: an agent's chat transcript was written (`path` the agent id, `version` the chat id). */
  | 'agentChats'
  /** M18: an agent's memory, skills, ledger, reviews or curator changed (`path` the agent id,
   * `version` the ledger entry, review or curator run id). */
  | 'agentLearning'
  /** M19: an outside MCP server or a secret changed (`path` the server id, or `secrets`). */
  | 'mcpServers'
  /** M23: the general floor list changed (`path` `floor`, `version` its revision). */
  | 'work'
  /** M23 (announced by M24): the work agent's queue changed. */
  | 'workQueue'
  /** Fix pass H: the device settings changed (`path` `settings.json`, `version` their revision). */
  | 'settings'

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
  /**
   * Object events (`created`, `changed`, `deleted`, `renamed`): the paths whose backlinks this
   * change may have altered (the object's link targets before and after it). Absent when the
   * server can't say (or is older): then anything may have changed.
   */
  linked?: string[] | null
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

export type Layout =
  | 'list'
  | 'grid'
  | 'wall'
  | 'table'
  | 'embed'
  | 'kanban'
  | 'gallery'
  // M13 (our layouts)
  | 'calendar'
  | 'timeline'
  | 'chart'

/** M13: the calendar layout's settings. Property ids are property keys, as in filters. */
export interface CalendarViewConfig {
  /** The date property the objects are placed by (`null`: the first date property). */
  dateProperty: string | null
  mode: 'month' | 'week'
}

export type TimelineZoom = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** M13: the timeline layout's settings. */
export interface TimelineViewConfig {
  /** A date property; a range value gives both ends. */
  startProperty: string | null
  /** A second date property for the end (`null`: the start's own range end, else one day). */
  endProperty: string | null
  zoom: TimelineZoom
  /** The table on the left. */
  showTable: boolean
  /** Its columns (property keys), after the title. */
  tableColumns: string[]
  /** Draw the dependency arrows (needs `dependenciesConfig`). */
  showDependencies: boolean
}

export type ChartKind = 'bar' | 'horizontalBar' | 'line' | 'donut' | 'number'
export type ChartSort = 'xAscending' | 'xDescending' | 'yAscending' | 'yDescending'

/** M13: the chart layout's settings. */
export interface ChartViewConfig {
  kind: ChartKind
  /** The X axis: group by this property (the group-by code). Ignored by `number`. */
  xProperty: string | null
  /** For a date X axis: the bucket. */
  xDateBucket: 'day' | 'week' | 'month' | 'year'
  /** The Y axis: `countAll`, or a calculation of `yProperty` (the column calculations). */
  yCalc: CalcKind
  yProperty: string | null
  /** Split each bar or line by a second property. */
  splitBy: string | null
  /** Line charts: add each point to the ones before it. */
  cumulative: boolean
  sort: ChartSort
  hideEmptyGroups: boolean
  showLegend: boolean
  showValues: boolean
}

/** M13: a two-way relation pair turned on from a view's "..." menu. */
export type RelationPairKind = 'subItems' | 'dependencies'

/** M13: POST /api/types/{typeId}/relation-pair */
export interface RelationPairResult {
  type: TypeDef
  /** "Parent item" (single) or "Blocked by". */
  firstId: string
  /** "Sub-items" or "Blocking". */
  secondId: string
  /** False when the type already had the pair (it was reused). */
  created: boolean
}

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
  typeId?: string
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
  typeId?: string
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
  typeId?: string
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
  calculations?: { propertyId: string; typeId: string; kind: CalcKind }[]
  smallCardViewConfigs?: Record<string, SmallCardViewConfig>
  /** M13 */
  calendarConfig?: CalendarViewConfig
  /** M13 */
  timelineConfig?: TimelineViewConfig
  /** M13 */
  chartConfig?: ChartViewConfig
  /** M13: nest rows under their parent (table and timeline). Property keys. */
  subItemsConfig?: { parentPropertyId: string; childrenPropertyId: string }
  /** M13: the dependency pair (timeline arrows). Property keys. */
  dependenciesConfig?: { blockedByPropertyId: string; blockingPropertyId: string }
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
  types: {
    id: string
    collectionIds?: string[]
    excludeCollectionIds?: string[]
    inAnyCollection?: boolean
    inNoCollection?: boolean
  }[]
  excludeTypeIds?: string[]
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
  /** M22: the built-in Tickets view (`work-tickets`); absent for every other query. */
  builtIn?: 'tickets'
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
  filterTypeIds?: string[]
  excludeTypeIds?: string[]
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

// ---- M15 importers (docs/superpowers/plans/2026-11-05-m15-importers.md) ----
// Mirrors backend/objectapp/importers/model.py; field names match exactly.

/** Which reader reads an import source. */
export type ImportSourceKind = 'notion' | 'obsidian' | 'anytype' | 'files'

/** The property kinds an import can make (a subset of `PropertyType`). */
export type ImportKind = Extract<PropertyType, 'text' | 'number' | 'boolean' | 'url' | 'datetime' | 'label' | 'entity'>

export const IMPORT_KINDS: readonly ImportKind[] = ['text', 'number', 'boolean', 'url', 'datetime', 'label', 'entity']

/** A source field that fills one of the app's own fields instead of a new property. */
export type ImportSystemKey = 'title' | 'tags' | 'aliases' | 'description' | 'createdAt' | 'lastUpdated'

export type ImportSkipReason =
  | 'unsafePath'
  | 'symlink'
  | 'encrypted'
  | 'tooLarge'
  | 'damaged'
  | 'nestedArchive'
  | 'unsupported'
  | 'appSettings'
  | 'notUtf8'
  | 'missingAttachment'
  | 'unresolvedLink'
  | 'databaseLink'
  | 'valueNotConverted'
  | 'userSkipped'
  | 'emptyFile'

export type ImportPhase = 'preparing' | 'types' | 'attachments' | 'objects' | 'report' | 'done' | 'failed' | 'cancelled'

/** A zip file or a folder on this device, by absolute path. */
export interface ImportSource {
  path: string
  kind?: ImportSourceKind | 'auto'
}

export interface ImportTypeOverride {
  name?: string | null
  pluralName?: string | null
  skip?: boolean | null
  /** Only with a `currentSpace` target: put these objects into that existing type. */
  existingTypeId?: string | null
}

export interface ImportPropertyOverride {
  kind?: ImportKind | null
  isArray?: boolean | null
  name?: string | null
  skip?: boolean | null
}

/** The mapping step. A preview answers the effective mapping (defaults filled in). */
export interface ImportMapping {
  /** Obsidian and Anytype: what makes an object's type. Notion ignores it (databases are types). */
  typeSource: 'folder' | 'key' | 'none'
  typeKey: string | null
  /** Planned type key -> override. */
  types: Record<string, ImportTypeOverride>
  /** Planned type key -> planned property key -> override. */
  properties: Record<string, Record<string, ImportPropertyOverride>>
}

/** POST /api/import/preview */
export interface ImportPreviewRequest {
  source: ImportSource
  mapping?: ImportMapping | null
  target?: 'newSpace' | 'currentSpace'
}

export type ImportTarget =
  | { kind: 'newSpace'; name: string; location: string }
  | { kind: 'currentSpace' }
  /** M25 "Try on a copy of this space": the open space is copied to `location/name` and the import goes there. */
  | { kind: 'spaceCopy'; name: string; location: string }

/** M25 "Keep originals as" (design section 2). */
export type ImportKeepOriginals = 'attachments' | 'fileObjects'

/** POST /api/import/start */
export interface StartImportRequest {
  previewId: string
  mapping: ImportMapping
  target: ImportTarget
  clientId?: string | null
  keepOriginals?: ImportKeepOriginals
  /** M27: the scan step's choices (design section 6); omitted when there is nothing to carry. */
  scan?: ImportScanChoices
}

/** M27: what the scan step hands to the import: patterns to leave out, flagged files to leave out, flagged files imported with `excludeFromAI`. */
export interface ImportScanChoices {
  leaveOut: string[]
  leaveOutFiles: string[]
  excludeFromAi: string[]
}

export interface ImportPlannedProperty {
  key: string
  sourceName: string
  name: string
  kind: ImportKind
  guessedKind: ImportKind
  isArray: boolean
  systemKey: ImportSystemKey | null
  valueCount: number
  /** Values that don't fit `kind` (dropped and listed in the report). */
  unconvertible: number
  /** Up to 3 distinct values, as the source writes them. */
  samples: string[]
  /** For `label`: the distinct texts, first 50. */
  options: string[]
  skip: boolean
}

export interface ImportPlannedType {
  /** Stable within a preview: `database:<csv path>`, `folder:<name>`, `key:<value>`, `page`. */
  key: string
  name: string
  pluralName: string
  origin: 'database' | 'folder' | 'key' | 'page'
  originLabel: string
  objectCount: number
  existingTypeId: string | null
  skip: boolean
  properties: ImportPlannedProperty[]
}

export interface ImportSkippedItem {
  /** Source-relative POSIX path. */
  path: string
  reason: ImportSkipReason
  detail: string
}

export interface ImportCounts {
  objects: number
  types: number
  properties: number
  attachments: number
  attachmentBytes: number
  links: number
  resolvedLinks: number
  unresolvedLinks: number
  renamed: number
  skipped: number
}

export interface ImportPreview {
  previewId: string
  sourcePath: string
  kind: ImportSourceKind
  detected: ImportSourceKind | null
  container: 'zip' | 'folder'
  /** A name for the new space. */
  suggestedName: string
  counts: ImportCounts
  types: ImportPlannedType[]
  mapping: ImportMapping
  /** Obsidian/Anytype: [key, file count] for "type from key". */
  frontmatterKeys: [string, number][]
  /** Obsidian/Anytype: [top-level folder, Markdown file count]. */
  folders: [string, number][]
  /** The first 20 planned objects. */
  samples: { title: string; typeKey: string; path: string; sourcePath: string }[]
  /** The first 500; `counts.skipped` has the total. */
  skipped: ImportSkippedItem[]
  warnings: string[]
}

export interface StartImportResponse {
  jobId: string
  targetPath: string
}

export interface ImportResult {
  targetPath: string
  spaceName: string
  objects: number
  types: number
  attachments: number
  tags: number
  skipped: number
  /** The "Import report" object's space path. */
  reportPath: string | null
  cancelled: boolean
  /** M25: the batch id, and the counts that reconcile: sourceItems = objects + updated + unchanged + changedInBoth + leftOut + failed. */
  batch?: string | null
  updated?: number
  unchanged?: number
  changedInBoth?: number
  removed?: number
  leftOut?: number
  failed?: number
  /** Of `failed`, the objects not written because the import stopped. */
  notWritten?: number
  originals?: number
  sourceItems?: number
}

/** M25: the `importSource` block in an imported object's frontmatter (design section 1). */
export interface ImportSourceBlock {
  system: string
  id: string
  url?: string
  version?: string
  author?: string
  created?: string
  modified?: string
  original?: string
  contentHash?: string
  batch?: string
  importedAt?: string
}

/** One source item of a batch (`.object/imports/<batch>/items.json`). */
export interface ImportBatchItem {
  sourcePath: string
  system: string
  id: string
  title: string
  path: string | null
  action: 'created' | 'updated' | 'unchanged' | 'conflict' | 'resolvedTake' | 'resolvedKeep' | 'failed' | 'trashed'
}

/** GET /api/import/batches/{id} -> `batch` (`batch.json`). */
export interface ImportBatch {
  id: string
  startedAt: string
  finishedAt?: string
  source: { path: string; kind: string; system: string }
  counts: Record<string, number>
  reportPath?: string | null
  trashedAt?: string
}

/** GET /api/import/jobs/{id} */
export interface ImportJob {
  id: string
  phase: ImportPhase
  done: number
  total: number
  targetPath: string
  currentPath: string | null
  result: ImportResult | null
  error: string | null
}

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
/**
 * M21: run `prompt` as a new chat of the agent `agentId` (an agent schedule: a schedule rule with
 * this one action, no conditions, no template repeat). `model` null: the agent's default. Never
 * offered in the rule editor's "+ Add action" menu.
 */
export interface RunAgentAction {
  kind: 'runAgent'
  agentId: string
  prompt: string
  model: string | null
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
  | RunAgentAction
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
/** M11: a local API token (Settings > Integrations). The secret is shown only when made. */
export type ApiTokenScope = 'read' | 'read-write'

export interface ApiToken {
  id: string
  name: string
  scope: ApiTokenScope
  createdAt: string
  lastUsedAt: string | null
}

/** The ``mcpServers`` entry an MCP client (Claude Code, Claude Desktop) needs. */
export interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
}

/** GET /api/integrations/tokens */
export interface ApiTokenList {
  tokens: ApiToken[]
  mcp: McpConfig
}

/** POST /api/integrations/tokens */
export interface CreatedApiToken {
  token: ApiToken
  secret: string
  mcpConfig: McpConfig
}


// ---- M10: the AI assistant (contract) ----

/** What an AI request is for. The server picks the instructions and the proposal it parses. */
export type AiMode = 'chat' | 'askBlock' | 'tagBlock' | 'tagObject' | 'autofill' | 'rephrase'

/** GET /api/ai/status */
export interface AiStatus {
  available: boolean
  /** `notFound`: no `claude` at the path or on PATH; `notSignedIn`: it answered but isn't signed in. */
  reason: 'ok' | 'notFound' | 'notSignedIn' | 'error'
  claudePath: string | null
  version: string | null
  message: string | null
}

/** GET /api/ai/models: the back end's one model list (aimodels.MODELS). */
export interface AiModelChoice {
  id: string
  label: string
  kind: 'alias' | 'id'
}
export interface AiModels {
  models: AiModelChoice[]
  /** aimodels.MODEL_PATTERN; the client matches it whole: new RegExp(`^(?:${pattern})$`). */
  pattern: string
}

export interface AiMessage {
  role: 'user' | 'assistant'
  text: string
  /** ISO instant */
  at: string
}

/** POST /api/ai/chat (answers a server-sent event stream of `AiEvent`) */
export interface AiChatRequest {
  mode: AiMode
  /** The user's message (for the other modes, an optional extra instruction). */
  prompt: string
  /** The pages the request is about; excluded pages are left out by the server. */
  contextPaths: string[]
  /** The block or selected text for askBlock, tagBlock and rephrase. */
  block?: string | null
  /**
   * The object the block was taken from. The server sends a block only from an object it may
   * show the assistant (not excluded from AI, not a template); a block without one is sent only
   * when it is an assistant message of `history` (rephrasing an answer).
   */
  blockPath?: string | null
  /** Earlier messages, used when the CLI session can't be resumed. */
  history: AiMessage[]
  sessionId?: string | null
  clientId?: string
  /** M16: this chat's model pick; null/absent = the default agent's model (Settings), else the CLI's. */
  model?: string | null
  /** M17: the agent the turn runs as; null/absent = the default agent ("assistant"). */
  agentId?: string | null
  /** M17: the chat's transcript id; null/absent (or not a ULID) starts a new chat. */
  chatId?: string | null
}

/** A change the assistant suggests; nothing is applied until the user accepts it. */
export type AiProposal =
  | { kind: 'tags'; tags: string[] }
  | { kind: 'properties'; values: Record<string, unknown> }
  | { kind: 'text'; text: string }

/** A context page the server left out of a turn, and why. */
export interface AiSkipped {
  path: string
  reason: 'excluded' | 'template' | 'missing' | 'tooLong'
}

export type AiEvent =
  /** M17: the first event of every turn: the chat's transcript id and the agent it runs as. */
  | { type: 'chat'; chatId: string; agentId: string }
  | { type: 'session'; sessionId: string }
  /** A chunk to append to the answer so far. */
  | { type: 'text'; text: string }
  /**
   * A tool step. Sent twice per call with the same `id`: at the call (`input` set, no `result`),
   * then when its result arrives (`input` null, `result` set). `name` is the short name for
   * Object's tools ("search"), the CLI's name otherwise ("Read", "mcp__srv__tool").
   */
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown> | null; result?: string; isError?: boolean }
  | { type: 'done'; text: string; sessionId: string | null; proposal: AiProposal | null; skipped: AiSkipped[] }
  | { type: 'error'; message: string }
  /** M20: a remote agent's file artifact, saved under its folder's files/ (or kept as a link). */
  | { type: 'attachment'; agentId: string; chatId: string; attachment: RemoteAttachment }

/** GET /api/ai/chat?path= */
export interface AiChat {
  path: string
  version: string
  title: string
  contextPaths: string[]
  sessionId: string | null
  messages: AiMessage[]
  /** M17: the chat's Agent property (the agent's name), null when it has none (an M10 chat). */
  agent: string | null
  /** M17: the first listed agent with that name (case-insensitive), else the default agent. */
  agentId: string
  /** M17: the transcript that carries its session id, else null. */
  chatId: string | null
}

/** POST /api/ai/chat/save: creates the chat (no `path`) or replaces its messages (409 on a stale `baseVersion`). */
export interface SaveAiChatRequest {
  path?: string | null
  baseVersion?: string | null
  /** Sent when the chat is created; empty or absent keeps a saved chat's title (renames stay). */
  title?: string
  contextPaths: string[]
  sessionId: string | null
  messages: AiMessage[]
  clientId?: string
  /** M17: the agent the chat ran as (written as its Agent property); null/absent = the default agent. */
  agentId?: string | null
  /** M17: the transcript the saved object is recorded in. */
  chatId?: string | null
}

// ---- M17: agents (docs/superpowers/plans/2026-11-05-m17-agents-and-tools.md, "Contract (T1)") ----

/** GET /api/agents, /api/agents/{id}: one agent (a folder). */
export interface Agent {
  id: string
  /** M20: 'remote' for an A2A agent added by its Agent Card URL. */
  kind: 'local' | 'remote'
  name: string
  icon: string | null
  color: string | null
  description: string
  /** The agent's default model; the default agent's is Settings' aiModel. */
  model: string | null
  /** The switched-off tool ids (toolcatalog). */
  toolsOff: string[]
  /** Reserved for M18. */
  learning: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
  default: boolean
  folder: string
  inStateDir: boolean
  /** false: the default agent before its first use (no folder yet). */
  exists: boolean
  /** A registered folder that is gone. */
  missing: boolean
  readOnlyReason: string | null
  revision: string | null
  /** The folder's .mcp.json servers. */
  mcpServers: { name: string; missingVars: string[]; usable: boolean }[]
  /** M20: a remote agent's card and connection; null for a local agent. */
  remote: RemoteInfo | null
  /** What this agent's runs can't fence (a folder whose name holds a backslash), in Object's words;
   *  shown under Folder. Empty for most agents and for every remote agent. */
  warnings: string[]
}

// ---- M20: remote agents (A2A) ----

/** One skill on a remote agent's Agent Card. */
export interface RemoteSkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples: string[]
}

/** What a remote agent's Agent Card says. */
export interface RemoteCard {
  name: string
  description: string
  version: string | null
  provider: string | null
  documentationUrl: string | null
  skills: RemoteSkill[]
  streaming: boolean
  inputModes: string[]
  outputModes: string[]
}

/** `Agent.remote`: a remote agent's card URL, endpoint and auth (the secret only as `set`). */
export interface RemoteInfo {
  cardUrl: string
  endpointUrl: string
  endpointHost: string
  protocolVersion: string
  streaming: boolean
  auth: { kind: 'none' | 'bearer' | 'header'; headerName: string | null; set: boolean }
  /** A refreshed card's endpoint on another host or scheme, waiting for the move to be confirmed. */
  pendingEndpoint: { url: string; host: string } | null
  card: RemoteCard
  cardFetchedAt: string
  contextNoticeAt: string | null
}

/** POST /api/remote-agents/{id}/refresh: the agent, the preview warnings and the moved-address notice. */
export interface RemoteRefreshResult extends Agent {
  warnings: string[]
  notice: string | null
}

/** A remote agent's auth as entered (the value is sent once and never shown again). */
export interface RemoteAuthInput {
  kind: 'none' | 'bearer' | 'header'
  headerName?: string | null
  value?: string | null
}

/** POST /api/remote-agents/preview */
export interface RemotePreview {
  cardUrl: string
  card: RemoteCard
  endpointUrl: string
  endpointHost: string
  warnings: string[]
}

/** POST /api/remote-agents */
export interface AddRemoteAgentRequest {
  url: string
  auth: RemoteAuthInput
  name?: string | null
  icon?: string | null
  clientId?: string
}

/** PUT /api/remote-agents/{id}; `auth` null or absent leaves the secret as it is. */
export interface SaveRemoteAgentRequest {
  name: string
  icon?: string | null
  color?: string | null
  auth?: RemoteAuthInput | null
  baseRevision: string
  clientId?: string
}

/** A remote agent's file artifact. */
export interface RemoteAttachment {
  name: string
  mediaType: string | null
  size: number | null
  kind: 'file' | 'url'
  /** "<chatId>/<safe name>" under the agent's files/ (kind file). */
  file: string | null
  /** http/https only (kind url). */
  url: string | null
}

/** What create and save accept. */
export interface AgentInput {
  name: string
  icon?: string | null
  color?: string | null
  description?: string
  model?: string | null
  toolsOff?: string[]
  learning?: Record<string, unknown> | null
}

/** POST /api/agents */
export interface CreateAgentRequest {
  agent: AgentInput
  instructions: string
  location?: string | null
  duplicateOf?: { id: string; memory: boolean; skills: boolean } | null
  clientId?: string
}

/** GET /api/agent-trash: one deleted agent's folder. */
export interface AgentTrashItem {
  trashId: string
  agentId: string
  name: string
  icon: string | null
  originalPath: string
  deletedAt: string
}

/** One row of the Tools tab. */
export interface ToolRow {
  id: string
  label: string
  on: boolean
  warning: string | null
}

/** One group of the Tools tab. */
export interface ToolGroup {
  id: string
  label: string
  tools: ToolRow[]
  /** M19: an outside MCP server group's status; absent or null for the other groups. */
  server?: McpGroupStatus | null
}

/** GET /api/agents/{id}/chats: one chat transcript. */
export interface AgentChatSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  spaceName: string | null
  delegated: boolean
  /** M20: the delegating agent's id (with `delegated: true`), else null. */
  from: string | null
  /** M21: the schedule that started this chat (`scheduledFor` ISO UTC), else null. */
  schedule: { ruleId: string; name: string; scheduledFor: string; catchUp: boolean } | null
}

/** One line of a chat transcript. */
export type TranscriptItem =
  | { type: 'user'; text: string; at: string; contextPaths: string[] }
  | {
      type: 'assistant'
      text: string
      at: string
      model: string | null
      sessionId: string | null
      stopped?: boolean
      /** M20: a remote agent's file artifacts. */
      attachments?: RemoteAttachment[]
      /** M20: a remote agent's A2A ids and the task's state after this answer. */
      a2a?: { contextId: string | null; taskId: string | null; state: string | null }
    }
  | {
      type: 'tool'
      id: string
      name: string
      input: Record<string, unknown> | null
      result: string | null
      isError: boolean
      at: string
    }
  | { type: 'error'; message: string; at: string }
  /** M18: one background review of the chat (its start line's place, its end line's state). */
  | {
      type: 'learning'
      reviewId: string
      kinds: ('memory' | 'skills')[]
      state: ReviewStatus['state']
      summary: string | null
      message: string | null
      at: string
    }

/** GET /api/agents/{id}/chats/{chatId} */
export interface AgentTranscript extends AgentChatSummary {
  agentId: string
  sessionId: string | null
  objectPath: string | null
  items: TranscriptItem[]
}

// ---- M18: learning (docs/superpowers/plans/2026-11-05-m18-learning.md, "Contract (T1)") ----

/** An agent's learning settings (`agent.json` `learning`, with every default filled in). */
export interface LearningSettings {
  memoryChars: number
  userChars: number
  /** User turns between memory reviews; 0 = off. */
  memoryReviewEvery: number
  /** Tool calls between skill reviews; 0 = off. */
  skillReviewEvery: number
  /** null = the chat's model. */
  reviewModel: string | null
  curator: boolean
  curatorIdleHours: number
  curatorEveryDays: number
  /** The optional consolidation pass in scheduled curator runs. */
  consolidate: boolean
}

/** One memory file: MEMORY.md (`memory`) or USER.md (`user`). */
export interface MemoryFile {
  target: 'memory' | 'user'
  text: string
  entries: string[]
  chars: number
  cap: number
  /** null: no file yet. */
  revision: string | null
}

/** GET /api/agents/{id}/skills: one skill. */
export interface SkillSummary {
  name: string
  description: string
  createdBy: 'agent' | 'user'
  state: 'active' | 'stale' | 'archived'
  pinned: boolean
  uses: number
  lastUsed: string | null
  createdAt: string | null
  absorbedInto: string | null
}

/** GET /api/agents/{id}/skills/{name}: a skill with its SKILL.md text and files. */
export interface SkillDetail extends SkillSummary {
  text: string
  revision: string
  files: { path: string; size: number }[]
}

/** Who made a ledger entry. */
export interface LedgerSource {
  kind: 'chat' | 'review' | 'curator' | 'user' | 'undo'
  agentId?: string
  chatId?: string | null
  run?: string | null
}

/** GET /api/agents/{id}/ledger: one change, without its before and after text. */
export interface LedgerSummary {
  id: string
  at: string
  target: 'memory' | 'user' | 'skill'
  action: string
  skill: string | null
  file: string | null
  absorbedInto: string | null
  source: LedgerSource
  undoes: string | null
  /** The history line ("Saved a memory", "Patched 'rack-labels'"...). */
  line: string
}

/** GET /api/agents/{id}/ledger/{entryId}: one change with the whole file before and after. */
export interface LedgerEntry extends LedgerSummary {
  before: string | null
  after: string | null
  encoding: 'text' | 'base64'
}

/** One background review of a chat. */
export interface ReviewStatus {
  id: string
  agentId: string
  chatId: string
  kinds: ('memory' | 'skills')[]
  trigger: 'auto' | 'manual'
  state: 'running' | 'done' | 'failed'
  startedAt: string
  endedAt: string | null
  summary: string | null
  message: string | null
  entryIds: string[]
}

/** The curator's state for one agent. */
export interface CuratorState {
  lastRunAt: string | null
  nextDueAt: string | null
  running: boolean
  report: { at: string; runId: string; text: string } | null
}

/** GET /api/agents/{id}/learning */
export interface LearningState {
  settings: LearningSettings
  defaults: LearningSettings
  curator: CuratorState
  revision: string | null
}

/** GET /api/agents/{id}/chats/search: one matching chat. */
export interface ChatSearchHit {
  chatId: string
  title: string
  updatedAt: string
  spaceName: string | null
  /** At most 3, with matches marked «…». */
  snippets: string[]
  matches: number
}

// ---- M19: the MCP gateway ("Contract (T1)") ----

export type McpServerKind = 'command' | 'url'
export type McpTransport = 'http' | 'sse'

/** A stdio server's env row; a secret row has `value` null, `set` = stored. */
export interface McpEnvRow {
  key: string
  value: string | null
  secret: boolean
  set: boolean
}

/** A URL server's header row; a secret row has `value` null, `set` = stored. */
export interface McpHeaderRow {
  name: string
  value: string | null
  secret: boolean
  set: boolean
}

export interface McpToolInfo {
  name: string
  description: string
}

/** POST /api/mcp-servers/{id}/test */
export interface McpTestResult {
  ok: boolean
  tools: McpToolInfo[]
  error: string | null
  elapsedMs: number
  at: string
}

/** One outside MCP server (GET /api/mcp-servers). Never holds a secret value. */
export interface McpServer {
  id: string
  name: string
  enabled: boolean
  kind: McpServerKind
  command: string | null
  args: string[]
  env: McpEnvRow[]
  transport: McpTransport | null
  url: string | null
  headers: McpHeaderRow[]
  bearer: boolean
  createdAt: string
  updatedAt: string
  revision: string
  /** Row keys / header names whose secret is gone (secrets.json lost); usable = []. */
  missingSecrets: string[]
  /** From the tool cache (this run of Object only). */
  lastTest: McpTestResult | null
}

/** POST / PUT /api/mcp-servers: a secret row's `value` null keeps the stored value. */
export interface McpServerInput {
  name: string
  enabled: boolean
  kind: McpServerKind
  command?: string | null
  args?: string[]
  env?: { key: string; value?: string | null; secret: boolean }[]
  transport?: McpTransport | null
  url?: string | null
  headers?: { name: string; value?: string | null; secret: boolean }[]
  bearer?: string | null
  bearerAction?: 'keep' | 'set' | 'remove'
}

/** GET /api/mcp-servers */
export interface McpServersAnswer {
  servers: McpServer[]
  readOnlyReason: string | null
  /** The file is there but can't be read: no servers are listed, and writes stay allowed (the
   * next one copies the file aside first). */
  unreadable: boolean
}

export interface SecretVarUse {
  agentId: string
  agentName: string
  server: string
}

/** GET /api/mcp-secrets: one secret variable (never its value). */
export interface SecretVar {
  name: string
  set: boolean
  settable: boolean
  usedBy: SecretVarUse[]
}

/** An outside MCP server group's status on the Tools tab (`ToolGroup.server`). */
export interface McpGroupStatus {
  source: 'gateway' | 'folder'
  serverId: string | null
  name: string
  status: 'ok' | 'error' | 'unknown' | 'disabled' | 'needsSecrets'
  error: string | null
  fetchedAt: string | null
  missingVars: string[]
}

// ---------------------------------------------------------------------------------------------
// M22: the work model (docs/superpowers/plans/2026-11-05-m22-work-model.md, "Contract (T1)").
// Pydantic mirrors in `backend/objectapp/workmodel.py`.

export type StepKind = 'question' | 'do' | 'approve' | 'agent'
export type StepState = 'open' | 'approved' | 'done' | 'declined'
export type StepAction = 'answer' | 'done' | 'approve' | 'decline' | 'run' | 'reopen' | 'complete' | 'fail'
/** Who acts on a step: Gene, an agent, or Object itself (M24's auto-run, which may only `run`). */
export type WorkRole = 'user' | 'agent' | 'app'
export type Turn = 'you' | 'approve' | 'agent' | 'parked' | 'close' | 'none'
export type Stage = 'notStarted' | 'ready' | 'doing' | 'parked' | 'done'

export const STEP_KIND_LABELS: Readonly<Record<StepKind, string>> = {
  question: 'Question',
  do: 'Do',
  approve: 'Approve',
  agent: 'Agent',
}
export const STEP_STATE_LABELS: Readonly<Record<StepState, string>> = {
  open: 'Open',
  approved: 'Approved',
  done: 'Done',
  declined: 'Declined',
}
export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  notStarted: 'Not started',
  ready: 'Ready',
  doing: 'Doing',
  parked: 'Waiting / parked',
  done: 'Done',
}
export const TURN_LABELS: Readonly<Record<Turn, string>> = {
  you: 'you',
  approve: 'approve',
  agent: 'agent',
  parked: 'parked',
  close: 'close',
  none: 'none',
}

/** The value of a `steps` property in rows and object reads (decode_value). */
export interface StepValue {
  /** "q4m2xa", or "@3" when the file gives none. */
  id: string
  /** 12 hex characters. */
  rev: string
  kind: StepKind
  state: StepState
  text: string
  notBefore: string | null
  answer: string | null
  result: string | null
  addedAt: string | null
  approvedAt: string | null
  doneAt: string | null
  declinedAt: string | null
}

export interface WorkStep extends StepValue {
  /** 1-based position. */
  n: number
  current: boolean
  /** What the user may do on it now (`allowedActions(steps, i, 'user')`). */
  actions: StepAction[]
}

export interface FloorItemValue {
  id: string
  rev: string
  place: string | null
  what: string | null
  collected: string | null
  found: string | null
}

export interface ActivityLine {
  /** "YYYY-MM-DD HH:MM", space time. */
  at: string
  /** "<who> <what>". */
  text: string
  raw: string
}

export interface WorkNoteLine {
  date: string
  who: string
  text: string
  raw: string
}

export interface ResolutionNote {
  /** "Work notes: <id> <title>\nReported: …" (ported text). */
  workNotes: string
  /** "Close notes: <id> <title>\nCause: …" */
  closeNotes: string
  /** The count of "[fill in: …]". */
  gaps: number
}

export interface TicketInfo {
  id: string
  system: 'ServiceNow' | 'Jira' | null
  url: string | null
  deskStatus: string | null
  deskPriority: 'Critical' | 'High' | 'Medium' | 'Low' | null
  requester: string | null
  group: string | null
  location: string | null
  /** Days. */
  opened: string | null
  updated: string | null
  resolved: string | null
}

export interface WorkItemSummary {
  path: string
  objectId: string | null
  title: string
  typeId: string
  version: string
  /** null unless Ticket ID is set. */
  ticket: TicketInfo | null
  rank: number | null
  area: string | null
  cause: string | null
  /** The item's own Priority label (Task), else null. */
  priority: string | null
  priorityNote: string | null
  blockedOn: string | null
  confidence: string | null
  status: string | null
  stage: Stage
  done: boolean
  /** `completed`, ISO. */
  doneAt: string | null
  /** Done and within `DONE_VISIBLE_DAYS`. */
  recentlyDone: boolean
  turn: Turn
  /** An active item whose Desk status is Resolved or Closed. */
  deskSays: 'Resolved' | 'Closed' | null
  current: WorkStep | null
  stepCount: number
  /** Done or declined. */
  stepsFinished: number
  /** Task: its Project relation resolved. */
  projectPath: string | null
  lastActivity: ActivityLine | null
  /** ISO: the later of lastUpdated and the last Activity line. */
  lastTouched: string
  /** Unreadable steps, duplicate ids, a field of the wrong kind… */
  problems: string[]
  /** Fix pass H: a step entry can't be read, so the server refuses every step write until the file is fixed. */
  stepsUnreadable?: boolean
}

export interface WorkItem extends WorkItemSummary {
  /** The decoded value of every work and ticket field the type has. */
  fields: Record<string, unknown>
  steps: WorkStep[]
  verified: string[]
  assumed: string[]
  toRaiseConfidence: string[]
  floorItems: FloorItemValue[]
  findings: string | null
  hypothesis: string | null
  confidenceReason: string | null
  /** Newest first. */
  activity: ActivityLine[]
  /** Oldest first, as on disk. */
  workNotes: WorkNoteLine[]
  /** Tickets only. */
  resolution: ResolutionNote | null
}

export interface WorkWriteResult {
  version: string
  frontmatter: Record<string, unknown>
  body: string
  item: WorkItem
  synced: string[]
  /** The Activity line appended (without "- "). */
  activity: string
  /** The Work notes line appended, if any. */
  workNote: string | null
}

/** One op of `POST /api/work/steps`; `before` is a step id (null/absent = at the end). */
export type StepOp =
  | { op: 'add'; kind: StepKind; text: string; before?: string | null }
  | { op: 'edit'; stepId: string; stepRev: string; text?: string; kind?: StepKind }
  | { op: 'move'; stepId: string; stepRev: string; before: string | null }
  | { op: 'remove'; stepId: string; stepRev: string }

export type FloorOp = 'add' | 'edit' | 'collect' | 'uncollect' | 'remove'

/** `api.workStep` input (`POST /api/work/step`, the client adds `clientId`). */
export interface WorkStepRequest {
  path: string
  stepId: string
  stepRev: string
  action: StepAction
  text?: string | null
  notBefore?: string | null
  ask?: string | null
}

/** `api.workFloor` input (`POST /api/work/floor`, the client adds `clientId`). */
export interface WorkFloorRequest {
  path: string
  op: FloorOp
  itemId?: string | null
  itemRev?: string | null
  place?: string | null
  what?: string | null
  found?: string | null
}

/** `POST /api/types/{typeId}/work-fields` → 200. */
export interface AddWorkFieldsResult {
  type: TypeDef
  added: string[]
  skipped: { key: string; name: string; reason: string }[]
}

// ---- M23: the Work section (plan `2026-11-05-m23-work-section.md`, Contract) ----

export type WorkViewId = 'now' | 'flow' | 'projects' | 'today' | 'floor' | 'queues' | 'agent' | 'stuck' | 'wins' | 'captures'
  | 'alerts' | 'everything' | 'tickets' | (string & {}) // M24 adds 'captures'
export type Energy = 'low' | 'medium' | 'high'
export interface PersonRef { path: string; title: string }
/** `GET /api/work/board`: M22's summary plus what the views need. */
export interface WorkBoardItem extends WorkItemSummary {
  typeName: string
  isProject: boolean
  steps: WorkStep[]
  floorItems: FloorItemValue[]
  hypothesis: string | null
  /** YYYY-MM-DD */
  deadline: string | null
  blockedOnPeople: PersonRef[]
}
export interface WorkBoard { items: WorkBoardItem[]; now: string; today: string; timeZone: string }
export interface FocusLine { n: number; text: string; label: string; links: { target: string; path: string | null }[] }
export interface FocusDay { day: string; notePath: string | null; version: string | null; hasSection: boolean; lines: FocusLine[] }
/** `startLocal` / `endLocal`: "HH:MM" in the space zone. */
export interface MeetingSlot { path: string; title: string; start: string; end: string; startLocal: string; endLocal: string }
export interface WorkToday { day: string; now: string; nowLocal: string; meetings: MeetingSlot[] }
export interface WinDay { day: string; stepsDone: number; itemsClosed: number; objectsChanged: number }
export interface WinEntry { at: string; kind: 'step' | 'closed'; path: string; title: string; text: string }
export interface WorkWins {
  /** Oldest first. */
  days: WinDay[]
  stepsDone: number
  itemsClosed: number
  objectsChanged: number
  got: WinEntry[]
}
export type AlertSeverity = 'Critical' | 'Warning' | 'Info'
export interface AlertRow {
  path: string
  title: string
  source: string | null
  severity: AlertSeverity
  message: string | null
  raisedAt: string | null
  clearedAt: string | null
  link: string | null
  active: boolean
}
export interface AlertSourceStatus {
  source: string
  file: string
  generated: string | null
  ok: boolean
  error: string | null
  stale: boolean
  staleAfterMinutes: number
}
export interface WorkAlerts {
  /** Active first; Critical, Warning, Info; newest raised first. */
  alerts: AlertRow[]
  sources: AlertSourceStatus[]
  /** Active only. */
  counts: Record<AlertSeverity, number>
  folder: string | null
  typeExists: boolean
}
export interface AlertScanReport { files: number; created: number; updated: number; cleared: number; unchanged: number; errors: string[] }
export type AgentQueueState = 'pending' | 'running' | 'done' | 'failed' | 'withdrawn'
export interface AgentQueueRow {
  id: string
  path: string
  title: string
  stepId: string | null
  n: number | null
  stepText: string | null
  /** M24's: what queued it. */
  reason: string
  state: AgentQueueState
  notBefore: string | null
  createdAt: string
  claimedAt: string | null
  finishedAt: string | null
  result: string | null
  error: string | null
}
/** Decision S3: an Agent step the auto-run cap held back (3 in a row); it waits for Run now. */
export interface AgentHeldRow {
  path: string
  title: string
  stepId: string | null
  n: number | null
  stepText: string | null
  heldAt: string | null
  reason: string
}
export interface AgentStatus {
  available: boolean
  agentName: string | null
  actsOnApprovals: boolean
  carrying: number
  rows: AgentQueueRow[]
  /** Decision S3; absent while the agent loop is unavailable. */
  held?: AgentHeldRow[]
  note: string | null
}
export type CaptureFrom = WorkViewId | 'focusSession' | 'keepOnTop' | 'panel'
export interface CaptureRequest { text: string; fromView: CaptureFrom; linkedPath?: string | null }
export interface CaptureSummary {
  path: string
  text: string
  status: 'new' | 'filed' | 'needsYou'
  question: string | null
  capturedAt: string
  linkedPath: string | null
}
// ---- M24: the work agent, captures and Desk sync ----
export interface WorkAgentSettings {
  agentId: string | null; agent: Agent | null; problem: string | null   // NOT_SET, M17's texts, REMOTE_REFUSED
  acts: boolean; autoRun: boolean; readTools: string[]; settingsRevision: string
}
export type CaptureRoute = 'file' | 'breakDown' | 'question'
export interface CaptureItem extends CaptureSummary {   // what M24's sink answers for every capture
  objectId: string | null; version: string; title: string; fromView: string | null; linkedTitle: string | null
  filedTo: { path: string; title: string } | null
  route: CaptureRoute                              // parse_prefix of the text, at read
}
export interface ReadToolRow { id: string; name: string; description: string; marked: boolean; serverSaysReadOnly: boolean }
export interface ReadToolServer { name: string; source: 'gateway' | 'folder'; listed: boolean; tools: ReadToolRow[] }
export interface DeskSyncStatus {
  ruleId: string | null; enabled: boolean; repeat: string | null; time: string | null
  lastRun: { at: string; status: string; detail: string | null } | null
  markedReadTools: number                          // marked tools listed right now
}
export interface GeneralFloor { items: FloorItemValue[]; revision: string }


// ---- M27 the agent workflow (design sections 8 and 9) ----

export type ProposalAction = 'use' | 'extend' | 'create'

export interface ProposalProperty {
  key: string
  name: string
  kind: string
  /** 0..1, how often the property has a value in its group. */
  fillRate: number
  options?: string[]
  /** Option value -> the source spellings merged into it. */
  mergedFrom?: Record<string, string[]>
  relationTo?: string
}

export interface ProposalGroup {
  id: string
  action: ProposalAction
  typeId?: string
  name: string
  plural?: string
  icon?: string
  color?: string
  documentCount: number
  examples: string[]
  properties: ProposalProperty[]
  /** Why Apply will skip this item (the app's rules, e.g. too few documents); empty when it can be applied. */
  problems?: string[]
  /** Properties the app's rules left out of the item, each with the reason. */
  dropped?: { key: string; name: string; reason: string }[]
}

export interface SchemaProposal {
  groups: ProposalGroup[]
}

export type ProposalStatus = 'accepted' | 'edited' | 'rejected'

export interface ProposalEdit {
  name?: string
  plural?: string
  /** Keys of the properties left out. */
  dropProperties?: string[]
}

export interface ProposalReviewItem {
  id: string
  status: ProposalStatus
  edited?: ProposalEdit
}

export interface ProposalReview {
  items: ProposalReviewItem[]
}

export interface ImportProposalResponse {
  proposal: SchemaProposal | null
  review: ProposalReview | null
}

export type FilingState = 'idle' | 'running' | 'trial' | 'done' | 'failed'
export type FilingConfidence = 'high' | 'medium' | 'low'
export type FilingVerdict = 'right' | 'wrong'

export interface FilingValue {
  key: string
  value: unknown
  quote: string
  ok: boolean
}

/** A tag or collection a filing result adds, with the words it was read from. */
export interface FilingLabel {
  value: string
  quote: string
  ok: boolean
}

export interface FilingTrialItem {
  path: string
  title: string
  type: string
  confidence: FilingConfidence
  values: FilingValue[]
  tags?: FilingLabel[]
  collections?: FilingLabel[]
  verdict: FilingVerdict | null
}

export interface FilingMergeSuggestion {
  kind: 'tag' | 'option'
  values: string[]
  suggested: string
}

export interface FilingStatus {
  state: FilingState
  trial: { items: FilingTrialItem[]; rightShare: number | null }
  normalise: FilingMergeSuggestion[]
}
