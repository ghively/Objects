import type { PropertyMatch, PropertyTransformationAdditionalInfo } from '../util/ioBackbone.js'
import { BackgroundColorTheme, TextColorTheme, type ThemeColor } from '../util/colorThemes.js'
import { Icon, NumberFormatConfig } from './blocks.model.js'
import { CalendarEventInfo } from './calendarIntegrations.model.js'
import { LinkNodeDown, type RootStructureFull } from './component.model.js'
import { DateObject, DateObjectConstraints, type DateTemplateVariable } from './date.model.js'
import { TweetInfo } from './twitter.model.js'

export const systemProperties = [
  'entity_title',
  'entity_createdAt',
  'entity_lastUpdated',
  'entity_icon',
  'entity_description',
  'entity_aliases',
  'entity_tags',
  'entity_type',
  'entity_collections',
  'entity_backlinks',
  'media_audioFileResource',
  'media_videoFileResource',
  'media_pdfFileResource',
  'media_fileFileResource',
  'media_tweets',
  'media_imageFileResource',
  'util_aiChat',
  'util_dateObject',
  'util_dateEvent',
] as const

export const systemPropertyTypeToIdMap: Record<SystemProperty, string> = {
  entity_title: 'title',
  entity_createdAt: 'createdAt',
  entity_lastUpdated: 'lastUpdated',
  entity_icon: 'icon',
  entity_description: 'description',
  entity_aliases: 'aliases',
  entity_tags: 'tags',
  entity_type: 'type',
  entity_collections: 'collections',
  entity_backlinks: 'backlinks',
  media_audioFileResource: 'media_audioFileResource',
  media_videoFileResource: 'media_videoFileResource',
  media_pdfFileResource: 'media_pdfFileResource',
  media_fileFileResource: 'media_fileFileResource',
  media_tweets: 'media_tweets',
  media_imageFileResource: 'media_imageFileResource',
  util_aiChat: 'util_aiChat',
  util_dateObject: 'util_dateObject',
  util_dateEvent: 'util_dateEvent',
}

export const propertyTypes = [
  ...systemProperties,
  'text',
  'textBlock',
  'simpleTableBlock',
  'number',
  'boolean',
  'url',
  'blocks',
  'datetime',
  'datetimeSimple',
  'entity',
  'label',
] as const

export type SystemProperty = (typeof systemProperties)[number]

export const entityContexts = ['database', 'entityBlock', 'databaseView', 'page'] as const
export type EntityContexts = (typeof entityContexts)[number]

export type PropertyTypes = (typeof propertyTypes)[number]

export type PropertyDefinition =
  // PRIMITIVES
  | TextPropertyDefinition
  | NumberPropertyDefinition
  | BooleanPropertyDefinition
  | UrlPropertyDefinition
  // SYSTEM_PROPERTIES
  | SystemIconPropertyDefinition
  | SystemTitlePropertyDefinition
  | SystemDescriptionPropertyDefinition
  | SystemAliasesPropertyDefinition
  | SystemCreatedAtPropertyDefinition
  | SystemLastUpdatedPropertyDefinition
  | SystemTagsPropertyDefinition
  | SystemTypePropertyDefinition
  | SystemCollectionsPropertyDefinition
  | SystemBacklinksPropertyDefinition
  // BLOCKS and SPECIAL_BLOCKS
  // - In the future also CodeBlock, MathBlock, etc...
  | BlocksPropertyDefinition
  | TextBlockPropertyDefinition
  | SimpleTableBlockPropertyDefinition
  // DATE
  | DatetimePropertyDefinition
  | DatetimeSimplePropertyDefinition
  // ENTITIES_PROPERTIES
  | EntityPropertyDefinition
  // LABELS
  | LabelPropertyDefinition
  // MEDIA_SYSTEM_PROPERTIES
  // - general
  // - MediaImage
  | ImageFileResourcePropertyDefinition
  // - MediaAudio
  | AudioFileResourcePropertyDefinition
  // - MediaVideo
  | VideoFileResourcePropertyDefinition
  // - MediaPDF
  | PDFFileResourcePropertyDefinition
  // - MediaFile
  | FileFileResourcePropertyDefinition
  // - MediaTweet
  | MediaTweetTweetsPropertyDefinition
  | UtilAIChatPropertyDefinition
  | UtilDateObjectPropertyDefinition
  | UtilDateEventPropertyDefinition

