/**
 * Single source of truth for the Capacities **public HTTP API** object property model:
 *
 * - Which {@link PropertyDefinition} `type` values are exposed on read (`GET /object`, `GET /space/structures`)
 *   vs patchable on write (`PATCH /object`) — see `PUBLIC_API_*_PROPERTY_TYPES` and the `isPublicApi*Definition` helpers.
 * - Constrained upsert property-id whitelists for built-in media types — see
 *   `PUBLIC_API_BASIC_STRUCTURE_UPSERTABLE_PROPERTY_IDS`.
 * - Zod schemas for JSON property payloads (explicit `type` + nested payload).
 *
 * When you change how properties appear in the API, update **this file first** (schemas + type lists), then add
 * portal transforms in `routes/publicApi/public-api-properties-mapping.ts` and wire them from
 * `public-api-object-functions.ts`.
 */
import type { CTypes } from '../models/component.model.js'
import type { PropertyDefinition } from '../models/property.model.js'
import { z } from 'zod'
import { apiTokenSchema, writableApiTokenSchema } from './public-api-blocks.js'
import { datePayloadReadableSchema, datePayloadWritableSchema } from './public-api-date.js'
import { apiIconSchema } from './public-api-icon.js'

export { datePayloadReadableSchema, datePayloadWritableSchema, dateResolutionSchema } from './public-api-date.js'
export type { ApiDatePayload, WritableApiDatePayload } from './public-api-date.js'

/** Documented alias cap in request/response schemas (enforced in portal mapping). */
const ALIASES_SCHEMA_MAX_LENGTH = 8

// ── Internal definition filters (`PropertyDefinition.type`) ───────────────────

/** Returned on `GET /object` and listed per structure on `GET /space/structures`. */
export const PUBLIC_API_READABLE_PROPERTY_TYPES = [
  'entity_title',
  'text',
  'entity_description',
  'number',
  'boolean',
  'url',
  'datetimeSimple',
  'datetime',
  'label',
  'entity',
  'entity_tags',
  'entity_aliases',
  'entity_icon',
  'entity_createdAt',
  'entity_lastUpdated',
  'textBlock',
] as const

export type PublicApiReadablePropertyType = (typeof PUBLIC_API_READABLE_PROPERTY_TYPES)[number]

const READABLE_TYPE_SET = new Set<string>(PUBLIC_API_READABLE_PROPERTY_TYPES)

/**
 * May appear in `PATCH /object` when `readOnly` is false.
 * Excludes last-updated timestamp system field (`entity_lastUpdated`).
 */
export const PUBLIC_API_WRITABLE_PROPERTY_TYPES = [
  'entity_title',
  'text',
  'entity_description',
  'number',
  'boolean',
  'url',
  'datetimeSimple',
  'datetime',
  'label',
  'entity',
  'entity_tags',
  'entity_aliases',
  'entity_icon',
  'entity_createdAt',
  'textBlock',
] as const

export type PublicApiWritablePropertyType = (typeof PUBLIC_API_WRITABLE_PROPERTY_TYPES)[number]

const WRITABLE_TYPE_SET = new Set<string>(PUBLIC_API_WRITABLE_PROPERTY_TYPES)

/**
 * Built-in (basic) structures that may be updated via `PATCH /object`, but only for the listed
 * property definition ids. System / media-derived fields (URL, file size, page count, MIME type,
 * duration, host, …) are intentionally omitted.
 *
 * Structures not listed here that are `publicApiPatchable` (e.g. RootPage, custom types) keep the
 * normal writable-type rules. Keep in sync with `publicApiPatchable` in structureHeuristicsBackbone.
 *
 * Property ids match `basicStructures.ts`.
 */
export const PUBLIC_API_BASIC_STRUCTURE_UPSERTABLE_PROPERTY_IDS = {
  MediaWebResource: ['title', 'tags', 'description', 'media_weblinkCategory', 'media_weblinkTopic'],
  MediaPDF: ['title', 'tags', 'description', 'icon', 'media_pdfDocumentType', 'media_pdfTopic'],
  MediaImage: ['title', 'tags', 'description', 'media_imageCategory'],
  MediaFile: ['title', 'tags', 'description', 'icon'],
  MediaAudio: ['title', 'tags', 'description', 'icon', 'media_audioCategory'],
  MediaTweet: ['title', 'tags', 'description'],
} as const satisfies Partial<Record<CTypes, readonly string[]>>

export type PublicApiConstrainedUpsertStructureId = keyof typeof PUBLIC_API_BASIC_STRUCTURE_UPSERTABLE_PROPERTY_IDS

