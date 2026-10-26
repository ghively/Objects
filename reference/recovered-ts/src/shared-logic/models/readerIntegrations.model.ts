import { basicStructureIcons } from '../util/basicStructures.js'
import type { Icon } from './blocks.model.js'
import type { CTypes } from './component.model.js'
import type { PropertyDefinition } from './property.model.js'

export const READWISE_CONTENT_TYPES = ['book', 'article', 'tweet', 'podcast', 'pdf', 'video', 'email', 'rss'] as const
export type ReadwiseContentType = (typeof READWISE_CONTENT_TYPES)[number]

export const readwiseBasicTypesMap: Partial<Record<ReadwiseContentType, CTypes>> = {
  tweet: 'MediaTweet',
  pdf: 'MediaPDF',
}

export const readwiseDefaultTypesMap: Partial<Record<ReadwiseContentType, CTypes>> = {
  ...readwiseBasicTypesMap,
  article: 'MediaWebResource',
  video: 'MediaWebResource',
  rss: 'MediaWebResource',
  book: 'RootPage',
  podcast: 'MediaWebResource',
  email: 'RootPage',
}

export const CUSTOM_READWISE_CONTENT_TYPES = READWISE_CONTENT_TYPES.filter((el) => !readwiseBasicTypesMap[el])

// rss or emails don't get ingested by Readwise API, epubs get ingested as articles
export const READWISE_CONTENT_TYPE_ICONS: Record<ReadwiseContentType, Icon> = {
  book: { type: 'iconify', val: 'ph-book-open' },
  podcast: { type: 'iconify', val: 'ph-microphone' },
  article: basicStructureIcons.MediaWebResource,
  tweet: basicStructureIcons.MediaTweet,
  pdf: basicStructureIcons.MediaPDF,
  video: basicStructureIcons.MediaVideo,
  rss: { type: 'iconify', val: 'ph-rss' },
  email: { type: 'iconify', val: 'ph-envelope' },
  //epub: { type: 'iconify', val: 'ph-file-pdf' },
}

export const READWISE_PROPERTIES = ['author', 'summary', 'documentNote', 'sourceUrl'] as const
export type ReadwiseProperty = (typeof READWISE_PROPERTIES)[number]

export type ReadwiseObjectSettings = {
  structureId: string
  properties: Partial<
    Record<
      ReadwiseProperty,
      {
        id: string
      }
    >
  >
}

export type ReadwiseSpaceSettings = {
  spaceId: string
  tags: string[]
  objects: Partial<Record<ReadwiseContentType, ReadwiseObjectSettings>>
  autoImportNew?: boolean | undefined
  importTriggerTag?: boolean | undefined
  tagHandlingPreference?: 'create' | 'match' | undefined
}

export type ReadwiseIntegrationSettings = {
  id: string
  type: 'readwise'
  spaces: ReadwiseSpaceSettings[]
}

export type ReaderIntegrationSettings = ReadwiseIntegrationSettings

export const isPropertyReadwiseMappable = (property: PropertyDefinition) => {
  return property.type === 'entity_description' || property.type === 'textBlock' || property.type === 'blocks'
}