export type Property =
  | TitleProperty
  | DescriptionProperty
  | AliasesProperty
  | IconProperty
  | TextProperty
  | EntityProperty
  | TextBlockProperty
  | SimpleTableBlockProperty
  | BlocksProperty
  | BooleanProperty
  | NumberProperty
  | DatetimeProperty
  | DatetimeSimpleProperty
  | UtilDateObjectProperty
  | UtilDateEventProperty
  | TemplateProperty
  | LabelProperty
  // MEDIA
  | URLReferenceProperty
  | MediaImageWidthProperty
  | MediaImageHeightProperty
  | MediaFileSizeProperty
  | ImageFileResourceProperty
  | AudioFileResourceProperty
  | VideoFileResourceProperty
  | PDFFileResourceProperty
  | FileFileResourceProperty
  | MediaTweetTweetsProperty
  | UtilAIChatProperty

export interface PropertyDefinitionInterface {
  id: string
  type: PropertyTypes
  dataType: PropertyDefinition['dataType']
  /** @deprecated */
  tableColWidth?: number | undefined
  // isRequired: boolean
  readOnly: boolean
  isHidden?: boolean | undefined
  isNotSearchable?: boolean | undefined
  pageViewSettings?: {
    visibility?: 'alwaysShow' | 'hideWhenEmpty' | 'hidden' | undefined // default behavior is alwaysShow
  }
  aiSettings?: {
    autoFillEnabled?: boolean | undefined
    customCommand?: string | undefined
  }
}

export interface CustomPropertyDefinitionInterface extends PropertyDefinitionInterface {
  name: { val: string | undefined }
  description: { val: string | undefined }
  icon: Icon | null
}
export interface SystemPropertyDefinitionInterface extends PropertyDefinitionInterface {
  name: { val: string | undefined }
  description: { val: string | undefined }
  icon: Icon | null
}

// PRIMITIVES

export interface TextPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'text'
  dataType: 'string'
}

export interface TextBlockPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'textBlock'
  dataType: 'blocks'
  // config: {
  //   minLength?: number | null
  //   maxLength?: number | null
  // }
}

export interface SimpleTableBlockPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'simpleTableBlock'
  dataType: 'blocks'
  // config: {
  //   maxRows?: number | undefined
  //   maxCols?: number | undefined
  // }
}

export interface UrlPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'url'
  dataType: 'url'
}
export interface NumberPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'number'
  dataType: 'number'
  numberFormat?: NumberFormatConfig
}

export interface BooleanPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'boolean'
  dataType: 'boolean'
}

// SYSTEM_PROPERTIES

export interface SystemTitlePropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'entity_title'
  dataType: 'string'
}
export interface SystemCreatedAtPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'entity_createdAt'
  dataType: 'datetime'
  mode: 'datetime'
  readOnly: true
}
export interface SystemLastUpdatedPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'entity_lastUpdated'
  dataType: 'datetime'
  mode: 'datetime'
  readOnly: true
}
export interface SystemIconPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'entity_icon'
  dataType: 'icon'
}
export interface SystemDescriptionPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'entity_description'
  dataType: 'string'
}

export interface SystemAliasesPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'entity_aliases'
  dataType: 'system'
}

export interface SystemCollectionsPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'entity_collections'
  dataType: 'system'
}

export interface SystemBacklinksPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'entity_backlinks'
  dataType: 'system'
}

