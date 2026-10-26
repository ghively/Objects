import { z } from 'zod'
import { contentIdSchemaNarrow, structureIdSchema } from './general.api.js'
import { fullTextSearchResultSchema } from '../search.model.js'
import { weblinkInfoObject } from './resources.api.js'
import { INPUT_PROCESSING_TEXT_SIZE_LIMIT } from '../../util/general.js'
import { iconSchema } from '../blocks.model.js'
import { dateObject } from '../date.model.js'

export const publicAPiGetSpacesResponseDto = z.object({
  spaces: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      icon: iconSchema.optional(),
    })
  ),
})
export type PublicAPiGetSpacesResponseDto = z.infer<typeof publicAPiGetSpacesResponseDto>

export const publicApiGetSpaceStructureInfoDto = z.object({
  spaceid: contentIdSchemaNarrow.meta({
    description: '[Learn more](https://docs.capacities.io/developer/api#content-ids)',
  }),
})

export const publicApiGetSpaceStructureInfoResponseDto = z.object({
  structures: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        pluralName: z.string(),
        propertyDefinitions: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            name: z.string(),
            writable: z.boolean(),
          })
        ),
        labelColor: z.string(),
        collections: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
          })
        ),
      })
    )
    .meta({ description: '[Learn more](https://docs.capacities.io/developer/api#structures)' }),
})
export type PublicApiGetSpaceStructureInfoResponseDto = z.infer<typeof publicApiGetSpaceStructureInfoResponseDto>

export const publicApiSearchContentDto = z.object({
  mode: z.enum(['fullText', 'title']).optional().meta({ default: 'title' }),
  searchTerm: z.string().meta({ example: 'Artificial Intelligence' }),
  spaceIds: z.array(contentIdSchemaNarrow).meta({
    description: 'IDs of the spaces to search in. ([Learn more](https://docs.capacities.io/developer/api#content-ids))',
    example: ['c722edd0-7cee-4e3c-b5f5-27915dcdbf3b'],
  }),
  filterStructureIds: z
    .array(structureIdSchema)
    .optional()
    .meta({
      description: 'Filter for a set of structureIds. If not specified, all content will be searched',
      type: 'array',
      items: { type: 'string' },
      example: ['RootTag'],
    }),
})
export type PublicApiSearchContentDto = z.infer<typeof publicApiSearchContentDto>

export const publicApiSearchContentResponseDto = z.object({
  results: z.array(
    fullTextSearchResultSchema.pick({ id: true, spaceId: true, structureId: true, title: true, highlights: true })
  ),
})
export type PublicApiSearchContentResponseDto = z.infer<typeof publicApiSearchContentResponseDto>

export const publicApiLookupContentDto = z.object({
  searchTerm: z.string().meta({ example: 'My note' }),
  spaceId: contentIdSchemaNarrow.meta({
    description: '[Learn more](https://docs.capacities.io/developer/api#content-ids)',
  }),
})
export type PublicApiLookupContentDto = z.infer<typeof publicApiLookupContentDto>

export const publicApiLookupContentResponseDto = z.object({
  results: z.array(
    z.object({
      id: contentIdSchemaNarrow,
      structureId: structureIdSchema,
      title: z.string(),
    })
  ),
})
export type PublicApiLookupContentResponseDto = z.infer<typeof publicApiLookupContentResponseDto>

export const publicApiSaveWeblinkDto = z.object({
  spaceId: contentIdSchemaNarrow.meta({
    description: '[Learn more](https://docs.capacities.io/developer/api#content-ids)',
  }),
  url: z.url(),
  titleOverwrite: z
    .string()
    .max(500)
    .optional()
    .meta({ description: 'If not specified, the title will be fetched from the URL', example: 'My custom title' }),
  descriptionOverwrite: z
    .string()
    .max(1000)
    .optional()
    .meta({ description: 'If not specified, the description will be fetched from the URL' }),
  tags: z
    .array(z.string())
    .max(30)
    .optional()
    .meta({
      description:
        'Tags to add to the weblink. Tags need to exactly match your tag names in Capacities, otherwise they will be created.',
      example: ['todo', 'important'],
    }),
  mdText: z.string().max(INPUT_PROCESSING_TEXT_SIZE_LIMIT).optional().meta({
    description: 'Text formatted as markdown that will be added to the notes section',
    example: 'This is a **note** for the weblink',
  }),
})
export type PublicApiSaveWeblinkDto = z.infer<typeof publicApiSaveWeblinkDto>

export const publicApiSaveWeblinkResponseDto = weblinkInfoObject
export type PublicApiSaveWeblinkResponseDto = z.infer<typeof publicApiSaveWeblinkResponseDto>

const publicApiOrigin = z.enum(['commandPalette', 'mcp']).optional()
export type PublicApiOrigin = z.infer<typeof publicApiOrigin>

