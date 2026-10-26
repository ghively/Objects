import { z } from 'zod'
import { CAPACITIES_AI_AUTO_MODEL_KEY, CAPACITIES_AI_CHEAP_MODEL_KEY, type ExtendedUIMessage } from '../ai.model.js'
import { titleReplacementDecisionSchema } from './image.api.js'
import { IMAGE_CATEGORY_KEYS } from '../../util/basicStructures.js'

// MODEL CONTEXT
export const aiModelContextModelKeyDto = z.union([
  z.literal(CAPACITIES_AI_AUTO_MODEL_KEY),
  z.literal(CAPACITIES_AI_CHEAP_MODEL_KEY),
  z.string().min(1),
])
export const aiModelContextDto = z.object({
  modelKey: aiModelContextModelKeyDto,
  keyId: z.union([z.string(), z.null(), z.undefined()]).optional(),
})
export type AIModelContextDto = z.infer<typeof aiModelContextDto>

export const systemPromptKeySchema = z.enum([
  'ai-chat',
  'question-answer',
  'panel-command',
  'autofill-single',
  'autofill-multiple',
  'autofill-tags',
  'chat-title',
])
export type SystemPromptKey = z.infer<typeof systemPromptKeySchema>

// STREAM TEXT AND CHAT COMPLETION
export const aiUiAssistantChatCompletionGetDto = z.object({
  modelContext: aiModelContextDto,
  toolKeys: z.array(z.string()).optional(), // should be string to accept outdated tools as well
  id: z.string().optional(),
  messages: z.any(),
  trigger: z.any().optional(),
  messageId: z.string().optional(),
  systemPromptKey: z.literal('ai-chat').optional(),
  systemPromptParams: z
    .object({
      objectTypesList: z.string().optional(),
      userLanguage: z.string().optional(),
    })
    .optional(),
  /** Client will auto-execute write tools; portal treats them like client reads. */
  autoApproveWrites: z.boolean().optional(),
})

export type AiUiAssistantChatCompletionGetDto = Omit<z.infer<typeof aiUiAssistantChatCompletionGetDto>, 'messages'> & {
  messages: ExtendedUIMessage[]
}

// RESUMABLE UI MESSAGE STREAM (AI SDK resume streams)
//
// Client sends only the latest user message + a stable chat id. Server is expected to
// persist messages and associate an `activeStreamId` with this chat id so the client
// can later resume via GET `${api}/${id}/stream`.
export const aiUiMessageStreamSendDto = z.object({
  id: z.string(),
  message: z.any(),
  config: aiUiAssistantChatCompletionGetDto,
})

export type AiUiMessageStreamSendDto = Omit<z.infer<typeof aiUiMessageStreamSendDto>, 'message' | 'config'> & {
  message: ExtendedUIMessage
  config: AiUiAssistantChatCompletionGetDto
}

// GENERATE OBJECT
const aiGenerateObjectSchemaKey = z.enum([
  'propertyAutofillText',
  'propertyAutofillEntityList',
  'propertyAutofillNumber',
  'propertyAutofillDatetime',
  'propertyAutofillTags',
  'propertyAutofillMultiple',
  'mediaImageAnalysis',
  'mediaAudioAnalysis',
  'mediaAudioTranscriptSummary',
  'mediaWeblinkAnalysis',
  'mediaPdfAnalysis',
  'chatTitle',
  'externalSourceType',
  'aiRequestClassification',
  'exploreSuggestions',
])

export const aiExploreSuggestionsDto = z.object({
  spaceId: z.string().min(1),
})
export const aiExploreSuggestionsResponseDto = z.object({
  suggestions: z.array(z.string().min(1).max(200)),
})
export type AiExploreSuggestionsResponseDto = z.infer<typeof aiExploreSuggestionsResponseDto>
export type AIGenerateObjectSchemaKey = z.infer<typeof aiGenerateObjectSchemaKey>

const boundedTextSchema = z.string().max(8000)
const httpUrlSchema = z.url().max(2048)
const optionalCoverDimensionSchema = z
  .number()
  .int()
  .max(20000)
  .nullish()
  .transform((value) => (value && value > 0 ? value : undefined))