export interface SystemTagsPropertyDefinition extends Omit<EntityPropertyDefinition, 'type'> {
  type: 'entity_tags'
  dataType: 'entity'
}

export interface SystemTypePropertyDefinition extends Omit<EntityPropertyDefinition, 'type'> {
  type: 'entity_type'
  dataType: 'entity' // !! keep for filter systems to work propertly
}
// BLOCKS and SPECIAL_BLOCKS

export interface BlocksPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'blocks'
  dataType: 'blocks'
}

// DATE
interface DatePropertyDefinitionBase extends CustomPropertyDefinitionInterface {
  dataType: 'datetime'
  mode: 'datetime'
  constraints?: Partial<DateObjectConstraints>
  hideCalendarEvents?: boolean | undefined
}
export interface DatetimePropertyDefinition extends DatePropertyDefinitionBase {
  type: 'datetime'
}

export interface DatetimeSimplePropertyDefinition extends DatePropertyDefinitionBase {
  type: 'datetimeSimple'
}

// ENTITIES_PROPERTIES
export interface EntityPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'entity'
  dataType: 'entity'
  isArray: boolean
  allowedStructures: string[] // ids of allowed structures
  hasFixedSet?: boolean | undefined
  fixedSet?: string[] | undefined
  propertySyncing?: {
    propertyIds: string[]
  }
}

export const labelStatusCategories = ['not-started', 'in-progress', 'blocked', 'done'] as const
export type LabelStatusCategory = (typeof labelStatusCategories)[number]

export interface LabelItem<T extends string = string> {
  id: T
  text: string
  localizationKey?: string
  icon?: Icon | undefined
  color?: ThemeColor
  statusCategory?: LabelStatusCategory
}

export interface LabelPropertyDefinition extends CustomPropertyDefinitionInterface {
  type: 'label'
  dataType: 'label'
  isArray: boolean
  set: LabelItem[]
  isStatus?: boolean
}

// MEDIA_SYSTEM_PROPERTIES
// - general
// - MediaImage
export interface ImageFileResourcePropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'media_imageFileResource'
  icon: {
    type: 'iconify'
    val: 'ph-file'
  }
  readOnly: true
  dataType: 'fileResource'
}

// - MediaAudio
export interface AudioFileResourcePropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'media_audioFileResource'
  icon: {
    type: 'iconify'
    val: 'ph-file'
  }
  readOnly: true
  dataType: 'fileResource'
}
// - MediaVideo
export interface VideoFileResourcePropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'media_videoFileResource'
  icon: {
    type: 'iconify'
    val: 'ph-file'
  }
  readOnly: true
  dataType: 'fileResource'
}
// - MediaPDF
export interface PDFFileResourcePropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'media_pdfFileResource'
  icon: {
    type: 'iconify'
    val: 'ph-file'
  }
  readOnly: true
  dataType: 'fileResource'
}
// - MediaFile
export interface FileFileResourcePropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'media_fileFileResource'
  icon: {
    type: 'iconify'
    val: 'ph-file'
  }
  readOnly: true
  dataType: 'fileResource'
}

export interface MediaTweetTweetsPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'media_tweets'
  icon: {
    type: 'iconify'
    val: 'ph-twitter-logo'
  }
  readOnly: true
  dataType: 'system'
}

export interface UtilAIChatPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'util_aiChat'
  icon: {
    type: 'iconify'
    val: 'ph-chats'
  }
  readOnly: true
  dataType: 'system'
}

export interface UtilDateObjectPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'util_dateObject'
  icon: {
    type: 'iconify'
    val: 'ph-calendar-blank'
  }
  readOnly: true
  dataType: 'system'
}

export interface UtilDateEventPropertyDefinition extends SystemPropertyDefinitionInterface {
  type: 'util_dateEvent'
  icon: {
    type: 'iconify'
    val: 'ph-calendar-blank'
  }
  readOnly: true
  dataType: 'system'
}

