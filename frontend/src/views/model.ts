// The view model: the layouts a data view can take, their labels and icons, which pickers offer
// which layouts, the default view of a type, and the sizes shared by every layout.
// The pickers list layouts in the behaviour catalog's order: List, Wall, Kanban, Gallery, Table,
// Embed, then Object's own Calendar, Timeline and Chart. `gallery` (the dashboard's card strip)
// is in no picker; its label only shows in tooltips and tests.
import type { Layout, SmallCardViewConfig, TypeDef, ViewState, FilterGroup } from '@/api/types'

export interface LayoutInfo {
  label: string
  /** An Iconify id. */
  icon: string
}

export const LAYOUTS: Record<Layout, LayoutInfo> = {
  list: { label: 'List', icon: 'ph-list-dashes' },
  wall: { label: 'Wall', icon: 'ph-wall' },
  kanban: { label: 'Kanban', icon: 'ph-kanban' },
  grid: { label: 'Gallery', icon: 'ph-grid-four' },
  table: { label: 'Table', icon: 'ph-table' },
  embed: { label: 'Embed', icon: 'ph-text-indent' },
  calendar: { label: 'Calendar', icon: 'ph-calendar-dots' },
  timeline: { label: 'Timeline', icon: 'ph-chart-bar-horizontal' },
  chart: { label: 'Chart', icon: 'ph-chart-pie-slice' },
  gallery: { label: 'Gallery strip', icon: 'ph-slideshow' },
}

/** M13: the layouts that draw every row themselves (no paging, no "Load more", no group headers). */
export const WHOLE_SET_LAYOUTS: ReadonlySet<Layout> = new Set<Layout>(['calendar', 'timeline', 'chart'])

/** Every layout a type page or an embedded view offers. */
export const FULL_VIEW_LAYOUTS: readonly Layout[] = ['list', 'wall', 'kanban', 'grid', 'table', 'embed', 'calendar', 'timeline', 'chart']
/** The picker without Kanban and Object's own layouts. */
export const STANDARD_LAYOUTS: readonly Layout[] = FULL_VIEW_LAYOUTS.filter(
  (l) => l !== 'kanban' && !WHOLE_SET_LAYOUTS.has(l),
)
/** The All notes picker: the standard layouts except Table (rows of every type share no columns). */
export const ALL_NOTES_LAYOUTS: readonly Layout[] = STANDARD_LAYOUTS.filter((l) => l !== 'table')

export function emptyFilterGroup(): FilterGroup {
  return { type: 'filterGroup', operator: 'and', elements: [] }
}

/** The media types default to the gallery grid; everything else to a list. */
const MEDIA_TYPE_IDS = new Set(['image', 'weblink', 'tweet'])

export function defaultViewState(type?: Pick<TypeDef, 'id'> | null): ViewState {
  return {
    viewDefinition: { dataViewLayout: type && MEDIA_TYPE_IDS.has(type.id) ? 'grid' : 'list' },
    filterGroup: emptyFilterGroup(),
    sorts: [],
    groupBy: null,
  }
}

const isSystemKind = (t: string) => t.startsWith('entity_')

/**
 * The small card's default properties: `[type, title, tags, computed_preview]`; for a DailyNote
 * `type`, `title` plus the type's first four non-system properties.
 */
export function defaultSmallCard(type: Pick<TypeDef, 'id' | 'propertyDefinitions'>): SmallCardViewConfig {
  const head = [
    { propertyType: 'entity_type', propertyId: 'type' },
    { propertyType: 'entity_title', propertyId: 'title' },
  ]
  if (type.id === 'dailynote') {
    const own = type.propertyDefinitions
      .filter((d) => !isSystemKind(d.type))
      .slice(0, 4)
      .map((d) => ({ propertyType: d.type, propertyId: d.key }))
    return { entityViewType: 'smallCard', properties: [...head, ...own] }
  }
  return {
    entityViewType: 'smallCard',
    properties: [
      ...head,
      { propertyType: 'entity_tags', propertyId: 'tags' },
      { propertyType: 'computed', propertyId: 'computed_preview' },
    ],
  }
}

/** Card widths of the gallery strip, in px. */
export const CARD_WIDTH = { phone: 168, desktop: 208 } as const
/** The gap between cards, in px (`gap-3`). */
export const CARD_GAP = 12

/**
 * How many cards fit in `width` px: floor (cards never overflow), at least 1, at most 10.
 * A non-positive width gives 1.
 */
export function columnCount(width: number, minCardWidth = 224): number {
  if (width <= 0) return 1
  return Math.min(10, Math.max(1, Math.floor((width + CARD_GAP) / (minCardWidth + CARD_GAP))))
}

/** Minimum height of a list or table row, in px. */
export const MIN_ROW_HEIGHT = 40
/** Rows added by each "Load more". */
export const LOAD_PAGE = 50