export const aiGenerateObjectCoverImageSchema = z.object({
  url: httpUrlSchema,
  title: z.string().max(300).optional(),
  width: optionalCoverDimensionSchema,
  height: optionalCoverDimensionSchema,
  sourceUrl: httpUrlSchema.optional(),
  attribution: z.string().max(500).optional(),
})

export const MIN_RELEASE_YEAR = 1880
export const MAX_RELEASE_YEAR = 2100

const externalSourceLocatorSchema = z.string().trim().min(1).max(300)

const movieLookupSchema = z
  .object({
    imdbId: z
      .string()
      .trim()
      .regex(/^tt\d{7,8}$/i)
      .optional(),
    title: externalSourceLocatorSchema.optional(),
    year: z.number().int().min(MIN_RELEASE_YEAR).max(MAX_RELEASE_YEAR).optional(),
  })
  .refine((lookup) => Boolean(lookup.imdbId || lookup.title), {
    message: 'Title lookup requires an IMDb id or a title',
  })

const bookLookupSchema = z
  .object({
    isbn: z
      .string()
      .trim()
      .min(10)
      .max(22)
      .refine((value) => /^(?:\d{9}[\dXx]|\d{13})$/.test(value.replace(/[-\s]/g, '')), {
        message: 'Book lookup ISBN must be ISBN-10 or ISBN-13',
      })
      .optional(),
    title: externalSourceLocatorSchema.optional(),
    author: externalSourceLocatorSchema.optional(),
  })
  .refine((lookup) => Boolean(lookup.isbn || lookup.title), {
    message: 'Book lookup requires an ISBN or a title',
  })

export const aiGenerateObjectExternalSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('movie'),
    lookup: movieLookupSchema,
  }),
  z.object({
    type: z.literal('series'),
    lookup: movieLookupSchema,
  }),
  z.object({
    type: z.literal('book'),
    lookup: bookLookupSchema,
  }),
])
export type AIGenerateObjectExternalSource = z.infer<typeof aiGenerateObjectExternalSourceSchema>
export type ExternalSourceType = AIGenerateObjectExternalSource['type']
export type ExternalSourceOf<T extends ExternalSourceType> = Extract<AIGenerateObjectExternalSource, { type: T }>
const externalSourceTypeSchema = z.enum(['movie', 'series', 'book'] as const satisfies readonly ExternalSourceType[])

export const externalSourceProviders = ['omdb', 'isbndb'] as const
export type ExternalSourceProvider = (typeof externalSourceProviders)[number]

const aiGenerateSystemPromptKey = z.enum([
  'autofill-single',
  'autofill-multiple',
  'autofill-tags',
  'chat-title',
  'external-source-type',
])
export type AIGenerateSystemPromptKey = z.infer<typeof aiGenerateSystemPromptKey>

// Media image analysis response schema (used with runGenerateObject when mediaType is set)
const mediaImageAnalysisSchema = z.object({
  ocr: z
    .object({
      fullText: z.string().max(8000),
      hasText: z.boolean(),
      blocks: z
        .array(
          z.object({
            text: z.string(),
            boundingBox: z.object({
              x: z.number().min(0),
              y: z.number().min(0),
              width: z.number().min(0),
              height: z.number().min(0),
            }),
            confidence: z.number().min(0).max(1),
          })
        )
        .optional(),
    })
    .optional(),
  title: z.string().max(120).optional(),
  titleShouldBeReplaced: titleReplacementDecisionSchema.optional(),
  shortDescription: z.string().optional(),
  category: z
    .object({
      primary: z.enum(IMAGE_CATEGORY_KEYS),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  colors: z
    .array(
      z.object({
        hex: z.string(),
        name: z.string(),
        category: z.string(),
      })
    )
    .min(1)
    .max(5)
    .optional(),
})

const mediaAudioSegmentSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  speaker: z.string().optional(),
  text: z.string(),
})