const CONSTRAINED_UPSERT_STRUCTURE_IDS = new Set<string>(
  Object.keys(PUBLIC_API_BASIC_STRUCTURE_UPSERTABLE_PROPERTY_IDS)
)

export function isPublicApiConstrainedUpsertStructure(structureId: string): boolean {
  return CONSTRAINED_UPSERT_STRUCTURE_IDS.has(structureId)
}

/** Structure ids that use constrained property upsert (same keys as the whitelist map). */
export function getPublicApiConstrainedUpsertStructureIds(): PublicApiConstrainedUpsertStructureId[] {
  return Object.keys(PUBLIC_API_BASIC_STRUCTURE_UPSERTABLE_PROPERTY_IDS) as PublicApiConstrainedUpsertStructureId[]
}

export function getPublicApiUpsertablePropertyIdsForStructure(structureId: string): readonly string[] | undefined {
  if (!isPublicApiConstrainedUpsertStructure(structureId)) return undefined
  return PUBLIC_API_BASIC_STRUCTURE_UPSERTABLE_PROPERTY_IDS[structureId as PublicApiConstrainedUpsertStructureId]
}

export function isPublicApiReadablePropertyDefinition(def: PropertyDefinition): boolean {
  if (def.isHidden) return false
  return READABLE_TYPE_SET.has(def.type)
}

/**
 * Readable + writable type + `!readOnly` — used for `writable` on structure rows and PATCH guards.
 * When `structureId` is a constrained basic type, the property id must also be on that type's whitelist.
 */
export function isPublicApiWritablePropertyDefinition(def: PropertyDefinition, structureId?: string): boolean {
  if (!isPublicApiReadablePropertyDefinition(def)) return false

  const upsertableIds = structureId ? getPublicApiUpsertablePropertyIdsForStructure(structureId) : undefined
  if (upsertableIds) {
    if (!upsertableIds.includes(def.id)) return false
  }

  if (def.type === 'entity_createdAt') return true
  if (def.readOnly) return false
  return WRITABLE_TYPE_SET.has(def.type)
}

export const PUBLIC_API_PROPERTY_VALUE_TYPES = [
  'title',
  'text',
  'number',
  'boolean',
  'url',
  'date',
  'label',
  'entity',
  'aliases',
  'icon',
  'createdAt',
  'lastUpdatedAt',
  'richText',
] as const

export type PublicApiPropertyValueType = (typeof PUBLIC_API_PROPERTY_VALUE_TYPES)[number]

export function publicApiPropertyValueTypeForDefinition(
  def: PropertyDefinition
): PublicApiPropertyValueType | undefined {
  switch (def.type) {
    case 'entity_title':
      return 'title'
    case 'text':
    case 'entity_description':
      return 'text'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'url':
      return 'url'
    case 'datetimeSimple':
    case 'datetime':
      return 'date'
    case 'label':
      return 'label'
    case 'entity':
    case 'entity_tags':
      return 'entity'
    case 'entity_aliases':
      return 'aliases'
    case 'entity_icon':
      return 'icon'
    case 'entity_createdAt':
      return 'createdAt'
    case 'entity_lastUpdated':
      return 'lastUpdatedAt'
    case 'textBlock':
      return 'richText'
    default:
      return undefined
  }
}

// ── JSON property value schemas (`GET` / `PATCH` payloads) ────────────────────

export const titlePropertyValueSchema = z
  .object({
    type: z.literal('title'),
    title: z.object({
      value: z.string().nullable().describe('Plain-text title value.'),
    }),
  })
  .meta({
    id: 'ApiTitleProperty',
    description: 'Title property value.',
  })

export const writableTitlePropertyValueSchema = titlePropertyValueSchema.meta({
  id: 'WritableApiTitleProperty',
  description: 'Writable title property value.',
})

export const textPropertyValueSchema = z
  .object({
    type: z.literal('text'),
    text: z.object({
      value: z.string().nullable().describe('Plain-text value.'),
    }),
  })
  .meta({
    id: 'ApiTextProperty',
    description: 'Plain-text property value.',
  })

export const writableTextPropertyValueSchema = textPropertyValueSchema.meta({
  id: 'WritableApiTextProperty',
  description: 'Writable plain-text property value.',
})

export const numberPropertyValueSchema = z
  .object({
    type: z.literal('number'),
    number: z.object({
      value: z.number().nullable().describe('Numeric value.'),
    }),
  })
  .meta({
    id: 'ApiNumberProperty',
    description: 'Number property value.',
  })

