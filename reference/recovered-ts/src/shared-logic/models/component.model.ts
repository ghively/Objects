import { BackgroundColorTheme, TextColorTheme, ThemeColor } from '../util/colorThemes.js'
import type {
  TabEntry,
  ToggleTree,
  AIDashboardConfig,
  GraphViewCustomization,
  SpaceTaskCustomization,
} from './RootSpace.model.js'
import { ComponentPolicy, LinkPolicy } from './access.model.js'
import { AIAssistantChat, AIAssistantPreferences, type AIAssistantChatModelProvider } from './ai.model.js'
import type { ReaderEntityInfo } from './annotations.model.js'
import type { TaskActionStampInfo } from './api/actionQueue.api.js'
import { UrlMetadata } from './api/api.js'
import type { AudioCategory } from './api/audio.api.js'
import type { WeblinkContentType, WeblinkTopic } from './api/weblink.api.js'
import type { PdfDocumentType, PdfTopic } from './api/pdf.api.js'
import { FileResourceInfo, type SecondaryFileInfo } from './api/resources.api.js'
import {
  Block,
  CodeBlock,
  HierarchyInterface,
  Icon,
  IconInterface,
  LinkReferences,
  ListInterface,
  QuoteInterface,
  TodoInterface,
  ToggleInterface,
} from './blocks.model.js'
import { CalendarDefinition } from './calendarIntegrations.model.js'
import { DataViewDefinition, DataViewLayoutTypes, LocalDataViewInfo } from './dataView.model.js'
import { DeviceInfo, LanguageKey, type ChecklistKey } from './general.model.js'
import { mediaTypes, type MediaLayerMetadata } from './media.model.js'
import {
  AudioFileResourceProperty,
  BlocksProperty,
  BooleanProperty,
  DescriptionProperty,
  EntityProperty,
  FileFileResourceProperty,
  IconProperty,
  ImageFileResourceProperty,
  MediaFileSizeProperty,
  MediaTweetTweetsProperty,
  NumberProperty,
  PDFFileResourceProperty,
  Property,
  PropertyDefinition,
  SimpleTableBlockProperty,
  TemplateProperty,
  TextProperty,
  TitleProperty,
  URLReferenceProperty,
  UtilAIChatProperty,
  UtilDateEventProperty,
  UtilDateObjectProperty,
  VideoFileResourceProperty,
  type AliasesProperty,
  type ChangeTypePreferences,
  type DatetimeSimpleProperty,
  type LabelProperty,
} from './property.model.js'
import { GeneralQueryDefinition } from './query.model.js'
import type { ReaderIntegrationSettings } from './readerIntegrations.model.js'
import type { WhiteboardBoardToolMemory, WhiteboardData } from './whiteboard.model.js'
import { StructureCustomization } from './structure.model.js'
import {
  DatabaseViewStructureViewTypes,
  EmbedStructureViewDefinition,
  InlineStructureViewDefinition,
  PageStructureViewDefinition,
  SmallCardStructureViewDefinition,
  SmallCardViewConfig,
  StructureViewTypes,
  WideCardStructureViewDefinition,
} from './structureView.model.js'
import { TaskActionDefinition } from './taskActions.model.js'
import type { DarkThemeKey, FontOptions, LightThemeKey } from './themeOptions.js'
import { TokenStyleEntry } from './tokens.model.js'
import type { ImageCategory } from '../util/basicStructures.js'
import type { SyncedPreferences } from './syncedPreferences.model.js'

export const spaceTypes = ['RootSpace', 'UserPersonal'] as const

export const FIXED_WORKSPACE_SECTIONS = ['objects', 'pinned'] as const
export type FixedWorkspaceSections = (typeof FIXED_WORKSPACE_SECTIONS)[number]

export const OPTIONAL_WORKSPACE_SECTIONS = [] as const

export type OptionalWorkspaceSections = (typeof OPTIONAL_WORKSPACE_SECTIONS)[number]

export type SpaceType = (typeof spaceTypes)[number]

export type ChecklistState = {
  activatedOn: string
  completedOn: string | undefined
  completedItems: string[] // key of checked items
  hideInApp?: boolean
}

export enum LoadingStates {
  Preview = 'preview',
  Full = 'full',
  Error = 'error',
}

export enum LoadingErrors {
  AccessDenied = 'accessDenied',
  DoesNotExist = 'doesNotExist',
  InternalServerError = 'InternalServerError',
  LoadingFailed = 'loadingFailed',
  Deleted = 'deleted',
}

export type PDFZoomType = 'page-fit' | 'page-width' | 'page-height' | 'page-actual' | 'custom'

export type PDFZoom<T extends PDFZoomType = PDFZoomType> = T extends 'custom'
  ? {
      type: T
      scale: number
    }
  : {
      type: T
      scale?: undefined
    }

export type ObjectSidebarSections = 'outline' | 'objects' | 'stats'
export type ObjectSidebarState = {
  sections?: Record<ObjectSidebarSections, boolean | undefined>
  width?: number | undefined
  /** @deprecated */
  isStatic?: boolean | undefined
  isFixed?: boolean | undefined
}

export type ComponentProperties = {
  isTemplate?: TemplateProperty | undefined
  title?: TitleProperty
  icon?: IconProperty | undefined
  description?: DescriptionProperty | undefined
  tags?: EntityProperty | undefined
  aliases?: AliasesProperty | undefined
} & Record<string, Property | undefined>

export type ComponentFrontmatterProperty = {
  name: string
  type: 'text'
  val: string
}

export type CoverImageOffset = {
  offset: number
  referenceImageId: string
}

export type EntityContentViewsData = {
  hasTasks?: boolean
  activeContentView?: 'content' | 'tasks' | 'properties' | 'analysis' | undefined
}

export type AiAutofillJobKind = 'property' | 'coverImage'

/** Written only by the portal autofill worker so clients can resolve their pending autofill requests. */
export type AiAutofillJobStatus = {
  requestId: string
  state: 'done' | 'error'
  errorCode?: string | undefined
  jobKind?: AiAutofillJobKind | undefined
  /** Set when a finished job found nothing to write, e.g. no matching cover image. */
  noResult?: boolean | undefined
  finishedAt: string
}

export type ReferencesSectionTab = 'all' | 'backlinks' | 'related' | 'mentions' | 'relatedTags'
export type ReferencesSource = 'backlinks' | 'related' | 'mentions'
export type TemplatesSectionTab = 'templates' | 'import'

