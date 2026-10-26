import { z } from 'zod'
import { Component, ComponentError, ComponentFull, LoadingStates, cTypes } from '../component.model.js'
import { languageKeys } from '../general.model.js'
import { contentIdSchema, linkIdSchema, structureIdSchema, urlSchema } from './general.api.js'
import { dataViewEntryObjectSchema, type DataViewEntryObject } from '../dataView.model.js'
import type { GroupByGroup } from '../convolution.model.js'
import type { MediaContentRow } from '../media-content.model.js'
import { embeddingMetadataSchema } from './ai.api.js'
import { notificationSyncRowSchema } from '../notification.model.js'

export const GARBAGE_COLLECTOR_TIME_DELAY = 1000 * 60 * 60 * 24 * 30
export const TRASH_PERMANENTLY_DELETE_MAX_ITEMS = 1000

// CONTENT
export const languageKeySchema = z.enum(languageKeys)
export const contentTypeSchema = z.enum(cTypes)

export const componentIdentifierSchema = z.object({
  id: contentIdSchema,
  type: contentTypeSchema.optional(),
})

export const getContentEntityDto = componentIdentifierSchema
export type GetContentEntityDto = z.infer<typeof getContentEntityDto>

export const vectorSearchResultItemSchema = z.object({
  id: contentIdSchema,
  structureId: structureIdSchema,
  similarity: z.number(),
  metadata: embeddingMetadataSchema.optional(),
  order: z.number().int().optional(),
})
export type VectorSearchResultItem = z.infer<typeof vectorSearchResultItemSchema>

export const relatedContentGetDto = z.object({
  spaceId: contentIdSchema,
  id: contentIdSchema,
})
export type RelatedContentGetDto = z.infer<typeof relatedContentGetDto>

export const relatedContentGetResponseDto = z.object({
  elements: z.array(vectorSearchResultItemSchema).optional(),
})
export type RelatedContentGetResponseDto = z.infer<typeof relatedContentGetResponseDto>

export const vectorSearchDto = z.object({
  spaceId: contentIdSchema,
  query: z.string().min(1).max(20000),
  meta: z.object({
    type: z.enum(['fullText', 'title', 'related-content']),
  }),
})
export type VectorSearchDto = z.infer<typeof vectorSearchDto>

export const vectorSearchResponseDto = z.array(vectorSearchResultItemSchema)
export type VectorSearchResponseDto = z.infer<typeof vectorSearchResponseDto>

export const getContentSchemaCombined = componentIdentifierSchema.extend({
  lastUpdated: z.iso.datetime().optional(),
})

export const entriesGetDto = z.object({
  id: contentIdSchema,
  existingEntryIds: z.array(contentIdSchema).optional(),
  structureId: contentIdSchema.optional(),
})
export type EntriesGetDto = z.infer<typeof entriesGetDto>

export const contextGetDto = z.object({
  dependencyCount: z.number().optional(),
  existingDependencyIds: z.array(contentIdSchema).optional(),
})
export type ContextGetDto = z.infer<typeof contextGetDto>

export const idListGetDto = z.object({
  ids: z.array(contentIdSchema),
})

export const contentDuplicateDto = z.object({
  type: z.literal('weblink'),
  url: urlSchema,
  spaceId: contentIdSchema,
  elseCreate: z.boolean(),
})
export type ContentDuplicateDto = z.infer<typeof contentDuplicateDto>

// SYNC
const linkNodeLinkTemplateDto = z.object({
  id: linkIdSchema,
  createdAt: z.iso.datetime(),
  data: z.record(z.string(), z.any().optional()),
})

const linkNodeUpDto = z.object({
  id: contentIdSchema,
  link: linkNodeLinkTemplateDto.extend({
    type: z.enum(['Database']),
    policies: z.array(z.record(z.string(), z.any().optional())),
  }),
})
const linkNodeDownDto = z.object({
  id: contentIdSchema,
  link: linkNodeLinkTemplateDto.extend({
    type: z.enum(['Dependency']),
  }),
})
// TODO schema in syncer validate every linkNodeDown before syncing

const contentPolicyDto = z.record(z.string(), z.any().optional()) // TODO schema
const fileResourceDto = z.record(z.string(), z.any().optional()) // TODO schema