export const writableNumberPropertyValueSchema = numberPropertyValueSchema.meta({
  id: 'WritableApiNumberProperty',
  description: 'Writable number property value.',
})

export const booleanPropertyValueSchema = z
  .object({
    type: z.literal('boolean'),
    boolean: z.object({
      value: z.boolean().nullable().describe('Boolean value.'),
    }),
  })
  .meta({
    id: 'ApiBooleanProperty',
    description: 'Boolean property value.',
  })

export const writableBooleanPropertyValueSchema = booleanPropertyValueSchema.meta({
  id: 'WritableApiBooleanProperty',
  description: 'Writable boolean property value.',
})

export const urlPropertyValueSchema = z
  .object({
    type: z.literal('url'),
    url: z.object({
      value: z.string().nullable().describe('URL string.'),
    }),
  })
  .meta({
    id: 'ApiUrlProperty',
    description: 'URL property value.',
  })

export const writableUrlPropertyValueSchema = urlPropertyValueSchema.meta({
  id: 'WritableApiUrlProperty',
  description: 'Writable URL property value.',
})

export const datePropertyValueSchema = z
  .object({
    type: z.literal('date'),
    date: datePayloadReadableSchema,
  })
  .meta({
    id: 'ApiDateProperty',
    description: 'Date property value.',
  })

export const datePropertyWritableSchema = z
  .object({
    type: z.literal('date'),
    date: datePayloadWritableSchema,
  })
  .meta({
    id: 'WritableApiDateProperty',
    description: 'Writable date property value.',
  })

export const labelOptionSchema = z
  .object({
    id: z.string().describe('Stable option id from the property definition.'),
    name: z.string().describe('Display label.'),
    color: z.string().optional().describe('Theme color key for the option, if set.'),
  })
  .meta({
    id: 'ApiLabelOption',
    description: 'Selectable option for single and multi label properties.',
  })

export type ApiLabelOption = z.infer<typeof labelOptionSchema>

/**
 * Normalizes stored label option ids for API read/write.
 * Single-select (`isMultiSelect === false`) keeps at most one id (first unique).
 */
export function normalizeLabelOptionIds(ids: string[], isMultiSelect: boolean): string[] {
  const unique = [...new Set(ids)]
  if (!isMultiSelect) {
    return unique.length === 0 ? [] : [unique[0]]
  }
  return unique
}

export const labelPropertyValueSchema = z
  .object({
    type: z.literal('label'),
    label: z.array(labelOptionSchema).min(0).describe('Selected label options (empty array clears the field).'),
  })
  .meta({
    id: 'ApiLabelProperty',
    description: 'Label property value.',
  })

export const writableLabelPropertyValueSchema = z
  .object({
    type: z.literal('label'),
    label: z.array(labelOptionSchema).min(0).describe('Selected label options (empty array clears the field).'),
  })
  .meta({
    id: 'WritableApiLabelProperty',
    description: 'Writable label property value.',
  })

export const entityTargetSchema = z
  .object({
    id: z.string().min(1).describe('Referenced object id.'),
  })
  .meta({
    id: 'ApiEntityTarget',
    description: 'Referenced object in an entity property.',
  })

export const entityPropertyValueSchema = z
  .object({
    type: z.literal('entity'),
    entity: z.array(entityTargetSchema).min(0).describe('Linked objects by id (empty array clears the field).'),
  })
  .meta({
    id: 'ApiEntityProperty',
    description: 'Entity property value.',
  })

export const writableEntityPropertyValueSchema = entityPropertyValueSchema.meta({
  id: 'WritableApiEntityProperty',
  description: 'Writable entity property value.',
})

export const aliasesPropertyValueSchema = z
  .object({
    type: z.literal('aliases'),
    aliases: z.object({
      value: z
        .array(z.string())
        .max(ALIASES_SCHEMA_MAX_LENGTH)
        .describe(`Alias strings (at most ${ALIASES_SCHEMA_MAX_LENGTH} per object).`),
    }),
  })
  .meta({
    id: 'ApiAliasesProperty',
    description: 'Aliases property value.',
  })

export const writableAliasesPropertyValueSchema = aliasesPropertyValueSchema.meta({
  id: 'WritableApiAliasesProperty',
  description: 'Writable aliases property value.',
})

export const iconPropertyValueSchema = z
  .object({
    type: z.literal('icon'),
    icon: z.object({
      value: apiIconSchema.nullable().describe('Icon value, or null to clear the icon.'),
    }),
  })
  .meta({
    id: 'ApiIconProperty',
    description: 'Icon property value.',
  })