export interface ComponentData {
  origin?: { componentId: string; blockId: string } | undefined
  blocks: Partial<{ [x: string]: Block[] | undefined }>
  secondaryFiles?: Record<string, SecondaryFileInfo> | undefined
  secondaryFileUrls?: Record<string, { url: string; expirationDate: string }> | undefined
  defaultPageViewId?: string | undefined
  coverImageOffset?: CoverImageOffset | undefined
  mediaContentState?: 'loading' | 'error' | 'full' | undefined
  mediaContentLoadingTriggerDate?: string | undefined
  mediaProcessingState?: 'loading' | 'error' | undefined
  aiAutofill?: AiAutofillJobStatus | undefined
  templateCollectionIds?: string[] | undefined
  localDataViewInfo?: LocalDataViewInfo | undefined
  frontmatterProperties?: ComponentFrontmatterProperty[] | undefined
  objectSidebarState?: ObjectSidebarState | undefined
  readwiseInfo?: ReaderEntityInfo | undefined
  backlinksClosed?: boolean | undefined
  relatedContentClosed?: boolean | undefined
  unlinkedMentionsClosed?: boolean | undefined
  relatedTagsClosed?: boolean | undefined
  referencesSectionClosed?: boolean | undefined
  referencesSectionTab?: ReferencesSectionTab | undefined
  templatesSectionClosed?: boolean | undefined
  templatesSectionTab?: TemplatesSectionTab | undefined
  backlinkContentView?: DataViewLayoutTypes | undefined
  /** @deprecated use backlinksClosed */
  backlinksOpen?: boolean | undefined
  /** @deprecated use unlinkedMentionsClosed */
  unlinkedMentionsOpen?: boolean | undefined
  requiredMediaProcessing?:
    | {
        metadata: MediaLayerMetadata
      }
    | undefined
  contentViews?: EntityContentViewsData | undefined
  /** Blueprint template id this template entity was created from. */
  blueprintTemplateId?: string | undefined
  highlightStyle?: 'quote' | 'minimal' | undefined
  hideProperties?: boolean | undefined
  cropCoverImage?: boolean | undefined
  wideLayoutMode?: boolean | undefined
  hidePropertySection?: boolean | undefined
  hideTOCSection?: boolean | undefined
  presentation?: PresentationConfig | undefined
  [x: string]: any
}

export type PresentationConfig = {
  hideCoverImage?: boolean | undefined
  hideTitle?: boolean | undefined
  hideProgressIndicator?: boolean | undefined
  hiddenPropertyIds?: string[] | undefined
  footerLeft?: string | undefined
  footerRight?: string | undefined
}

export interface ActiveView {
  id?: string | undefined
  type: DatabaseViewStructureViewTypes | 'linkToken'
}

interface LinkTemplate {
  id: string
  createdAt: string
  data: {
    linkInfo?: { spaceId: string } | { spaceName: 'home' } | undefined
    activeView?: ActiveView | undefined
    /** @deprecated */
    includeTime?: boolean | undefined
    /** @deprecated */
    date?: string | undefined
    activeDatabaseViewId?: string | undefined
    showDatabaseHeader?: boolean | undefined
    toStructureId?: string | undefined
    propertyId?: string | undefined
    references?: LinkReferences
  }
}

export interface LinkDown extends LinkTemplate {
  type: 'Dependency'
}

export interface LinkUp extends LinkTemplate {
  type: 'Database'
  policies: LinkPolicy[]
}

export type Link = LinkUp | LinkDown

export interface LinkNodeDown {
  id: string
  link: LinkDown
}

export interface LinkNodeUp {
  id: string
  link: LinkUp
}

export type LinkNode = LinkNodeDown | LinkNodeUp

export interface ComponentBase {
  id: string
  loadingState: LoadingStates.Error
  lastUpdated: string
  loading?: boolean | undefined
  databases?: LinkNodeUp[] | undefined
  structureId?: string | undefined
  type?: undefined
  policies?: undefined
  createdAt?: undefined
  deleteRequested?: undefined
  properties?: undefined
  data?: undefined
  linkNodes?: undefined
  local?: LocalObject | undefined
  fileResource?: undefined
}

export interface ComponentError extends Omit<
  ComponentBase | ComponentPreviewTemplate<CTypes, ComponentProperties, LocalObject>,
  'loadingState' | 'data' | 'fileResource' | 'linkNodes' | 'structureId'
> {
  loadingState: LoadingStates.Error
  structureId: string
}

export interface ComponentPreviewTemplate<
  Type extends string,
  Properties extends ComponentProperties,
  LocalObjectTemplate extends LocalObject,
> extends Omit<
  ComponentBase,
  'loadingState' | 'type' | 'structureId' | 'policies' | 'createdAt' | 'deleteRequested' | 'properties'
> {
  type: Type
  structureId: string
  loadingState: LoadingStates.Preview
  policies: ComponentPolicy[]
  databases: LinkNodeUp[]
  createdAt: string
  deleteRequested?: boolean
  properties: Properties
  local: LocalObjectTemplate
}

// !! if change think about changeStack and worker getC/setC and processing saveComponentsObject (where we keep cached local)
export interface LocalObject {
  loadingError?: LoadingErrors | undefined
  lastStored?: string | undefined
  /** @deprecated */
  entryIds?: string[]
  /** @deprecated */
  entryCachedIds?: string[]
  /** @deprecated */
  attachmentsLoadingState?: 'notLoaded' | 'loading' | 'full'
  /** @deprecated */
  attachmentIds?: string[]
  fileUrl?: string | undefined
}

export interface ComponentFullTemplate<
  Type extends string,
  Properties extends ComponentProperties,
  Data extends { [x: string]: any },
  LocalObjectTemplate extends LocalObject,
> extends Omit<
  ComponentPreviewTemplate<Type, Properties, LocalObjectTemplate>,
  'data' | 'loadingState' | 'linkNodes' | 'fileResource'
> {
  data: Data
  loadingState: LoadingStates.Full
  linkNodes: LinkNode[]
  fileResource?: FileResourceInfo | undefined
}

// ----------------------------
// User
type UserType = 'User'

interface UserProperties extends ComponentProperties {
  firstName?: TextProperty | undefined
  lastName?: TextProperty | undefined
  profile_picture?: EntityProperty | undefined
}

export interface UserData extends ComponentData {
  readonly userPersonalId: string
}

export type UserPreview = ComponentPreviewTemplate<UserType, UserProperties, LocalObject>
export type UserFull = ComponentFullTemplate<UserType, UserProperties, UserData, LocalObject>

export type User = UserFull | UserPreview | ComponentError

// ----------------------------
// UserPersonal
type UserPersonalType = 'UserPersonal'

interface UserPersonalProperties extends ComponentProperties {
  firstName?: TextProperty | undefined
  lastName?: TextProperty | undefined
  spaces?: EntityProperty | undefined
}

// should always be up to date.

export type TwitterAuthProfile = {
  profiles: {
    id: string
    name: string
    username: string
    url: string
    profileImageUrl: string
    defaultSpaceId?: string | undefined
  }[]
}

