// The view model: layouts, defaults and the layout constants shared by every data view.
// Labels, icons and flags come from the layout table; `gallery` has no catalogued
// label (no picker offers it), so its label is ours and only used in tooltips and tests.
import type { Layout, SmallCardViewConfig, TypeDef, ViewState, FilterGroup } from '@/api/types'

export interface LayoutInfo {
  label: string
  /** An Iconify id. */
  icon: string
  requiresGroupByEntity: boolean
  hasSeparateBlocksGroup: boolean
}

export const LAYOUTS: Record<Layout, LayoutInfo> = {
  list: { label: 'List', icon: 'ph-list-dashes', requiresGroupByEntity: true, hasSeparateBlocksGroup: false },
  grid: { label: 'Gallery', icon: 'ph-grid-four', requiresGroupByEntity: false, hasSeparateBlocksGroup: true },
  wall: { label: 'Wall', icon: 'ph-wall', requiresGroupByEntity: false, hasSeparateBlocksGroup: false },
  table: { label: 'Table', icon: 'ph-table', requiresGroupByEntity: true, hasSeparateBlocksGroup: false },
  embed: { label: 'Embed', icon: 'ph-text-indent', requiresGroupByEntity: true, hasSeparateBlocksGroup: false },
  kanban: { label: 'Kanban', icon: 'ph-kanban', requiresGroupByEntity: false, hasSeparateBlocksGroup: false },
  // Our string: no picker offers this layout; it is set only by code (dashboard sections).
  gallery: { label: 'Gallery strip', icon: 'ph-slideshow', requiresGroupByEntity: true, hasSeparateBlocksGroup: true },
}

export const STANDARD_LAYOUTS: readonly Layout[] = ['list', 'grid', 'wall', 'table', 'embed']
export const FULL_VIEW_LAYOUTS: readonly Layout[] = [...STANDARD_LAYOUTS, 'kanban']
export const ALL_NOTES_LAYOUTS: readonly Layout[] = ['list', 'grid', 'wall', 'embed']

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
