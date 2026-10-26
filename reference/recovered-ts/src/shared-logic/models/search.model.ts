import { z } from 'zod'
import { iconSchema } from './blocks.model.js'

export const mediaContentLocationSchema = z.object({
  mediaContentType: z.enum(['tweet', 'chatMessage', 'analysis', 'weblink', 'pdf']),
  id: z.string(),
  /* Source-specific range, e.g. audio time or text offsets for analysis content. */
  start: z.number().optional(),
  end: z.number().optional(),
})
export type MediaContentLocation = z.infer<typeof mediaContentLocationSchema>

export const fullTextSearchHighlightSchema = z.object({
  context: z.union([
    z.object({
      field: z.literal('title'),
    }),
    z.object({
      field: z.literal('aliases'),
    }),
    z.object({
      field: z.literal('description'),
    }),
    z.object({
      field: z.literal('properties'),
      propertyId: z.string(),
    }),
    z.object({
      field: z.literal('blocksContent'),
      propertyId: z.string(),
      blockId: z.string(),
    }),
    z.object({
      field: z.literal('mediaContent'),
      location: mediaContentLocationSchema,
    }),
    z.object({
      field: z.literal('tags'),
    }),
    z.object({
      field: z.literal('inTextTags'),
    }),
  ]),
  snippets: z.array(z.string()),
  score: z.number().optional(),
})
export type FullTextSearchHighlight = z.infer<typeof fullTextSearchHighlightSchema>

export const fullTextSearchResultSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  structureId: z.string(),
  icon: iconSchema.optional(),
  tags: z.array(z.string()).optional(),
  title: z.string().optional(),
  highlights: z.array(fullTextSearchHighlightSchema),
  textMatch: z.number().optional(),
})
export type FullTextSearchResult = z.infer<typeof fullTextSearchResultSchema>

export interface WorkerSearchConfiguration {
  spaceId: string
  additionalSpaceIds?: string[]
  mode: 'fullText' | 'title'
  skipVectorSearch?: boolean
  componentLoading?: 'full'
  excludeIds: string[]
  excludeStructureIds: string[]
  filterStructureIds?: string[]
  filterDatabaseIds?: string[]
  limits?: {
    maxResults?: number
    maxInitialResults?: number
    maxHighlights?: number
  }
  initializationMethod?: {
    type: 'recentBacklinkPickIds'
  }
}