export type TelegramAuthProfile = {
  ignoreTimestamp?: boolean | undefined
  chats: (
    | {
        id: string
        type: 'private'
        firstName: string
        lastName: string
        defaultSpaceId?: string | undefined
      }
    | {
        id: string
        type: 'group'
        title: string
        initiatedUserId: string
        defaultSpaceId?: string | undefined
      }
  )[]
}

export type WhatsappAuthProfile = {
  ignoreTimestamp?: boolean | undefined
  chats: {
    id: string
    phoneNumber: string
    type: 'private'
    name: string
    defaultSpaceId?: string | undefined
    bsuid?: string // Business-Scoped User ID for username adopters
  }[]
}

export type CapacitiesAIKeyConfiguration = {
  id: string
  provider?: AIAssistantChatModelProvider | undefined // openai if undefined
  keyName?: string | undefined
  lastFourDigits: string
  spaceIds?: string[] | undefined
  /** @deprecated */
  defaultSpaceId?: string | undefined
  maxBudget?: number | undefined
}

export type CapacitiesAIAuthProfile = {
  defaultToKeys?: boolean | undefined
  keys?: CapacitiesAIKeyConfiguration[] | undefined
}

export type EmailAuthProfile = {
  ignoreTimestamp?: boolean | undefined
  emails: {
    status: 'verified' | 'pending'
    email: string | undefined // undefined means default user email
    defaultSpaceId?: string | undefined
  }[]
}

export type KindleImportIntegrationSpaceSettings = {
  spaceId: string
  bookStructureId?: string | undefined
  ignoreReadwiseImports?: boolean
}

export type MobileEditBarItems = Array<
  | 'unindent'
  | 'indent'
  | 'tag'
  | 'add'
  | 'link'
  | 'toggle'
  | 'todo'
  | 'hierarchy'
  | 'quote'
  | 'list'
  | 'color'
  | 'above'
  | 'below'
  | 'delete'
  | 'taskActions'
  | 'undo'
  | 'redo'
  | 'lineBreak'
>

/** Default order of the phone block bar's action row. */
export const mobileBlockBarActionIds = [
  'cut',
  'copy',
  'duplicate',
  'undo',
  'redo',
  'insert-above',
  'insert-below',
  'group',
  'select-all',
  'ai',
  'unindent',
  'indent',
  'move-up',
  'move-down',
  'block-reference',
  'delete',
] as const

export type MobileBlockBarActionId = (typeof mobileBlockBarActionIds)[number]

/** Default order of the phone block bar's style row. */
export const mobileBlockBarStyleIds = ['toggle', 'todo', 'quote', 'hierarchy', 'list', 'color'] as const

export type MobileBlockBarStyleId = (typeof mobileBlockBarStyleIds)[number]

export interface UserPersonalData extends ComponentData {
  readonly userId: string // !! DO NOT MUTATE
  language: LanguageKey
  activeSpaceId?: string | undefined
  preferences?: SyncedPreferences | undefined
  /** @deprecated */
  recentComponents?: { spaceId: string; componentId: string }[]
  embedServicesWhitelist: string[]
  recentEmojiHexcodes?: string[] | undefined
  /** @deprecated */
  recentEmojis?: unknown[] | undefined
  recentIcons?: Icon[] | undefined
  editorSettings?: {
    textStatsMode?: 'characters' | 'words' | 'sentences' | undefined // 'words' is default
    disableSpellcheck?: boolean | undefined
    spellCheckLang?: string | undefined
    /** @deprecated */
    hideObjectCreateButtonsInCalendar?: boolean | undefined
    /** @deprecated */
    hideObjectsWithDataPropertiesButtons?: boolean | undefined
    disableNumberedListTransformation?: boolean | undefined
    hideEntityIconsOnInlineLinks?: boolean | undefined
    /** @deprecated */
    showEntityIconsOnInlineLinks?: boolean | undefined
    toggleStyle?: 'toggle' | 'bullet' | undefined // undefined is default which translates to 'toggle'
    hideOutlinerLines?: boolean | undefined
    hideDisplayOfTagsInText?: boolean | undefined
    hideStructureSettings?: boolean | undefined
    alwaysOpenAsFullPage?: boolean | undefined
    alwaysCreateInlineLinks?: boolean | undefined
    defaultContextualBacklinkViewMode?: 'showFullPathAbove' | undefined // undefined is default which translates to 'blockWithLinkAsRoot'
    disableNavigationGestures?: boolean | undefined
    /** @deprecated */
    defaultObjectSidebarPosition?: 'floating' | 'static' | undefined
    mobileEditorSettings?:
      | {
          editBarItemOrder?: MobileEditBarItems | undefined
          /** Missing keys default to visible. */
          editBarItemVisibility?: Partial<Record<MobileEditBarItems[number], boolean>> | undefined
          blockBarActionOrder?: MobileBlockBarActionId[] | undefined
          /** Missing keys default to visible. */
          blockBarActionVisibility?: Partial<Record<MobileBlockBarActionId, boolean>> | undefined
          blockBarStyleOrder?: MobileBlockBarStyleId[] | undefined
          /** Missing keys default to visible. */
          blockBarStyleVisibility?: Partial<Record<MobileBlockBarStyleId, boolean>> | undefined
        }
      | undefined
    /** @deprecated */
    hideUnlinkedMentions?: boolean | undefined
  }
  languageSettings?: {
    radix?: '.' | ',' | undefined
  }
  appearanceSettings?: {
    lightTheme?: LightThemeKey | undefined
    darkTheme?: DarkThemeKey | undefined
    globalFont?: FontOptions | undefined
    monochromeTags?: boolean | undefined
    monochromeTypeLabels?: boolean | undefined
  }
  /** @deprecated */
  previewModalXRayIsOpen: boolean
  /** @deprecated */
  pageCollectionsSectionIsOpen?: boolean
  /** @deprecated */
  pageBacklinksSectionIsOpen?: boolean
  /** @deprecated */
  pageUnlinkedMentionsSectionIsClosed?: boolean
  createdOnDaySectionIsOpen?: boolean
  /** @deprecated */
  xRayIsOpen: boolean
  /** @deprecated */
  xRayCollectionsAreOpen: boolean
  /** @deprecated */
  xRayTagsAreOpen: boolean
  /** @deprecated */
  xRayBacklinksAreOpen: boolean
  /** @deprecated */
  xRayActionsAreOpen: boolean
  /** @deprecated */
  xRayTOCisOpen: boolean
  /** @deprecated */
  xRayTextStatsAreOpen: boolean
  /** @deprecated */
  xRayContextIsOpen: boolean
  createdOnDayLayout?: DataViewLayoutTypes
  inSpaceOverview?: boolean
  recentTokenStyles: Array<TokenStyleEntry>
  recentBlockStyles: Array<{
    colorTheme: BackgroundColorTheme | TextColorTheme | undefined
    blockInterfaces: {
      hierarchy?: HierarchyInterface['hierarchy']
      toggle?: ToggleInterface['toggle']
      list?: ListInterface['list']
      quote?: QuoteInterface['quote']
      todo?: TodoInterface['todo']
      icon?: IconInterface['icon']
    }
  }>
  /** @deprecated */
  learning?: any | undefined
  learningStats?:
    | {
        unitsReceived?: string[]
        counters?: {
          [x: string]: number
        }
      }
    | undefined
  setup?: {
    step: number
    newsletter?: boolean | undefined
    freeTrial?: boolean | undefined
    templateStructureIds?: string[]
  }
  onboardingCompletedAt?: string | undefined
  /** @deprecated */
  onboardingMobile?: any
  quickTips?: {
    [x: string]: {
      watched?: boolean
      disabled?: boolean
    }
  }
  timeZone?: string | undefined
  userColor?: ThemeColor | undefined
  twentyFourHourTime?: boolean
  startWeekOnSunday?: boolean
  dateFormatOverwrite?: 'ISO8601' | undefined
  dateFormatting?: 'DMY' | 'MDY' | undefined
  codeBlockPreferredLanguage?: CodeBlock['lang'] | undefined
  codeBlockLineWrappingLastUsed?: boolean | undefined
  proPromoLabelClosed?: boolean | undefined
  trialOverLabelClosed?: boolean | undefined
  /** Account-wide header-promo dismissals, synced across spaces and devices. */
  mediaProPromoDismissals?:
    | {
        analysisImage?: boolean | undefined
        analysisPdf?: boolean | undefined
        analysisAudio?: boolean | undefined
        analysisWeblink?: boolean | undefined
      }
    | undefined
  authProfiles?:
    | {
        email?: EmailAuthProfile | undefined
        twitter?: TwitterAuthProfile | undefined
        telegram?: TelegramAuthProfile | undefined
        whatsapp?: WhatsappAuthProfile | undefined
        /** @deprecated BYOK keys. Secrets lived on user-identity `auth.openai`; do not add new readers. */
        openai?: CapacitiesAIAuthProfile | undefined
      }
    | undefined
  lastSpaceId?: string | undefined
  devices?: { info: DeviceInfo }[] | undefined
  textHighlightColorLastUsed?: TextColorTheme | BackgroundColorTheme | undefined
  /**
   * Tool memory, snap, dots, wheel-zoom, engineering. Not the canvas blob on a
   * `RootWhiteboard` (`data.whiteboard` there). A new board has no `boardTools`
   * entry and opens on Move with default colors.
   */
  whiteboard?:
    | {
        boardTools?: Record<string, WhiteboardBoardToolMemory> | undefined
        /** When false, nodes do not snap to the 20px grid. Default true. */
        isSnappingToGrid?: boolean | undefined
        /** When false, dragged nodes do not snap to other nodes. Default true. */
        isSnappingToNodes?: boolean | undefined
        /** When false, the dotted canvas background is hidden. Default true. */
        isShowingDots?: boolean | undefined
        /** When false, the mouse wheel does not zoom (it pans like a trackpad). Default true. */
        isZoomingOnScroll?: boolean | undefined
        /** When true, the engineering gates menu is shown. Default false. */
        isEngineeringMode?: boolean | undefined
      }
    | undefined
  onboardingInfo?:
    | {
        professions: string[]
        professionsSpecific: string[]
        notesApps: string[]
        notesAppsSpecific: string[]
      }
    | undefined