export const writableIconPropertyValueSchema = iconPropertyValueSchema.meta({
  id: 'WritableApiIconProperty',
  description: 'Writable icon property value.',
})

export const createdAtPropertyValueSchema = z
  .object({
    type: z.literal('createdAt'),
    createdAt: z.object({
      value: z.string().describe('ISO 8601 timestamp when the object was created.'),
    }),
  })
  .meta({
    id: 'ApiCreatedAtProperty',
    description: 'Object creation timestamp property value.',
  })

export const writableCreatedAtPropertyValueSchema = createdAtPropertyValueSchema.meta({
  id: 'WritableApiCreatedAtProperty',
  description: 'Writable object creation timestamp property value.',
})

export const lastUpdatedAtPropertyValueSchema = z
  .object({
    type: z.literal('lastUpdatedAt'),
    lastUpdatedAt: z.object({
      value: z.string().describe('ISO 8601 timestamp of the last update.'),
    }),
  })
  .meta({
    id: 'ApiLastUpdatedAtProperty',
    description: 'Read-only object last edited timestamp property value.',
  })

export const richTextPropertyValueSchema = z
  .object({
    type: z.literal('richText'),
    richText: z.object({
      value: z.array(apiTokenSchema).describe('Inline text tokens.'),
    }),
  })
  .meta({
    id: 'ApiRichTextProperty',
    description: 'Rich-text property value.',
  })

export const writableRichTextPropertyValueSchema = z
  .object({
    type: z.literal('richText'),
    richText: z.object({
      value: z.array(writableApiTokenSchema).describe('Inline text tokens.'),
    }),
  })
  .meta({
    id: 'WritableApiRichTextProperty',
    description: 'Writable rich-text property value.',
  })

export const objectPropertyValueSchema = z
  .discriminatedUnion('type', [
    titlePropertyValueSchema,
    textPropertyValueSchema,
    numberPropertyValueSchema,
    booleanPropertyValueSchema,
    urlPropertyValueSchema,
    datePropertyValueSchema,
    labelPropertyValueSchema,
    entityPropertyValueSchema,
    aliasesPropertyValueSchema,
    iconPropertyValueSchema,
    createdAtPropertyValueSchema,
    lastUpdatedAtPropertyValueSchema,
    richTextPropertyValueSchema,
  ])
  .meta({
    id: 'ApiObjectPropertyValue',
    description: 'Typed object property value returned by the API.',
  })

export const writableObjectPropertyValueSchema = z
  .discriminatedUnion('type', [
    writableTitlePropertyValueSchema,
    writableTextPropertyValueSchema,
    writableNumberPropertyValueSchema,
    writableBooleanPropertyValueSchema,
    writableUrlPropertyValueSchema,
    datePropertyWritableSchema,
    writableLabelPropertyValueSchema,
    writableEntityPropertyValueSchema,
    writableAliasesPropertyValueSchema,
    writableIconPropertyValueSchema,
    writableCreatedAtPropertyValueSchema,
    writableRichTextPropertyValueSchema,
  ])
  .meta({
    id: 'WritableApiObjectPropertyValue',
    description: 'Typed object property value accepted when writing object properties.',
  })

export const objectPropertiesSchema = z
  .record(z.string(), objectPropertyValueSchema)
  .describe('Map of property definition id → typed property value.')
  .meta({
    id: 'ApiObjectProperties',
    description: 'Map of property definition id to typed object property value.',
  })

export const writableObjectPropertiesSchema = z
  .record(z.string(), writableObjectPropertyValueSchema)
  .describe('Properties to set on create or update.')
  .meta({
    id: 'WritableApiObjectProperties',
    description: 'Writable properties keyed by property definition id.',
  })

/** Writable properties accepted by `POST /object/url` (title and description only). */
export const createObjectFromUrlPropertiesSchema = z
  .object({
    title: writableTitlePropertyValueSchema.optional(),
    description: writableTextPropertyValueSchema.optional(),
  })
  .meta({
    id: 'CreateObjectFromUrlProperties',
    description: 'Optional title and description overrides for URL object creation.',
  })

export type ObjectPropertyValue = z.infer<typeof objectPropertyValueSchema>
export type ObjectProperties = z.infer<typeof objectPropertiesSchema>
export type WritableObjectPropertyValue = z.infer<typeof writableObjectPropertyValueSchema>
export type WritableObjectProperties = z.infer<typeof writableObjectPropertiesSchema>
export type CreateObjectFromUrlProperties = z.infer<typeof createObjectFromUrlPropertiesSchema>