const componentFullDto = z.object({
  id: contentIdSchema,
  type: contentTypeSchema,
  structureId: structureIdSchema,
  loadingState: z.literal(LoadingStates.Full),
  deleteRequested: z.boolean().optional(),
  databases: z.array(linkNodeUpDto),
  policies: z.array(contentPolicyDto),
  lastUpdated: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  properties: z.record(z.string(), z.any().optional()),
  data: z.record(z.string(), z.any().optional()),
  linkNodes: z.array(linkNodeDownDto),
  fileResource: fileResourceDto.optional(),
  local: z.any().optional(),
})
const componentErrorDto = z.object({
  id: contentIdSchema,
  type: contentTypeSchema.optional(),
  structureId: structureIdSchema,
  loadingState: z.literal(LoadingStates.Error),
  deleteRequested: z.boolean().optional(),
  databases: z.array(linkNodeUpDto).optional(),
  policies: z.array(contentPolicyDto).optional(),
  lastUpdated: z.iso.datetime().optional(),
  createdAt: z.iso.datetime().optional(),
  properties: z.record(z.string(), z.any().optional()).optional(),
  data: z.record(z.string(), z.any().optional()).optional(),
  linkNodes: z.array(linkNodeDownDto).optional(),
  fileResource: fileResourceDto.optional(),
  local: z.any().optional(),
})
const componentPreviewDto = z.object({
  id: contentIdSchema,
  type: contentTypeSchema,
  structureId: structureIdSchema,
  loadingState: z.literal(LoadingStates.Preview),
  deleteRequested: z.boolean().optional(),
  databases: z.array(linkNodeUpDto),
  policies: z.array(contentPolicyDto),
  lastUpdated: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  properties: z.record(z.string(), z.any().optional()),
  local: z.any().optional(),
})

const componentSyncDto = z.union([componentFullDto, componentErrorDto])
export const componentDto = z.union([componentFullDto, componentErrorDto, componentPreviewDto])
export type ComponentDto = z.infer<typeof componentDto>

export const componentTreeGetReturnDto = z.object({
  components: z.array(componentDto).optional(),
  serverTime: z.iso.datetime(),
})
export type ComponentTreeGetReturnDto = Omit<z.infer<typeof componentTreeGetReturnDto>, 'components'> & {
  components: Component[] | undefined
}

export const entriesReturnDto = z.object({
  components: z.array(componentDto),
  entryIds: z.array(contentIdSchema),
})

export const idListResponseDto = z.object({
  components: z.array(componentDto),
  ids: z.array(contentIdSchema),
})

export const spaceTagsQueryResponseDto = z.object({
  ids: z.array(contentIdSchema),
})
export type SpaceTagsQueryResponseDto = z.infer<typeof spaceTagsQueryResponseDto>

export const spaceQueryResponseDto = z.object({
  components: z.array(componentDto),
  entryObjects: z.array(dataViewEntryObjectSchema),
  allGroups: z.array(z.any()).optional(), // TODO schema
  randomSet: z
    .object({
      id: z.string(),
      selectedIndices: z.array(z.number()),
    })
    .optional(),
})
export type SpaceQueryResponse = Omit<
  z.infer<typeof spaceQueryResponseDto>,
  'components' | 'entryObjects' | 'allGroups'
> & {
  entryObjects: DataViewEntryObject[]
  allGroups?: GroupByGroup[] | undefined
  components: Component[]
}

export const syncInputOldDto = z.object({
  syncClientId: z.string(),
  components: z.array(componentSyncDto),
})
export type SyncInputOldDto = z.infer<typeof syncInputOldDto>

export type SyncInputOld = Omit<SyncInputOldDto, 'components'> & {
  components: (ComponentFull | ComponentError)[]
}

export const syncInputDto = z.object({
  syncClientId: z.string(),
  elements: z.array(
    z.object({
      spaceId: contentIdSchema,
      content: componentSyncDto,
    })
  ),
})
export type SyncInputDto = z.infer<typeof syncInputDto>

export type SyncInput = Omit<SyncInputDto, 'elements'> & {
  elements: {
    spaceId: string
    content: ComponentFull | ComponentError
  }[]
}