  checklistStates?: {
    [T in ChecklistKey]?: ChecklistState
  }

  academy?:
    | {
        lastOpenedSection?: string | undefined
        firstStepsDone?: string[] | undefined
      }
    | undefined
  tipOfTheDayDismissedKeys?: string[] | undefined
  aiAssistantPreferences?: AIAssistantPreferences | undefined
  taskPreferences?: {
    taskActionDefinitions?: TaskActionDefinition[] | undefined
  }
  calendarIntegrations?: {
    calendars?: CalendarDefinition[] | undefined
  }
  readerIntegrations?: {
    readers?: ReaderIntegrationSettings[] | undefined
  }
  kindleImporter?: {
    active: boolean
    spaces?: KindleImportIntegrationSpaceSettings[] | undefined
  }
  lastUsedBlockIcon?: Icon | undefined
  /** @deprecated Use {@link showDeveloperInformation} instead. */
  developerMode?: boolean | undefined
  showDeveloperInformation?: boolean | undefined
  seenNotifications?: string[] | undefined
  /** Key of the last in-app What's New **full** release used for welcome auto-open (e.g. 'release-68'). */
  lastSeenReleaseKey?: string | undefined
  /** App version for which the user last opened What's New. Drives the sidebar unread dot. */
  lastSeenWhatsNewAppVersion?: string | undefined
  changeTypePreferences?: {
    [x: string]: ChangeTypePreferences
  }
  bulkImport?: {
    totalNumberOfImportedObjects: number | undefined
  }
  closeBacklinksSectionByDefault?: 'closed' | undefined
  closeRelatedContentSectionByDefault?: 'closed' | 'hidden' | undefined
  closeUnlinkedMentionsSectionByDefault?: 'closed' | 'hidden' | undefined
  defaultBacklinkContentView?: DataViewLayoutTypes | undefined
}

export type UserPersonalPreview = ComponentPreviewTemplate<UserPersonalType, UserPersonalProperties, LocalObject>
export type UserPersonalFull = ComponentFullTemplate<
  UserPersonalType,
  UserPersonalProperties,
  UserPersonalData,
  LocalObject
>

export type UserPersonal = UserPersonalFull | UserPersonalPreview | ComponentError

// ----------------------------
// RootSpace
type RootSpaceType = 'RootSpace'

interface RootSpaceProperties extends ComponentProperties {
  workspace_pages?: EntityProperty | undefined
  databases?: EntityProperty | undefined
}

// !! IF YOU CHANGE HERE MAKE SURE TO ALSO THINK ABOUT duplicateComponent for space

