import { z } from 'zod'
import { SupportedLanguage } from '../util/codeEditor.js'
import { BackgroundColorTheme, TextColorTheme, themeColorSchema } from '../util/colorThemes.js'
import { Currency } from '../util/currencies.js'
import { ContentWidth } from '../util/styleValues.js'
import type { BlockHighlight } from './annotations.model.js'
import { type TaskActionStampInfo } from './api/actionQueue.api.js'
import { LinkNodeDown } from './component.model.js'
import { LocalDataViewInfo } from './dataView.model.js'
import { Token } from './tokens.model.js'

export const blockTypes = [
  'TextBlock',
  'MathBlock',
  'CodeBlock',
  'LoadingBlock',
  'HorizontalLineBlock',
  'EntityBlock',
  'GroupBlock',
  'GridBlock',
  'SimpleTableBlock',
  'SimpleTableColumn',
] as const

export type BlockTypes = (typeof blockTypes)[number]

export const iconSchema = z.union([
  z.object({
    type: z.literal('emoji'),
    val: z.string(),
    color: themeColorSchema.or(z.literal('neutral')).optional(),
    colorHex: z.string().optional(),
  }),
  z.object({
    type: z.literal('iconify'),
    val: z.string(),
    color: themeColorSchema.or(z.literal('neutral')).optional(),
    colorHex: z.string().optional(),
  }),
])
export type Icon = z.infer<typeof iconSchema>

export interface IconInterface {
  icon?: Icon | null | undefined
}

export interface ToggleInterface {
  toggle?:
    | {
        isOpen: boolean
      }
    | null
    | undefined
}

export const listTypes = ['bullet', 'alphabetical', 'numerical', 'roman'] as const
export type ListTypes = (typeof listTypes)[number]

export interface ListInterface {
  list?:
    | {
        type: ListTypes
      }
    | null
    | undefined
}
export interface TodoInterface {
  todo?:
    | {
        isDone: boolean
      }
    | undefined
}
export interface QuoteInterface {
  quote?:
    | {
        layout: 'normal' | 'standout'
      }
    | undefined
}

export const blockHierarchies = [
  {
    key: 'Base',
    val: 0,
  },

  {
    key: 'S',
    val: -1,
  },

  {
    key: 'H1',
    val: 1,
  },
  {
    key: 'H2',
    val: 2,
  },
  {
    key: 'H3',
    val: 3,
  },
  {
    key: 'H4',
    val: 4,
  },
] as const
export type BlockHierarchy = (typeof blockHierarchies)[number]

export interface HierarchyInterface {
  hierarchy?: BlockHierarchy
}

export interface StyleInterface {
  styles?: {
    contentWidth?: ContentWidth
    gridGap?: {
      horizontal?: string | undefined
    }
  }
}

export interface TextAlignmentInterface {
  textAlignment?: 'left' | 'center' | 'right'
}

export interface BlocksInterface {
  blocks?: any[]
}

// GROUPS
export const textGroup = ['TextBlock', 'CodeBlock', 'MathBlock'] as const
export type TextGroupTypes = (typeof textGroup)[number]
export const layoutGroup = ['GridBlock', 'GroupBlock'] as const
export type LayoutGroupTypes = (typeof layoutGroup)[number]

export interface BlockInterface {
  type: BlockTypes
  id: string
  aiGenerated?: boolean | undefined
}

export interface BaseBlockInterface extends BlockInterface {}

export interface ContentBlockInterface
  extends BaseBlockInterface, ToggleInterface, ListInterface, TodoInterface, BlocksInterface {}

export interface TextGroupInterface
  extends ContentBlockInterface, IconInterface, HierarchyInterface, TextAlignmentInterface, QuoteInterface {}

export interface TextBlock extends TextGroupInterface {
  type: 'TextBlock'
  tokens: Array<Token>
  formula?: string
  numberFormat?: NumberFormatConfig
  blocks: Block[]
  colorTheme?: TextColorTheme | BackgroundColorTheme | undefined
  taskAction?: TaskActionStampInfo
  highlight?: BlockHighlight | undefined
}

export interface GroupBlock extends ContentBlockInterface, TextAlignmentInterface, StyleInterface {
  blocks: Block[]
  type: 'GroupBlock'
  colorTheme?: TextColorTheme | BackgroundColorTheme | undefined
}

export interface MathBlock extends TextGroupInterface {
  type: 'MathBlock'
  text: string
  colorTheme?: TextColorTheme | BackgroundColorTheme | undefined
}

export interface HorizontalLineBlock extends BaseBlockInterface {
  type: 'HorizontalLineBlock'
}

export interface LoadingBlock extends BaseBlockInterface {
  type: 'LoadingBlock'
}

export interface CodeBlock extends TextGroupInterface {
  type: 'CodeBlock'
  lang: SupportedLanguage
  text: string
  /** @deprecated Use previewMode instead. Will be migrated automatically. */
  hideMarkdownPreview?: boolean | undefined
  previewMode?: 'edit' | 'display' | undefined
  lineWrapping?: boolean | undefined
  lockEditing?: boolean | undefined
}

export interface GridBlock extends ContentBlockInterface, StyleInterface {
  type: 'GridBlock'
  columns: Array<Block[]>
  dividers: Array<number>
  gridLayout?: 'columns' | 'grid'
  colorTheme?: TextColorTheme | BackgroundColorTheme | undefined
}

export interface SimpleTableBlock extends BaseBlockInterface {
  type: 'SimpleTableBlock'
  blocks: Array<SimpleTableColumn> // columns
  hasHeaderRow?: boolean
  hasHeaderColumn?: boolean
}

export interface SimpleTableColumn extends BaseBlockInterface {
  type: 'SimpleTableColumn'
  blocks: Array<TextBlock>
  width?: number | undefined
  colorTheme?: TextColorTheme | BackgroundColorTheme | undefined
}

export interface EmbedViewConfig {
  width?: number
  height?: number
  alignment?: 'start' | 'center' | 'end'
  caption?: string
}

export interface AudioRecordingBlockState {
  type: 'audioRecording'
  recordingId: string
  status?: 'starting' | 'recording' | 'saving' | 'chooseAction' | 'transcribing' | 'error'
  mediaEntityId?: string
  postRecordingAction?: 'choose' | 'insertTranscript'
}

// UnitGroup

export interface EntityBlock extends BlockInterface {
  type: 'EntityBlock'
  entity?: LinkNodeDown | null
  transientState?: AudioRecordingBlockState
  blocksContentIsOpen?: boolean
  showDataViewDetails?: boolean
  localDataViewInfo?: LocalDataViewInfo
  databaseViews?: any | undefined // legacy
  embedViewConfig?: EmbedViewConfig
  styles?: {
    contentWidth?: ContentWidth
  }
}

export type TextCompatibleBlock = TextBlock
export type TextGroup = TextBlock | CodeBlock | MathBlock
export type LayoutGroup = GridBlock | GroupBlock | HorizontalLineBlock

export type Block =
  LayoutGroup | TextGroup | CodeBlock | EntityBlock | GroupBlock | LoadingBlock | SimpleTableBlock | SimpleTableColumn

export interface NumberFormatConfig {
  type: 'number' | 'currency' | 'percentage' | 'progress'
  options: {
    currency?: Currency

    decimals?: {
      min?: number
      max?: number
    }

    progress?: {
      steps: number
      color: string
    }

    separators?: {
      isGroupingThousands?: boolean
    }
  }
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export const linkReferencesSchema = z.array(
  z.object({
    type: z.literal('block'),
    bId: z.string(),
  })
)
export type LinkReferences = z.infer<typeof linkReferencesSchema>
