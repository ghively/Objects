import { z } from 'zod'
import { Block, linkReferencesSchema } from './blocks.model.js'
import { LinkNode } from './component.model.js'
import { ConvolutionSet, type GroupByGroup } from './convolution.model.js'
import { dateResolutionSchema, futureScheduleEntrySchema, occurrenceLogEntrySchema } from './date.model.js'
import { labelStatusCategories, PropertyDefinition, type PropertyTypes } from './property.model.js'
import type { ColumnCalculationKind } from './queryCalculation.model.js'
import { FullTextSearchHighlight, fullTextSearchHighlightSchema } from './search.model.js'
import type { SmallCardViewConfig } from './structureView.model.js'

export const dataViewLayoutTypeDefinitions = {
  list: {
    key: 'list',
    icon: {
      type: 'iconify',
      val: 'ph-list-dashes',
    },
    requiresGroupByType: false,
    requiresGroupByEntity: true,
    hasSeparateBlocksGroup: false,
  },
  wall: {
    key: 'wall',
    icon: {
      type: 'iconify',
      val: 'ph-wall',
    },
    requiresGroupByEntity: false,
    hasSeparateBlocksGroup: false,
  },
  kanban: {
    key: 'kanban',
    icon: {
      type: 'iconify',
      val: 'ph-kanban',
    },
    requiresGroupByEntity: false,
    hasSeparateBlocksGroup: false,
  },
  grid: {
    key: 'grid',
    icon: {
      type: 'iconify',
      val: 'ph-grid-four',
    },
    requiresGroupByEntity: false,
    hasSeparateBlocksGroup: true,
  },
  table: {
    key: 'table',
    icon: {
      type: 'iconify',
      val: 'ph-table',
    },
    requiresGroupByEntity: true,
    hasSeparateBlocksGroup: false,
  },
  embed: {
    key: 'embed',
    icon: {
      type: 'iconify',
      val: 'ph-text-indent',
    },
    requiresGroupByEntity: true,
    hasSeparateBlocksGroup: false,
  },
  gallery: {
    key: 'gallery',
    icon: {
      type: 'iconify',
      val: 'ph-slideshow',
    },
    requiresGroupByEntity: true,
    hasSeparateBlocksGroup: true,
  },
} as const

export type DataViewLayoutTypes = keyof typeof dataViewLayoutTypeDefinitions

export const standardDataViewLayoutTypes: DataViewLayoutTypes[] = ['list', 'grid', 'wall', 'table', 'embed']
export const fullViewDataViewLayoutTypes: DataViewLayoutTypes[] = ['list', 'grid', 'wall', 'table', 'embed', 'kanban']
/** Built-in All notes dashboard — table is omitted, same as Shared content. */
export const allNotesDataViewLayouts = [
  'list',
  'grid',
  'wall',
  'embed',
] as const satisfies readonly DataViewLayoutTypes[]
export type AllNotesDataViewLayout = (typeof allNotesDataViewLayouts)[number]

export enum DataViewLoadingState {
  Loading = 'loading',
  NotLoaded = 'notLoaded',
  Full = 'full',
  Error = 'error',
}

export type TableViewConfig = {
  wrapAllContent: boolean | false
  pinnedColumnIndex: number | undefined
  properties: TableViewColumnConfig[]
}

export type TableViewColumnConfig = {
  id: string
  type: PropertyTypes
  isHidden: boolean
  wrapContent: boolean | false
  colWidth: number // rem
  calculation?: ColumnCalculationKind | undefined
}

export type GroupByCustomizationConfig = {
  groups: GroupCustomizationConfig[]
  hideByDefault?: boolean | undefined
  hideEmptyGroups?: boolean | undefined
  /**
   * Group order for a query that is rebuilt instead of stored.
   * `manual` uses `groups` order. Saved queries keep this on `groupBy.sortOption`.
   */
  sortOption?: string | undefined
}

export type GroupCustomizationConfig = {
  id: string
  isHidden: boolean
  isClosed: boolean
}

/** One calculation for a property. Shared by every layout of the view. */
export type DataViewCalculation = {
  propertyId: string
  structureId: string
  kind: ColumnCalculationKind
}