export type WorkspaceSection = {
  icon?: Icon | undefined
  name?: string
  ids?: string[] | undefined
  isHidden?: boolean | undefined
  sortOption?: 'alphabetical' | 'manual' | undefined
}
export interface RootSpaceData extends ComponentData {
  /** @deprecated */
  spacePermissions?:
    | {
        editors?: {
          userId: string
          type: 'admin' | 'editor'
          createdAt: string
        }[]
      }
    | undefined
  calendar?: {
    hideCalendarSidebar?: boolean
    daily?: {
      hideDailyNote?: boolean
      hideBacklinks?: boolean
      hideTimeline?: boolean
      hideCreatedOnDay?: boolean
      hideTasks?: boolean
      /** Exclusive desktop daily tab, or `all` for the stacked sections view. */
      desktopTab?: 'all' | 'dailyNote' | 'tasks' | 'timeline' | 'createdOnDay'
      createdOnDayViewDefinition?: DataViewDefinition | undefined
      tasksViewDefinition?: DataViewDefinition | undefined
      /** @deprecated */
      createdOnDayLayout?: DataViewLayoutTypes
    }
  }
  aiDashboard?: AIDashboardConfig | undefined
  toggleTree?: ToggleTree | undefined
  /** @deprecated Copied into local navigation on first open, then removed. */
  tabs?: Array<TabEntry>
  /** @deprecated Copied into local navigation on first open, then removed. */
  tabsMobile?: Array<TabEntry>
  /** @deprecated Copied into local navigation on first open, then removed. */
  tabsTablet?: Array<TabEntry>
  recentComponentIds?: string[]
  /** Entity id → ISO timestamp of the last visit, pruned to `recentComponentIds`. */
  recentComponentVisitedAt?: Record<string, string>
  recentCommandActionIds?: string[]
  recentBacklinkPickIds?: string[]
  /** @deprecated Unused. The tab bar is not controlled by this flag. */
  hideTabsBar?: boolean
  /** @deprecated Use local space preference `ui.spaceOverviewClosed` instead. */
  databaseOverviewIsOpen?: boolean | undefined
  workspace?: {
    pinned?: WorkspaceSection | undefined
    [section: string]: WorkspaceSection | undefined
  }
  objectsSectionSortOption?: 'alphabetical' | 'manual' | undefined
  workspaceOrder?: Array<'objects' | 'pinned' | string>
  backlinksSectionClosedDefault?: boolean | undefined
  unlinkedMentionsSectionClosedDefault?: boolean | undefined
  relatedContentHiddenStructureIds?: string[] | undefined
  hideTaskManagement?: boolean | undefined
  taskCustomization?: SpaceTaskCustomization | undefined
  mediaAnalysis?: {
    autoImageAnalysisDisabled?: boolean | undefined
    autoAudioAnalysisDisabled?: boolean | undefined
  }
  /**
   * Legacy graph filters. Copied into synced space preferences the first time the space mounts,
   * then removed. New writes go to synced space preferences.
   */
  graphCustomization?: GraphViewCustomization | undefined
  hasEverShared?: boolean | undefined
  /** Sticky: true once this space has delivered at least one in-app notification to a user. */
  hasEverHadNotifications?: boolean | undefined
}

export type RootSpacePreview = ComponentPreviewTemplate<RootSpaceType, RootSpaceProperties, LocalObject>
export type RootSpaceFull = ComponentFullTemplate<RootSpaceType, RootSpaceProperties, RootSpaceData, LocalObject>

export type RootSpace = RootSpaceFull | RootSpacePreview | ComponentError

// ----------------------------
// RootStructure
type RootStructureType = 'RootStructure'

export interface RootStructureProperties extends ComponentProperties {
  pluralName?: TextProperty | undefined
}

export interface StructureViews {
  inline?: InlineStructureViewDefinition[]
  smallCard?: Array<SmallCardStructureViewDefinition>
  wideCard?: Array<WideCardStructureViewDefinition>
  embed?: Array<EmbedStructureViewDefinition>
  page?: Array<PageStructureViewDefinition>
}

export interface RootStructureData extends ComponentData, StructureCustomization {
  propertyDefinitions: PropertyDefinition[]
  /**
   * Index at which the synthetic "collections" row is inserted in the
   * RenderProperties list (0 = first). Undefined defaults to 0.
   */
  collectionsPropertyPosition?: number | undefined
  viewDesign?: 'profile' | 'indexCard' | 'encyclopedia' | undefined
  /** Blueprint key this object type was created from, e.g. `person`. */
  templateKey?: string | undefined
  // layout
  encyclopediaBacklinksSectionIsOpen?: boolean | undefined
  encyclopediaTOCSectionIsOpen?: boolean | undefined
  encyclopediaLinkedComponentsSectionIsOpen?: boolean | undefined
  cropCoverImage?: boolean | undefined
  wideLayoutMode?: boolean | undefined
  wideCoverImage?: boolean | undefined
  // views
  defaultPageViewId: string
  defaultViewType: StructureViewTypes
  defaultViewIds: {
    [x in StructureViewTypes]: string
  }
  structureViews: StructureViews
  smallCardViewConfig?: SmallCardViewConfig | undefined
  // calendar
  createInCalendarOption?: 'disabled' | 'createOnce' | undefined
  hideFromCalendarSidebar?: boolean | undefined
}

export type RootStructurePreview = ComponentPreviewTemplate<RootStructureType, RootStructureProperties, LocalObject>

export type RootStructureFull = ComponentFullTemplate<
  RootStructureType,
  RootStructureProperties,
  RootStructureData,
  LocalObject
>

export type RootStructure = RootStructureFull | RootStructurePreview | ComponentError

// ----------------------------
// RootDatabase
type RootDatabaseType = 'RootDatabase'
export interface RootDatabaseProperties extends ComponentProperties {
  structures?: EntityProperty | undefined
  isDefaultDatabase?: BooleanProperty | undefined
  /** @deprecated Can not be removed because of mergeToNewDataStructure */
  entityTemplates?: EntityProperty | undefined
}

export interface RootDatabaseData extends ComponentData {
  layout?: DataViewLayoutTypes
  defaultDatabasePanel?: string
  structureIds: string[]
  activeDatabaseViewId: string | undefined
  contentPanelIsOpen: boolean
  definitionPanelIsOpen: boolean
  entriesPanelIsOpen: boolean
  /** @deprecated */
  defaultTemplateId?: string | undefined
  entriesCountCached?: number | undefined
  activeDatabasePage?: number
  templates?: {
    ids?: string[] | undefined
    defaultTemplateId?: string | undefined
  }
  workspace?: {
    pinned?: { ids?: string[] | undefined; isHidden?: boolean | undefined } | undefined
  }
  dashboard?: {
    sections?: {
      key: string
      collapsed?: boolean | undefined
      viewDefinition?: DataViewDefinition | undefined
    }[]
    removedSections?: string[] | undefined
  }
  structureCustomization?: StructureCustomization
  isUnpinned?: boolean | undefined
  showDataViewDetails?: boolean | undefined
}

export type RootDatabasePreview = ComponentPreviewTemplate<RootDatabaseType, RootDatabaseProperties, LocalObject>

export type RootDatabaseFull = ComponentFullTemplate<
  RootDatabaseType,
  RootDatabaseProperties,
  RootDatabaseData,
  LocalObject
>

export type RootDatabase = RootDatabaseFull | RootDatabasePreview | ComponentError

// ----------------------------
// RootQuery
type RootQueryType = 'RootQuery'