// UTILITY TYPES
export interface TagInterface {
  id: string
  icon: Icon | null
  name: { val: string | undefined }
  color: ThemeColor
  colorTheme: BackgroundColorTheme | TextColorTheme
}

// PROPERTY VALUE TYPES
// PRIMITIVES
export type TextProperty = { val: string | undefined }
export type NumberProperty = {
  val: number | null | undefined
}
export type BooleanProperty = {
  val: boolean | null | undefined
}
export type UrlProperty = {
  val: string | undefined
}
// SYSTEM_PROPERTIES
export type TitleProperty = { val: string | undefined }
export type DescriptionProperty = { val: string | undefined }
export type AliasesProperty = { val: { name: string }[] | undefined }
export type IconProperty = {
  val: Icon | null | undefined
} | null
// BLOCKS and SPECIAL_BLOCKS
export type BlocksProperty = { val: string }
export type TextBlockProperty = { val: string }
export type SimpleTableBlockProperty = { val: string }
// DATE
export type DatetimeProperty = {
  val: LinkNodeDown[]
  /** Set only on templates. Resolved to a DateObject when the template is applied. */
  variable?: DateTemplateVariable
}
export type DatetimeSimpleProperty = { val: DateObject | undefined }
// ENTITIES_PROPERTIES
export type EntityProperty = { val: LinkNodeDown[] }
// LABEL
export type LabelProperty<T extends string = string> = { val: T[] } // array of labelItem ids
// MEDIA_SYSTEM_PROPERTIES
// - general
export type URLReferenceProperty = { val: string }
export type MediaFileSizeProperty = { val: number }
// - MediaImage
export type MediaImageWidthProperty = { val: number }
export type MediaImageHeightProperty = { val: number }
export type MediaImageSourceProperty = { val: string }
export type ImageFileResourceProperty = {
  val: {
    mimeType: string
    urls: {
      raw: string
      small: string
      medium: string
      full: string
    }
  }
}

// - MediaAudio
export type AudioFileResourceProperty = {
  val: {
    mimeType: string

    urls: {
      raw: string
      small: string
      medium: string
      full: string
    }
  }
}
// - MediaVideo
export type VideoFileResourceProperty = {
  val: {
    mimeType: string

    urls: {
      raw: string
      small: string
      medium: string
      full: string
    }
  }
}
// - MediaPDF
export type PDFFileResourceProperty = {
  val: {
    mimeType: string
    urls: {
      raw: string
    }
  }
}
// - MediaFile
export type FileFileResourceProperty = {
  val: {
    mimeType: string
    urls: {
      raw: string
    }
  }
}
// - MediaTweet
export type MediaTweetTweetsProperty = {
  val: TweetInfo['tweets']
}

export type UtilAIChatProperty = {
  val: string | undefined
}

export type UtilDateObjectProperty = {
  val: DateObject | undefined
}

export type UtilDateEventProperty = {
  val: CalendarEventInfo | undefined
}

export type TemplateProperty = {
  val:
    | {
        name?: string | undefined
      }
    | undefined
}

// !! changes here require changes in the query injection logic (injectQueryVariables)
export const allowedQueryVariableCombinations: PropertyTypes[][] = [
  ['entity_icon'],
  ['entity_title', 'entity_description', 'text', 'textBlock', 'url'],
  ['number'],
  ['entity_createdAt', 'entity_lastUpdated', 'datetime', 'datetimeSimple'],
  ['entity', 'entity_tags'],
  ['label'],
]

export type ChangeTypePreferences = { in: string; out: string | null }[]

export type TransformationObject = {
  inStructure: RootStructureFull | undefined
  inPropertyDefinitions: PropertyDefinition[]
  outStructure: RootStructureFull | undefined
  collectionKey: string
  newCollection: { title: string; icon: Icon | null | undefined } | undefined
  entriesLength: number
  propertyMatches: PropertyMatch[] | undefined
  additionalInfo: PropertyTransformationAdditionalInfo
}