export type DataViewDefinition = {
  dataViewLayout: DataViewLayoutTypes
  /** @deprecated */
  groupedByType?: boolean | undefined
  /** @deprecated */
  tableConfig?: TableViewConfig | undefined
  tableConfigs?: Partial<{ [key: string]: TableViewConfig }> | undefined
  groupByConfig?: GroupByCustomizationConfig | undefined
  /** Shown in the table footer and, where they fit, in group headers. */
  calculations?: DataViewCalculation[] | undefined
  /**
   * Small card overwrites for this view, keyed by object type id.
   * A missing key means that type still uses its object type default.
   * A key is written only after "Use default" is turned off, as a copy of that default.
   * Other keys stay, so a query that later names a different type keeps the right copy.
   */
  smallCardViewConfigs?: Partial<Record<string, SmallCardViewConfig>> | undefined
}

const dataViewDateInfoSchema = z.object({
  utilDateId: z.string(),
  dateResolution: dateResolutionSchema,
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime().optional(),
})
export type DataViewDateInfo = z.infer<typeof dataViewDateInfoSchema>

export const dataViewEntryObjectSchema = z.object({
  id: z.string(),
  structureId: z.string(),
  createdAt: z.string().optional(),
  dailyNoteReviewed: z.boolean().optional(),
  taskStatusCategory: z.enum(labelStatusCategories).optional(),
  taskOccurrenceLogEntry: occurrenceLogEntrySchema.optional(),
  taskFutureScheduleEntry: futureScheduleEntrySchema.optional(),
  dateInfo: dataViewDateInfoSchema.optional(),
  tagDistance: z.number().optional(),
  properties: z
    .array(
      z.object({
        propertyId: z.string(),
        linkIds: z.array(z.string()),
        linkCreationDate: z.string().optional(),
        highlight: fullTextSearchHighlightSchema.optional(),
      })
    )
    .optional(),
  blocks: z
    .array(
      z.object({
        propertyId: z.string(),
        blockId: z.string(),
        blockType: z.string().optional(),
        linkIds: z.array(z.string()).optional(),
        linkCreationDate: z.string().optional(),
        highlight: fullTextSearchHighlightSchema.optional(),
        linkReferences: linkReferencesSchema.optional(),
      })
    )
    .optional(),
  mediaContents: z
    .array(
      z.object({
        highlight: fullTextSearchHighlightSchema.optional(),
      })
    )
    .optional(),
  groups: z.array(z.any()).optional(), // TODO schema
})
export type DataViewEntryObject = Omit<z.infer<typeof dataViewEntryObjectSchema>, 'groups'> & {
  groups?: GroupByGroup[] | undefined
}

export type DataViewGroupConfig = {
  groupStructureId: string | undefined
  /** Set when a gallery group-by was split into one row per object type. */
  galleryCompanionStructureId?: string | undefined
}

export type DataViewGroupingResult = {
  allGroups: GroupByGroup[]
  groupObjects: {
    id: string
    group: GroupByGroup
    entryObjects: DataViewEntryObject[]
    config: DataViewGroupConfig
  }[]
}

export type LocalDataViewInfo = {
  viewDefinition: DataViewDefinition
  filterGroup: ConvolutionSet['filterGroup']
  sorts: ConvolutionSet['sorts']
  groupBy: ConvolutionSet['groupBy']
}

export type EntityReferenceObject =
  | {
      linkType: 'property'
      propertyId: string
      propertyDefinition?: PropertyDefinition | undefined
      linkNodes: LinkNode[] // will also provide timestamp
      highlight?: FullTextSearchHighlight | undefined
    }
  | {
      linkType: 'block'
      propertyId: string
      propertyDefinition?: PropertyDefinition | undefined
      linkNodes: LinkNode[] // will also provide timestamp
      blockId: string
      block: Block
      blockPath: Block[]
      blocks?: Block[]
      highlight?: FullTextSearchHighlight | undefined
    }
  | {
      propertyId?: undefined
      linkType: 'mediaContent'
      highlight?: FullTextSearchHighlight | undefined
    }

export type DataViewState = {
  heights: Map<string, number>
  offsets: {
    top: number
    left: number
  }
}

export function initializeDataViewState(): DataViewState {
  return {
    heights: new Map(),
    offsets: {
      top: 0,
      left: 0,
    },
  }
}