export interface RootQueryData extends ComponentData {
  definition?: GeneralQueryDefinition | undefined
  viewDefinition?: DataViewDefinition | undefined
  entriesCountCached?: number | undefined
  showDataViewDetails?: boolean | undefined
  /**
   * True once the user has manually renamed the query. Blocks automatic title
   * updates. Undefined is treated as custom when the current title is non-empty.
   */
  titleIsCustom?: boolean | undefined
  /** Blueprint query id this query was created from, e.g. a Project Kanban query. */
  blueprintQueryId?: string | undefined
}

export type RootQueryPreview = ComponentPreviewTemplate<RootQueryType, ComponentProperties, LocalObject>

export type RootQueryFull = ComponentFullTemplate<RootQueryType, ComponentProperties, RootQueryData, LocalObject>

export type RootQuery = RootQueryFull | RootQueryPreview | ComponentError

// ----------------------------
// RootPage
type RootPageType = 'RootPage'
interface RootPageData extends ComponentData {
  wideLayoutMode?: boolean | undefined
}

export const BLOCK_PROPERTY_ID = 'cdde4a50-df94-40f3-944a-d0b7034f13d5'
export const ENTITY_PROPERTY_ID = 'd6bebd5b-7ad3-4d09-b87c-3e021b880903'

interface RootPageProperties extends ComponentProperties {
  [ENTITY_PROPERTY_ID]?: EntityProperty | undefined
  [BLOCK_PROPERTY_ID]?: BlocksProperty | undefined
}

export type RootPagePreview = ComponentPreviewTemplate<RootPageType, RootPageProperties, LocalObject>

export type RootPageFull = ComponentFullTemplate<RootPageType, RootPageProperties, RootPageData, LocalObject>

export type RootPage = RootPageFull | RootPagePreview | ComponentError

// ----------------------------
// RootEntity
type RootEntityType = 'RootEntity'
interface RootEntityData extends ComponentData {}

export type RootEntityPreview = ComponentPreviewTemplate<RootEntityType, ComponentProperties, LocalObject>

export type RootEntityFull = ComponentFullTemplate<RootEntityType, ComponentProperties, RootEntityData, LocalObject>

export type RootEntity = RootEntityFull | RootEntityPreview | ComponentError

// ----------------------------
// RootBlocksTemplate
type RootBlocksTemplateType = 'RootBlocksTemplate'

interface RootBlocksTemplateProperties extends ComponentProperties {
  template_blocks?: BlocksProperty | undefined
}

export type RootBlocksTemplatePreview = ComponentPreviewTemplate<
  RootBlocksTemplateType,
  RootBlocksTemplateProperties,
  LocalObject
>

export type RootBlocksTemplateFull = ComponentFullTemplate<
  RootBlocksTemplateType,
  RootBlocksTemplateProperties,
  ComponentData,
  LocalObject
>

export type RootBlocksTemplate = RootBlocksTemplateFull | RootBlocksTemplatePreview | ComponentError

// ----------------------------
// Media
export type MediaPageLayout = {
  orientation: 'portrait' | 'landscape'
  split: [number, number]
  isHidingNotesSection: boolean
  isHidingMediaSection: boolean
}

export type MediaPageLayoutDefinitions = {
  [key in Exclude<(typeof mediaTypes)[number], 'MediaVideo'>]: Record<
    MediaPageLayout['orientation'],
    { relative: number; min?: number; max?: number }
  >
}

// ----------------------------
// MediaImage
type MediaImageType = 'MediaImage'

interface MediaImageData extends ComponentData {
  /** @deprecated */
  showNotesSidebar?: boolean | undefined
  layout?: MediaPageLayout | undefined
  overlayVisible?: boolean | undefined
  overlayMinimized?: boolean | undefined
}

export interface MediaImageProperties extends ComponentProperties {
  tags?: EntityProperty | undefined
  media_imageFileResource?: ImageFileResourceProperty | undefined
  media_imageSource?: TextProperty | undefined
  media_URLReference?: URLReferenceProperty | undefined
  media_MIMEType?: TextProperty | undefined
  media_fileSize?: NumberProperty | undefined
  media_imageWidth?: NumberProperty | undefined
  media_imageHeight?: NumberProperty | undefined
  media_notes?: BlocksProperty | undefined
  media_imageCategory?: LabelProperty<ImageCategory> | undefined
  media_imageColors?: LabelProperty | undefined
}
export type MediaImagePreview = ComponentPreviewTemplate<MediaImageType, MediaImageProperties, LocalObject>

export type MediaImageFull = ComponentFullTemplate<MediaImageType, MediaImageProperties, MediaImageData, LocalObject>
export type MediaImage = MediaImageFull | MediaImagePreview | ComponentError

// ----------------------------
// MediaPDF
type MediaPDFType = 'MediaPDF'
interface MediaPDFData extends ComponentData {
  zoom?: PDFZoom | undefined
  /** @deprecated */
  zoomLevel?: number | undefined
  currentPage?: number | undefined // defaults to 1
  /** @deprecated */
  showNotesSidebar?: boolean | undefined
  layout?: MediaPageLayout | undefined
}

export interface MediaPDFProperties extends ComponentProperties {
  icon?: IconProperty | undefined
  tags?: EntityProperty | undefined
  media_previewImage?: EntityProperty | undefined
  media_pdfFileResource?: PDFFileResourceProperty | undefined
  media_MIMEType?: TextProperty | undefined
  media_fileSize?: NumberProperty | undefined
  media_pdfHasTOC?: BooleanProperty | undefined
  media_pdfNumberOfPages?: NumberProperty | undefined
  media_pdfSource?: TextProperty | undefined
  media_pdfDocumentType?: LabelProperty<PdfDocumentType> | undefined
  media_pdfTopic?: LabelProperty<PdfTopic> | undefined
  media_URLReference?: URLReferenceProperty | undefined
}

export type MediaPDFPreview = ComponentPreviewTemplate<MediaPDFType, MediaPDFProperties, LocalObject>

export type MediaPDFFull = ComponentFullTemplate<MediaPDFType, MediaPDFProperties, MediaPDFData, LocalObject>

export type MediaPDF = MediaPDFFull | MediaPDFPreview | ComponentError

// ----------------------------
// MediaAudio
type MediaAudioType = 'MediaAudio'
interface MediaAudioData extends ComponentData {
  layout?: MediaPageLayout | undefined
}

interface MediaAudioProperties extends ComponentProperties {
  tags?: EntityProperty | undefined
  media_audioFileResource?: AudioFileResourceProperty | undefined
  media_previewImage?: EntityProperty | undefined
  media_URLReference?: URLReferenceProperty | undefined
  media_audioSource?: TextProperty | undefined
  media_MIMEType?: TextProperty | undefined
  media_fileSize?: NumberProperty | undefined
  media_duration?: NumberProperty | undefined
  media_audioCategory?: LabelProperty<AudioCategory> | undefined
}