const mediaAudioTranscriptionSchema = z.object({
  fullText: z.string(),
  segments: z.array(mediaAudioSegmentSchema).optional(),
  language: z.string().optional(),
  speakerCount: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

// Media audio analysis response schema
const mediaAudioAnalysisSchema = z.object({
  transcription: mediaAudioTranscriptionSchema.optional(),
  title: z.string().optional(),
  shortDescription: z.string().optional(),
  summary: z.string().optional(),
  category: z
    .object({
      primary: z.string(),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
})

/**
 * Vertex response schema for multimodal chunk transcription.
 * Segments may be empty when a chunk has no intelligible speech (silence/noise).
 */
export const mediaAudioChunkVertexResponseSchema = z
  .object({
    transcription: mediaAudioTranscriptionSchema.extend({
      segments: z.array(mediaAudioSegmentSchema),
    }),
  })
  .strict()

/** First chunk should include metadata used for the overall asset. */
export const mediaAudioChunkFirstVertexResponseSchema = z
  .object({
    transcription: mediaAudioTranscriptionSchema.extend({
      segments: z.array(mediaAudioSegmentSchema),
    }),
    title: z.string(),
    category: z.object({
      primary: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  })
  .strict()

/** Final post-merge transcript pass should only return these two fields. */
const mediaAudioTranscriptSummarySchema = z.object({
  shortDescription: z.string(),
  summary: z.string(),
})

const mediaWeblinkCategoryValueSchema = z.union([
  z.string(),
  z
    .object({
      primary: z.string().optional(),
      label: z.string().optional(),
      value: z.string().optional(),
      name: z.string().optional(),
      category: z.string().optional(),
      type: z.string().optional(),
      key: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .loose(),
])

// Media weblink analysis response schema
const mediaWeblinkAnalysisSchema = z.object({
  canonicalUrl: z.string().optional(),
  category: z
    .object({
      contentType: mediaWeblinkCategoryValueSchema,
      topic: mediaWeblinkCategoryValueSchema,
    })
    .optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  publishedDate: z.string().optional(),
  duration: z.union([z.object({ seconds: z.number(), formatted: z.string() }), z.null()]).optional(),
  shortSummary: z.string().optional(),
  transcript: z.string().optional(),
  contentTruncated: z.boolean().optional(),
  keywords: z.array(z.string()).optional(),
  grounding: z
    .object({
      retrievalStatus: z.enum(['success', 'partial', 'failed', 'unknown']).optional(),
      evidenceSnippets: z.array(z.string()).optional(),
      warnings: z.array(z.string()).optional(),
    })
    .optional(),
  extractionError: z.string().optional(),
})

// ============================================================================
// PDF analysis schemas
// ----------------------------------------------------------------------------
// Chunk pass: Gemini native PDF input -> page-aware markdown transcript.
// Final pass (text-only merge): derived metadata for the whole document.
// ============================================================================
const mediaPdfPageSchema = z.object({
  pageNumber: z.number().int().min(1), // 1-indexed relative to the original PDF
  markdown: z.string(),
  hasText: z.boolean().optional(),
})

/** Vertex response schema for a single multimodal PDF chunk transcription. */
export const mediaPdfChunkVertexResponseSchema = z
  .object({
    pages: z.array(mediaPdfPageSchema),
    language: z.string().optional(),
  })
  .strict()

const mediaPdfCategoryValueSchema = z.object({
  primary: z.string(),
  confidence: z.number().min(0).max(1),
})

/** Final text-only merge pass: derived fields for the whole document. */
const mediaPdfAnalysisSchema = z.object({
  title: z.string().optional(),
  titleShouldBeReplaced: z
    .object({
      shouldReplace: z.boolean(),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  shortDescription: z.string().optional(),
  summary: z.string().optional(),
  category: z
    .object({
      documentType: mediaPdfCategoryValueSchema,
      topic: mediaPdfCategoryValueSchema,
    })
    .optional(),
  keywords: z.array(z.string()).optional(),
})

export const aiGenerateObjectSchemas = {
  propertyAutofillText: z.object({
    value: z.string(),
  }),
  propertyAutofillEntityList: z.object({
    // max() is not supported by claude
    entities: z.array(z.string()),
  }),
  propertyAutofillNumber: z.object({
    value: z.number().nullable(),
  }),
  propertyAutofillDatetime: z.object({
    value: z
      .object({
        dateResolution: z.enum(['time', 'day']),
        startTime: z.string(),
        endTime: z.string().nullable(),
      })
      .nullable(),
  }),
  propertyAutofillTags: z.object({
    tags: z.array(z.string()),
  }),
  propertyAutofillMultiple: z.object({
    propertyValues: z
      .array(
        z.object({
          propertyName: z.string().max(200),
          type: z.enum(['text', 'entityList', 'number', 'datetime']),
          value: z.union([
            boundedTextSchema.nullable(),
            z.array(z.string().max(200)).max(40).nullable(),
            z.number().nullable(),
            z
              .object({
                dateResolution: z.enum(['time', 'day']),
                startTime: z.string().max(40),
                endTime: z.string().max(40).nullable(),
              })
              .nullable(),
          ]),
        })
      )
      .max(40),
    coverImage: aiGenerateObjectCoverImageSchema.optional(),
  }),
  mediaImageAnalysis: mediaImageAnalysisSchema,
  /** Used for portal `generateContent` audio JSON (`responseJsonSchema`) and `runGenerateObject` validation. */
  mediaAudioAnalysis: mediaAudioAnalysisSchema,
  mediaAudioTranscriptSummary: mediaAudioTranscriptSummarySchema,
  mediaWeblinkAnalysis: mediaWeblinkAnalysisSchema,
  mediaPdfAnalysis: mediaPdfAnalysisSchema,
  chatTitle: z.object({
    title: z.string().min(1).max(60),
  }),
  externalSourceType: z.object({
    sourceType: externalSourceTypeSchema.nullable(),
    perObjectSourceTypes: z.array(externalSourceTypeSchema),
  }),
  aiRequestClassification: z.object({
    route: z.enum(['direct', 'orchestrated']),
    usageMode: z.enum(['budget', 'medium']),
    getTagsAndCollections: z.boolean(),
    getObjectTypeShape: z.boolean(),
    createObject: z.boolean(),
    updateObjectProperties: z.boolean(),
    deleteObject: z.boolean(),
    createTask: z.boolean(),
    appendObjectContent: z.boolean(),
    supportAgent: z.boolean(),
    webSearchAgent: z.boolean(),
    knowledgeManagementConsultantAgent: z.boolean(),
  }),
  exploreSuggestions: z.object({
    suggestions: z.array(z.string().min(1).max(200)).min(3).max(5),
  }),
} satisfies Record<AIGenerateObjectSchemaKey, z.ZodType>

export type MediaImageAnalysisOutput = z.infer<typeof mediaImageAnalysisSchema>
export type MediaAudioAnalysisOutput = z.infer<typeof mediaAudioAnalysisSchema>
export type MediaAudioTranscriptSummaryOutput = z.infer<typeof mediaAudioTranscriptSummarySchema>
export type MediaWeblinkAnalysisOutput = z.infer<typeof mediaWeblinkAnalysisSchema>
export type MediaPdfChunkVertexResponse = z.infer<typeof mediaPdfChunkVertexResponseSchema>
export type MediaPdfAnalysisOutput = z.infer<typeof mediaPdfAnalysisSchema>
export type AIRequestClassificationOutput = {
  route: 'direct' | 'orchestrated'
  usageMode: 'budget' | 'medium'
  getTagsAndCollections: boolean
  getObjectTypeShape: boolean
  createObject: boolean
  updateObjectProperties: boolean
  deleteObject: boolean
  createTask: boolean
  appendObjectContent: boolean
  supportAgent: boolean
  webSearchAgent: boolean
  knowledgeManagementConsultantAgent: boolean
}

export type AIGenerateObjectOutputFor<K extends AIGenerateObjectSchemaKey> = z.infer<
  (typeof aiGenerateObjectSchemas)[K]
>
export type AIGenerateObjectOutput = AIGenerateObjectOutputFor<AIGenerateObjectSchemaKey>

export const aiGenerateObjectMediaTypeSchema = z.enum(['image', 'audio', 'weblink', 'pdf'])
export type AIGenerateObjectMediaType = z.infer<typeof aiGenerateObjectMediaTypeSchema>

/** Optional provider options when using runGenerateObject with mediaType (e.g. image: maxOutputTokens, temperature, topP). */
export const aiGenerateObjectMediaProviderOptionsSchema = z
  .object({
    maxOutputTokens: z.number().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
  })
  .optional()
export type AIGenerateObjectMediaProviderOptions = z.infer<typeof aiGenerateObjectMediaProviderOptionsSchema>

export const aiGenerateObjectDto = z.object({
  modelContext: aiModelContextDto.optional(),
  prompt: z.string(),
  schemaKey: aiGenerateObjectSchemaKey,
  /** Optional multimodal messages (e.g. text + image URL). When set, used instead of prompt for generateText. */
  messages: z.array(z.any()).optional(),
  /** When passed to runGenerateObject, selects media model, budget, and provider options. */
  mediaType: aiGenerateObjectMediaTypeSchema.optional(),
  /** Provider options (maxOutputTokens, temperature, topP) applied when mediaType is set. */
  mediaProviderOptions: aiGenerateObjectMediaProviderOptionsSchema.optional(),
  //todo: deprecate - temporary patch: pre-resolved model for non-CapacitiesAI classifier
  resolvedModel: z.any().optional(),
  resolvedProvider: z.string().optional(),
  resolvedModelKey: z.string().optional(),
  systemPromptKey: aiGenerateSystemPromptKey.optional(),
  systemPromptParams: z
    .object({
      objectTypesList: z.string().optional(),
      userLanguage: z.string().optional(),
      context: z.string().optional(),
      propertyType: z.string().optional(),
      propertyDefinitions: z.array(z.any()).optional(),
      entitySelections: z.array(z.any()).optional(),
    })
    .loose()
    .optional(),
})
export type AIGenerateObjectDto = z.infer<typeof aiGenerateObjectDto>

/** Generate-object grounded in an external source. Only reachable through the property autofill queue. */
export const aiGroundedGenerateObjectDto = aiGenerateObjectDto.omit({ mediaType: true }).extend({
  externalSource: aiGenerateObjectExternalSourceSchema,
})
export type AIGroundedGenerateObjectDto = z.infer<typeof aiGroundedGenerateObjectDto>

export const AI_PROPERTY_AUTOFILL_CONTEXT_MAX_LENGTH = 100_000
export const AI_PROPERTY_AUTOFILL_ENTITY_SET_LIMIT = 1000
export const AI_PROPERTY_AUTOFILL_MAX_PROPERTIES = 40

export const aiPropertyAutofillTriggerSchema = z.enum(['manual', 'create'])
export type AIPropertyAutofillTrigger = z.infer<typeof aiPropertyAutofillTriggerSchema>

/** The portal picks the external source from the object type and `generate.systemPromptParams.context`. */
export const aiPropertyAutofillJobDto = z.object({
  requestId: z.uuid(),
  entityId: z.string().min(1).max(100),
  structureId: z.string().min(1).max(100),
  spaceId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  trigger: aiPropertyAutofillTriggerSchema,
  /** Maps each prompt property name back to its definition. `definitionId` is `collections` for collection membership. */
  properties: z
    .array(
      z.object({
        definitionId: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        entitySet: z
          .array(z.object({ id: z.string().min(1).max(100), title: z.string().max(300) }))
          .max(AI_PROPERTY_AUTOFILL_ENTITY_SET_LIMIT)
          .optional(),
      })
    )
    .min(1)
    .max(AI_PROPERTY_AUTOFILL_MAX_PROPERTIES),
  generate: aiGroundedGenerateObjectDto.omit({ externalSource: true }).extend({
    schemaKey: z.literal('propertyAutofillMultiple'),
    systemPromptKey: z.literal('autofill-multiple'),
    systemPromptParams: z
      .object({
        context: z.string().max(AI_PROPERTY_AUTOFILL_CONTEXT_MAX_LENGTH),
        propertyDefinitions: z.array(z.any()).max(AI_PROPERTY_AUTOFILL_MAX_PROPERTIES),
      })
      .loose(),
  }),
})
export type AIPropertyAutofillJobDto = z.infer<typeof aiPropertyAutofillJobDto>

/** No `requestId` when no external source fits the object and nothing was enqueued. */
export const aiPropertyAutofillJobResponseDto = z.object({ requestId: z.uuid().optional() })
export type AIPropertyAutofillJobResponseDto = z.infer<typeof aiPropertyAutofillJobResponseDto>

/** Finds a cover image for any object type: dedicated sources first, then a web image search. */
export const aiCoverImageAutofillJobDto = z.object({
  requestId: z.uuid(),
  entityId: z.string().min(1).max(100),
  structureId: z.string().min(1).max(100),
  spaceId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  customCommand: z.string().max(2000).optional(),
})
export type AICoverImageAutofillJobDto = z.infer<typeof aiCoverImageAutofillJobDto>

/** No `requestId` when the object already has a cover or its type has no cover property. */
export const aiCoverImageAutofillJobResponseDto = z.object({ requestId: z.uuid().optional() })
export type AICoverImageAutofillJobResponseDto = z.infer<typeof aiCoverImageAutofillJobResponseDto>

export const aiCommandStreamDto = z.discriminatedUnion('systemPromptKey', [
  z.object({
    systemPromptKey: z.literal('panel-command'),
    systemPromptParams: z.object({
      commandId: z.string(),
      context: z.string().optional(),
      variables: z.record(z.string(), z.string()).optional(),
      objectTypesList: z.string().optional(),
      userLanguage: z.string().optional(),
    }),
    modelContext: aiModelContextDto.optional(),
  }),
  z.object({
    systemPromptKey: z.literal('question-answer'),
    systemPromptParams: z.object({
      question: z.string(),
      objectTypesList: z.string().optional(),
      userLanguage: z.string().optional(),
    }),
    modelContext: aiModelContextDto.optional(),
  }),
])
export type AICommandStreamDto = z.infer<typeof aiCommandStreamDto>

// STREAM CONTROL
export const aiStopStreamDto = z.object({
  activeStreamId: z.string().nullable().optional(),
  assistantMessage: z.any().optional(),
})
export type AIStopStreamDto = z.infer<typeof aiStopStreamDto>

export const aiResumeWithDecisionDto = z.object({
  approve: z.boolean().optional(),
  toolCallId: z.string().min(1).optional(),
})
export type AIResumeWithDecisionDto = z.infer<typeof aiResumeWithDecisionDto>

const embeddingsLimitSchema = z.number().int().min(0).max(50)

export const embeddingsSearchSimilarDto = z
  .object({
    spaceId: z.string(),
    queryText: z.string().optional(),
    queryEmbedding: z.array(z.number()).optional(),
    limit: embeddingsLimitSchema.optional(),
  })
  .refine(
    (data) => (data.queryText ? 1 : 0) + (data.queryEmbedding ? 1 : 0) === 1,
    'Provide exactly one of queryText or queryEmbedding'
  )
export type EmbeddingsSearchSimilarDto = z.infer<typeof embeddingsSearchSimilarDto>

export const embeddingMetadataSchema = z.object({
  blockLocation: z
    .object({
      propertyDefinitionId: z.string(),
      blockStartId: z.string(),
      blockEndId: z.string(),
    })
    .optional(),
  audioLocation: z
    .object({
      segmentStart: z.number(),
      segmentEnd: z.number(),
    })
    .optional(),
  weblinkLocation: z
    .object({
      paragraphStart: z.number(),
      paragraphEnd: z.number(),
    })
    .optional(),
  pdfLocation: z
    .object({
      pageStart: z.number(),
      pageEnd: z.number(),
    })
    .optional(),
})
export type EmbeddingMetadata = z.infer<typeof embeddingMetadataSchema>

export const embeddingContentRowDto = z.object({
  entityId: z.string(),
  spaceId: z.string(),
  structureId: z.string(),
  type: z.string(),
  lastUpdated: z.union([z.date(), z.string()]),
  meta: embeddingMetadataSchema.optional(),
  entityEmbedOrder: z.number(),
})
export type EmbeddingContentRowDto = z.infer<typeof embeddingContentRowDto>

export const embeddingsSearchSimilarResponseDto = z.array(
  z.object({
    entityId: z.string(),
    similarity: z.number(),
    order: z.number(),
    metadata: embeddingMetadataSchema.optional(),
  })
)
export type EmbeddingsSearchSimilarResponseDto = z.infer<typeof embeddingsSearchSimilarResponseDto>

// IMAGE GENERATION
export const aiImageGenerationStyles = [
  'photo-realistic',
  'cinematic',
  'illustration',
  'painting',
  'animation',
  'isometric-3d',
  'vintage',
] as const
export type AIImageGenerationStyle = (typeof aiImageGenerationStyles)[number]

export const aiGenerateImageDto = z.object({
  prompt: z.string().min(1).max(480),
  aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional(),
  style: z.enum(aiImageGenerationStyles).optional(),
})
export type AIGenerateImageDto = z.infer<typeof aiGenerateImageDto>

export const aiGenerateImageResponseDto = z.object({
  imageBase64: z.string(),
  mimeType: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type AIGenerateImageResponseDto = z.infer<typeof aiGenerateImageResponseDto>