export const publicApiSaveToDailyNoteDto = z.object({
  spaceId: contentIdSchemaNarrow.meta({
    description: '[Learn more](https://docs.capacities.io/developer/api#content-ids)',
  }),
  mdText: z.string().max(INPUT_PROCESSING_TEXT_SIZE_LIMIT).meta({
    description: "Markdown text that should be added to today's daily note",
    example: '[ ] My important task',
  }),
  origin: publicApiOrigin.meta({
    description: 'The origin of the save action. This determines the icon added to your note.',
  }),
  noTimeStamp: z.boolean().optional().meta({
    description: 'If true, no time stamp will be added to the note',
    example: true,
  }),
})
export type PublicApiSaveToDailyNoteDto = z.infer<typeof publicApiSaveToDailyNoteDto>

const publicApiWebHighlightsHighlightDto = z.object({
  id: z.string().meta({
    description: 'ID of the highlight in WebHighlights, needs to be unique across all users',
  }),
  text: z.string().meta({
    description: 'Text of the highlight, can be Markdown',
  }),
  note: z.string().optional().meta({
    description: 'Note of the highlight, can be Markdown',
  }),
  color: z.enum(['yellow', 'orange', 'green', 'red', 'purple', 'blue']).optional(),
  colorHex: z.string().optional().meta({
    description:
      'Hex color of the highlight, needs to be in #RRGGBB format. If "color" is provided, this will be ignored.',
    example: '#FF0000',
  }),
  createdAt: z.iso.datetime().optional().meta({
    description: 'Timestamp of the highlight, needs to be in ISO 8601 format',
  }),
  tags: z.array(z.string()).optional(),
  webhighlightsUrl: z.string(),
})
export type PublicApiWebHighlightsHighlightDto = z.infer<typeof publicApiWebHighlightsHighlightDto>

export const publicApiWebHighlightsImportDto = publicApiSaveWeblinkDto.omit({ url: true }).extend({
  url: z.string().url().optional(),
  webhighlightsId: z.string().meta({
    description: 'ID in WebHighlights, needs to be unique across all users',
  }),
  webhighlightsUrl: z.string().meta({
    description: 'URL of the WebHighlights objects to open the object',
  }),
  highlights: z.array(publicApiWebHighlightsHighlightDto).optional(),
})
export type PublicApiWebHighlightsImportDto = z.infer<typeof publicApiWebHighlightsImportDto>

export const publicApiDto = {
  'get/spaces': { requestParams: undefined, requestBody: undefined, responseBody: publicAPiGetSpacesResponseDto },
  'get/space-info': {
    requestParams: publicApiGetSpaceStructureInfoDto,
    requestBody: undefined,
    responseBody: publicApiGetSpaceStructureInfoResponseDto,
  },
  'post/lookup': {
    requestParams: undefined,
    requestBody: publicApiLookupContentDto,
    responseBody: publicApiLookupContentResponseDto,
  },
  'post/save-weblink': {
    requestParams: undefined,
    requestBody: publicApiSaveWeblinkDto,
    responseBody: publicApiSaveWeblinkResponseDto,
  },
  'post/save-to-daily-note': {
    requestParams: undefined,
    requestBody: publicApiSaveToDailyNoteDto,
    responseBody: undefined,
  },
  'post/webhighlights-import': {
    requestParams: undefined,
    requestBody: publicApiWebHighlightsImportDto,
    responseBody: publicApiSaveWeblinkResponseDto,
  },
} as const

export const localApiDto = {
  'get/spaces': { requestParams: undefined, requestBody: undefined, responseBody: publicAPiGetSpacesResponseDto },
  'get/space-info': {
    requestParams: publicApiGetSpaceStructureInfoDto,
    requestBody: undefined,
    responseBody: publicApiGetSpaceStructureInfoResponseDto,
  },
  'post/search': {
    requestParams: undefined,
    requestBody: publicApiSearchContentDto,
    responseBody: publicApiSearchContentResponseDto,
  },
  'post/save-weblink': {
    requestParams: undefined,
    requestBody: publicApiSaveWeblinkDto,
    responseBody: publicApiSaveWeblinkResponseDto,
  },
  'post/save-to-daily-note': {
    requestParams: undefined,
    requestBody: publicApiSaveToDailyNoteDto,
    responseBody: undefined,
  },
  'post/webhighlights-import': {
    requestParams: undefined,
    requestBody: publicApiWebHighlightsImportDto,
    responseBody: publicApiSaveWeblinkResponseDto,
  },
  'post/save-task': {
    requestParams: undefined,
    requestBody: z.object({
      spaceId: contentIdSchemaNarrow.meta({
        description: '[Learn more](https://docs.capacities.io/developer/api#content-ids)',
      }),
      title: z
        .string()
        .max(500)
        .optional()
        .meta({ description: 'If not specified, the title will be fetched from the URL', example: 'My custom title' }),
      mdText: z.string().max(INPUT_PROCESSING_TEXT_SIZE_LIMIT).optional().meta({
        description: 'Text formatted as markdown that will be added to the notes section',
        example: 'This is a **note** for the weblink',
      }),
      priority: z.enum(['low', 'medium', 'high']).optional().meta({
        description: 'Priority of the task',
        example: 'medium',
      }),
      date: dateObject.optional().meta({
        description: 'Date of the task',
      }),
      deadline: dateObject.optional().meta({
        description: 'Deadline of the task',
      }),
    }),
    responseBody: z.object({
      spaceId: contentIdSchemaNarrow,
      id: contentIdSchemaNarrow,
    }),
  },
} as const