export type MediaAudioPreview = ComponentPreviewTemplate<MediaAudioType, MediaAudioProperties, LocalObject>

export type MediaAudioFull = ComponentFullTemplate<MediaAudioType, MediaAudioProperties, MediaAudioData, LocalObject>

export type MediaAudio = MediaAudioFull | MediaAudioPreview | ComponentError

// ----------------------------
// MediaVideo
type MediaVideoType = 'MediaVideo'
interface MediaVideoData extends ComponentData {
  layout?: MediaPageLayout | undefined
}

interface MediaVideoProperties extends ComponentProperties {
  tags?: EntityProperty | undefined
  media_videoFileResource?: VideoFileResourceProperty | undefined
  media_MIMEType?: TextProperty | undefined
  media_fileSize?: MediaFileSizeProperty | undefined
  media_notes?: BlocksProperty | undefined
}

export type MediaVideoPreview = ComponentPreviewTemplate<MediaVideoType, MediaVideoProperties, LocalObject>

export type MediaVideoFull = ComponentFullTemplate<MediaVideoType, MediaVideoProperties, MediaVideoData, LocalObject>

export type MediaVideo = MediaVideoFull | MediaVideoPreview | ComponentError

// ----------------------------
// MediaWebResource
type MediaWebResourceType = 'MediaWebResource'
interface MediaWebResourceProperties extends ComponentProperties {
  tags?: EntityProperty | undefined
  media_previewImage?: EntityProperty | undefined
  media_URLReference?: URLReferenceProperty | undefined
  media_iframeReference?: URLReferenceProperty | undefined
  media_host?: TextProperty | undefined
  media_notes?: BlocksProperty | undefined
  media_weblinkCategory?: LabelProperty<WeblinkContentType> | undefined
  media_weblinkTopic?: LabelProperty<WeblinkTopic> | undefined
}

interface MediaWebResourceData extends ComponentData {
  urlMetadata: Partial<UrlMetadata>
  webEmbedHidden?: boolean | undefined
  layout?: MediaPageLayout | undefined
  /** 0–1 reading position of the reader view. Absent means the top. */
  readerScrollRatio?: number | undefined
}

export type MediaWebResourcePreview = ComponentPreviewTemplate<
  MediaWebResourceType,
  MediaWebResourceProperties,
  LocalObject
>

export type MediaWebResourceFull = ComponentFullTemplate<
  MediaWebResourceType,
  MediaWebResourceProperties,
  MediaWebResourceData,
  LocalObject
>

export type MediaWebResource = MediaWebResourceFull | MediaWebResourcePreview | ComponentError

// ----------------------------
// MediaFile
type MediaFileType = 'MediaFile'
interface MediaFileData extends ComponentData {
  layout?: MediaPageLayout | undefined
}

interface MediaFileProperties extends ComponentProperties {
  icon?: IconProperty | undefined
  tags?: EntityProperty | undefined
  media_fileFileResource?: FileFileResourceProperty | undefined
  media_MIMEType?: TextProperty | undefined
  media_fileSize?: NumberProperty | undefined
}

export type MediaFilePreview = ComponentPreviewTemplate<MediaFileType, MediaFileProperties, LocalObject>

export type MediaFileFull = ComponentFullTemplate<MediaFileType, MediaFileProperties, MediaFileData, LocalObject>

export type MediaFile = MediaFileFull | MediaFilePreview | ComponentError

// ----------------------------
// MediaTweet
type MediaTweetType = 'MediaTweet'

interface MediaTweetProperties extends ComponentProperties {
  tags?: EntityProperty | undefined
  media_URLReference?: URLReferenceProperty | undefined
  twitter_userName?: TextProperty | undefined
  is_thread?: BooleanProperty | undefined
  tweet_language?: TextProperty | undefined
  media_tweets?: MediaTweetTweetsProperty | undefined
  media_notes?: BlocksProperty | undefined
  tweet_attachments?: EntityProperty | undefined
}
interface MediaTweetData extends ComponentData {
  twitterMetadata: {
    tweetId: string
    conversationId: string
  }

  layout?: MediaPageLayout | undefined
}

export type MediaTweetPreview = ComponentPreviewTemplate<MediaTweetType, MediaTweetProperties, LocalObject>

export type MediaTweetFull = ComponentFullTemplate<MediaTweetType, MediaTweetProperties, MediaTweetData, LocalObject>

export type MediaTweet = MediaTweetFull | MediaTweetPreview | ComponentError

// ----------------------------
// RootAIChat
type RootAIChatType = 'RootAIChat'

interface RootAIChatProperties extends ComponentProperties {
  tags?: EntityProperty | undefined
  chat_context?: EntityProperty | undefined
  util_aiChat?: UtilAIChatProperty | undefined
}
interface RootAIChatData extends ComponentData {
  chat?: AIAssistantChat | undefined
}

export type RootAIChatPreview = ComponentPreviewTemplate<RootAIChatType, RootAIChatProperties, LocalObject>

export type RootAIChatFull = ComponentFullTemplate<RootAIChatType, RootAIChatProperties, RootAIChatData, LocalObject>

export type RootAIChat = RootAIChatFull | RootAIChatPreview | ComponentError

// ----------------------------
// UtilDate
type UtilDateType = 'UtilDate'
export interface UtilDateProperties extends ComponentProperties {
  date?: UtilDateObjectProperty | undefined
  event?: UtilDateEventProperty | undefined
}

export interface UtilDateData extends ComponentData {
  eventCreationLoading?: boolean | undefined
  /** Snapshot of the owning object (property host or text page). Used for reminder display/open. */
  parentEntityId?: string | undefined
}

export type UtilDatePreview = ComponentPreviewTemplate<UtilDateType, UtilDateProperties, LocalObject>

export type UtilDateFull = ComponentFullTemplate<UtilDateType, UtilDateProperties, UtilDateData, LocalObject>

export type UtilDate = UtilDateFull | UtilDatePreview | ComponentError

// ----------------------------
// RootDailyNote
type RootDailyNoteType = 'RootDailyNote'
interface RootDailyNoteProperties extends ComponentProperties {
  RootDailyNote_notes?: BlocksProperty | undefined
  RootDailyNote_reviewed?: BooleanProperty | undefined
}

type RootDailyNoteData = ComponentData

export type RootDailyNotePreview = ComponentPreviewTemplate<RootDailyNoteType, RootDailyNoteProperties, LocalObject>

export type RootDailyNoteFull = ComponentFullTemplate<
  RootDailyNoteType,
  RootDailyNoteProperties,
  RootDailyNoteData,
  LocalObject
>

export type RootDailyNote = RootDailyNoteFull | RootDailyNotePreview | ComponentError