const getSpacesChangesDto = z.object({
  spaceId: contentIdSchema,
  lastUpdated: z.iso.datetime(),
  isSpaceInit: z.boolean().optional(),
})
export type GetSpacesChangesDto = z.infer<typeof getSpacesChangesDto>

export const getSpaceChangesResponseDto = z.union([
  z.object({
    type: z.enum(['changes']),
    newLastUpdated: z.iso.datetime(),
    components: z.array(componentDto),
    // Ids permanently removed since the client's cursor. Kept off `components` so older clients do not store them as missing.
    hardDeletedIds: z.array(contentIdSchema).optional(),
  }),
  z.object({
    type: z.enum(['state', 'state-changes']),
    newLastUpdated: z.iso.datetime(),
    elements: z.array(z.object({ id: contentIdSchema, lastUpdated: z.iso.datetime() })),
    hardDeletedIds: z.array(contentIdSchema).optional(),
  }),
])
export type GetSpaceChangesResponseDto = z.infer<typeof getSpaceChangesResponseDto>

export type GetSpaceChangesResponse =
  | {
      type: 'changes'
      newLastUpdated: string
      components: Component[]
      mediaContentRows: MediaContentRow[]
      hardDeletedIds?: string[]
    }
  | {
      type: 'state' | 'state-changes'
      newLastUpdated: string
      elements: { id: string; type?: 'media-content' | undefined; lastUpdated: string }[]
      hardDeletedIds?: string[]
    }

export const getSpacesChangesBulkDto = z.object({
  syncClientId: z.string(),
  version: z.number()?.optional(),
  spaces: z.array(getSpacesChangesDto),
  /** User-scoped (not per-space) incremental cursor for the notification sync lane. */
  notificationsSince: z.iso.datetime().optional(),
})
export type GetSpacesChangesBulkDto = z.infer<typeof getSpacesChangesBulkDto>

export const getSpacesChangesBulkResponseDto = z.object({
  spaces: z.record(z.string(), getSpaceChangesResponseDto),
  notifications: z.array(notificationSyncRowSchema).optional(),
  notificationsLastUpdated: z.iso.datetime().optional(),
})
export type GetSpacesChangesBulkResponseDto = z.infer<typeof getSpacesChangesBulkResponseDto>

export type GetSpacesChangesBulkResponse = {
  spaces: Record<string, GetSpaceChangesResponse>
  notifications?: GetSpacesChangesBulkResponseDto['notifications']
  notificationsLastUpdated?: string
}

export const spaceTrashGetDto = z.object({
  spaceId: contentIdSchema,
  lastUpdated: z.iso.datetime().optional(),
})
export type SpaceTrashGetDto = z.infer<typeof spaceTrashGetDto>

const spaceTrashElement = z.object({
  id: contentIdSchema,
  structureId: structureIdSchema,
  lastUpdated: z.iso.datetime(),
  title: z.string(),
})
export type SpaceTrashElement = z.infer<typeof spaceTrashElement>

export const spaceTrashGetResponseDto = z.object({
  elements: z.array(spaceTrashElement),
  lastUpdated: z.iso.datetime(),
})
export type SpaceTrashGetResponseDto = z.infer<typeof spaceTrashGetResponseDto>

export const undoDeleteGetDto = z.object({
  spaceId: contentIdSchema,
  id: contentIdSchema,
  syncClientId: z.string(),
})
export type UndoDeleteGetDto = z.infer<typeof undoDeleteGetDto>

export const undoDeleteGetResponseDto = z.object({
  component: componentDto.optional(),
})
export type UndoDeleteGetResponseDto = z.infer<typeof undoDeleteGetResponseDto>

export const permanentDeleteTrashDto = z.object({
  spaceId: contentIdSchema,
  ids: z.array(contentIdSchema).max(TRASH_PERMANENTLY_DELETE_MAX_ITEMS),
})
export type PermanentDeleteTrashDto = z.infer<typeof permanentDeleteTrashDto>

export const spaceDeleteDto = z.object({
  spaceId: contentIdSchema,
})
export type SpaceDeleteDto = z.infer<typeof spaceDeleteDto>

export const indexSpaceDto = z.object({
  spaceId: contentIdSchema,
})
export type IndexSpaceDto = z.infer<typeof indexSpaceDto>
