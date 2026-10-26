import type { AIAssistantChat } from './ai.model.js'
import type { RootAIChatFull, RootAIChatPreview } from './component.model.js'
import type { DataViewDefinition } from './dataView.model.js'
import type { LabelItem } from './property.model.js'
import type { LocalSpaceQueryInfo } from './query.model.js'
import type { TaskContentViewViews } from './tasks.model.js'

export const WELCOME_SPACE_TEMPLATE_ID = 'rootspace-welcome-en'
export const WELCOME_SPACE_TEMPLATE_ID_LEGACY = 'rootspace-welcome-de'

// !! fixed section keys required for api validation (portal tab allowlist must include all keys).
// `explore` allows freeform subsections (AI chat ids); other empty lists mean no subsections.
// `overview` / `find` / `notifications` are phone-only dashboard pages (see spaceDashboardSectionIsPhoneOnly).
// Coordinate portal/API allowlist when adding keys — otherwise synced tabs may strip unknown sections.
export const spaceDashboardSectionDefinition = {
  calendar: [],
  explore: [],
  firstSteps: [],
  search: [],
  shared: [],
  graph: [],
  allNotes: [],
  overview: [],
  find: [],
  notifications: [],
} as const

export type SpaceDashboardSection = keyof typeof spaceDashboardSectionDefinition

/** Phone-only sections — desktop/tablet readers must remap/ignore these. */
export function spaceDashboardSectionIsPhoneOnly(section: SpaceDashboardSection | string | undefined): boolean {
  return section === 'overview' || section === 'find' || section === 'notifications'
}

/** Sections whose subsection is an open string (e.g. entity id), not a fixed allowlist. */
export function spaceDashboardSectionAllowsFreeformSubsection(section: SpaceDashboardSection): boolean {
  return section === 'explore'
}

export type AIDashboardConfig = {
  activeChatId?: string | undefined
  hideChatsPanel?: boolean | undefined
}

export interface TabEntry {
  tabId: string
  createdAt: string
  lastOpened: string
  persistent: boolean
  breadcrumbs: string[][]
  spaceDashboardSection?: SpaceDashboardSection | undefined
  spaceDashboardSubsection?: string | undefined
  sidepanel?: Array<SidepanelEntry>
  sidepanelLayout?: {
    area2Size?: number
    area3Size?: number
  }
  hideSidepanel?: boolean | undefined
  pinned?: boolean | undefined
  /** @deprecated */
  rightSidebarIsOpen?: boolean | undefined
  dailyNotesView?: 'day' | 'week' | 'rolling' | 'month'
  dailyNotesActiveDay?: string // date string in UTC
  localSpaceQueryInfo: LocalSpaceQueryInfo | undefined
}

export interface SidepanelEntry {
  id: string
  isOpen: boolean
  panelArea?: 'area1' | 'area2' | 'area3'
  isPersistent?: boolean
  aiAssistantChat?: AIAssistantChat | undefined
  localSpaceQueryInfo?: LocalSpaceQueryInfo | undefined
  relatedContentViewDefinition?: DataViewDefinition | undefined
}

export interface SidepanelEntryWidthAIChatObject extends SidepanelEntry {
  entity: RootAIChatPreview | RootAIChatFull
}

export interface OldTabEntry {
  id: string
  persistent: boolean
  backlinks: Array<string[]>
  scrollPosition: number
}

export interface TabGroup {
  tabs: Array<OldTabEntry>
  activeTabId: string | undefined
}

export interface SpaceTabData {
  tabGroups: Array<TabGroup>
  focusedGroupIndex: number | undefined
}

export type OverviewModes = 'spaces' | 'workspace_pages' | 'databases'

export type ToggleTreeElement = {
  id: string
  nodes: ToggleTreeElement[]
}

export type ToggleTree = {
  [x in OverviewModes]: ToggleTreeElement[]
}

export type SpaceTaskCustomization = {
  statusLabelSet?: LabelItem[]
  entityContentViewsViewDefinition?: DataViewDefinition
  entityTaskView?: TaskContentViewViews
}

export type GraphViewCustomization = {
  /** Types to keep. Empty means every type. A type listed here and in `excludeStructureIds` is still excluded. */
  filterStructureIds?: string[] | undefined
  excludeStructureIds?: string[] | undefined
  showCompletedTasks?: boolean
  showMinimalNodes?: boolean
  hideLargeNodes?: boolean
  hideDates?: boolean
  /** Drop a hidden object that only sits between shown objects, and the links through it. */
  hideIndirectLinks?: boolean
  /** Tag page: the neighborhood of that tag. */
  showTagsNetwork?: boolean
  /** Global graph: every tag, and a link wherever one object points at two tags. */
  showSpaceTagsNetwork?: boolean
}