// ----------------------------
// RootTag
type RootTagType = 'RootTag'

interface RootTagProperties extends ComponentProperties {
  // tags: EntityProperty
  tag_colorTheme?: TextProperty | undefined
}

interface RootTagData extends ComponentData {
  /** @deprecated Use entity computations `number` instead. No longer written. */
  contextDependenciesCountCached?: number | undefined
  showDataViewDetails?: boolean | undefined
}

export type RootTagPreview = ComponentPreviewTemplate<RootTagType, RootTagProperties, LocalObject>

export type RootTagFull = ComponentFullTemplate<RootTagType, RootTagProperties, RootTagData, LocalObject>

export type RootTag = RootTagFull | RootTagPreview | ComponentError

// ----------------------------

// RootSimpleTable
type RootSimpleTableType = 'RootSimpleTable'
interface RootSimpleTableData extends ComponentData {
  wideLayoutMode?: boolean | undefined
}

interface RootSimpleTableProperties extends ComponentProperties {
  RootSimpleTable_coverImage?: EntityProperty | undefined // cover image...
  RootSimpleTable_simpleTableBlock?: SimpleTableBlockProperty | undefined
  RootSimpleTable_blocks?: BlocksProperty | undefined // notes, blocks content
}

export type RootSimpleTablePreview = ComponentPreviewTemplate<
  RootSimpleTableType,
  RootSimpleTableProperties,
  LocalObject
>

export type RootSimpleTableFull = ComponentFullTemplate<
  RootSimpleTableType,
  RootSimpleTableProperties,
  RootSimpleTableData,
  LocalObject
>

export type RootSimpleTable = RootSimpleTableFull | RootSimpleTablePreview | ComponentError

// ----------------------------

// RootWhiteboard
type RootWhiteboardType = 'RootWhiteboard'
export interface RootWhiteboardData extends ComponentData {
  /**
   * Canvas layout. Kept separate from the blocks themselves so blocks stay portable
   * and the canvas layer can evolve independently. See whiteboard.model.ts.
   */
  whiteboard?: WhiteboardData | undefined
  wideLayoutMode?: boolean | undefined
}

interface RootWhiteboardProperties extends ComponentProperties {
  RootWhiteboard_canvas?: BlocksProperty | undefined
  RootWhiteboard_notes?: BlocksProperty | undefined
}

export type RootWhiteboardPreview = ComponentPreviewTemplate<RootWhiteboardType, RootWhiteboardProperties, LocalObject>

export type RootWhiteboardFull = ComponentFullTemplate<
  RootWhiteboardType,
  RootWhiteboardProperties,
  RootWhiteboardData,
  LocalObject
>

export type RootWhiteboard = RootWhiteboardFull | RootWhiteboardPreview | ComponentError

/** Blocks property holding everything placed on the canvas. */
export const WHITEBOARD_CANVAS_PROPERTY_ID = 'RootWhiteboard_canvas'
export const WHITEBOARD_NOTES_PROPERTY_ID = 'RootWhiteboard_notes'

// ----------------------------

// ----------------------------
// RootAIChat
type RootTaskType = 'RootTask'

export type TaskPriority = 'low' | 'medium' | 'high'

interface RootTaskProperties extends ComponentProperties {
  status?: LabelProperty | undefined
  priority?: LabelProperty<TaskPriority> | undefined
  date?: DatetimeSimpleProperty | undefined
  deadline?: DatetimeSimpleProperty | undefined
  completed?: DatetimeSimpleProperty | undefined
}
interface RootTaskData extends ComponentData {
  taskAction?: TaskActionStampInfo
  hideTaskStats?: boolean | undefined
  showTaskLog?: boolean | undefined
}

export type RootTaskPreview = ComponentPreviewTemplate<RootTaskType, RootTaskProperties, LocalObject>

export type RootTaskFull = ComponentFullTemplate<RootTaskType, RootTaskProperties, RootTaskData, LocalObject>

export type RootTask = RootTaskFull | RootTaskPreview | ComponentError

// ----------------------------

// all
export type Component =
  | RootSpace
  | User
  | UserPersonal
  | RootStructure
  | RootDatabase
  | RootQuery
  | RootPage
  | RootEntity
  | RootBlocksTemplate
  | MediaImage
  | MediaPDF
  | MediaAudio
  | MediaVideo
  | MediaWebResource
  | MediaFile
  | RootDailyNote
  | RootTag
  | MediaTweet
  | RootAIChat
  | RootSimpleTable
  | RootWhiteboard
  | UtilDate
  | RootTask
export type ComponentFull =
  | RootSpaceFull
  | UserFull
  | UserPersonalFull
  | RootStructureFull
  | RootDatabaseFull
  | RootQueryFull
  | RootPageFull
  | RootEntityFull
  | RootBlocksTemplateFull
  | MediaImageFull
  | MediaPDFFull
  | MediaAudioFull
  | MediaVideoFull
  | MediaWebResourceFull
  | MediaFileFull
  | RootDailyNoteFull
  | RootTagFull
  | MediaTweetFull
  | RootAIChatFull
  | RootSimpleTableFull
  | RootWhiteboardFull
  | UtilDateFull
  | RootTaskFull
export type ComponentPreview =
  | RootSpacePreview
  | UserPreview
  | UserPersonalPreview
  | RootStructurePreview
  | RootDatabasePreview
  | RootQueryPreview
  | RootPagePreview
  | RootEntityPreview
  | RootBlocksTemplatePreview
  | MediaImagePreview
  | MediaPDFPreview
  | MediaAudioPreview
  | MediaVideoPreview
  | MediaWebResourcePreview
  | MediaFilePreview
  | RootDailyNotePreview
  | RootTagPreview
  | MediaTweetPreview
  | RootAIChatPreview
  | RootSimpleTablePreview
  | RootWhiteboardPreview
  | UtilDatePreview
  | RootTaskPreview
// ----------------------------
// Derived Types
export const cTypes = [
  'RootSpace',
  'User',
  'UserPersonal',
  'RootDatabase',
  'RootQuery',
  'RootPage',
  'RootStructure',
  'RootEntity',
  'RootBlocksTemplate',
  'MediaImage',
  'MediaPDF',
  'MediaAudio',
  'MediaVideo',
  'MediaWebResource',
  'MediaFile',
  'MediaTweet',
  'RootAIChat',
  'RootSimpleTable',
  'RootWhiteboard',
  'RootDailyNote',
  'RootTag',
  'UtilDate',
  'RootTask',
] as const

export type CTypes = ComponentFull['type']

export type ComponentPreviewElement = {
  id: string
  structureId: string
  title: string | undefined
  properties: ComponentFull['properties'] | undefined
}

// special groups
export const HAS_ENTRIES = ['RootDatabase'] as const
export type HasEntries = (typeof HAS_ENTRIES)[number]
