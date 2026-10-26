/**
 * Public HTTP API representation of Capacities blocks and tokens (`GET /object`, `POST /blocks/append`).
 * Mirrors internal {@link Block} / {@link Token} shapes; strips editor-only fields on read.
 */
import { z } from 'zod'
import { textOrBackgroundColorThemeSchema, type TextOrBackgroundColorTheme } from './public-api-color-themes.js'
import { datePayloadReadableSchema, datePayloadWritableSchema, type ApiDatePayload } from './public-api-date.js'

// ── Token schemas ─────────────────────────────────────────────────────────────

export const apiTextTokenSchema = z
  .object({
    type: z.literal('TextToken'),
    text: z.string(),
    style: z.object({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      strikethrough: z.boolean().optional(),
      underline: z.boolean().optional(),
    }),
    color: textOrBackgroundColorThemeSchema.optional(),
  })
  .meta({
    id: 'ApiTextToken',
    description: 'Plain text with optional bold, italic, strikethrough, underline, and color.',
  })

function linkTokenTargetIsExclusive(body: { url?: unknown; entityId?: unknown; date?: unknown }): boolean {
  const count = [body.url !== undefined, body.entityId !== undefined, body.date !== undefined].filter(Boolean).length
  return count <= 1
}

function writableLinkTokenHasExactlyOneTarget(body: { url?: unknown; entityId?: unknown; date?: unknown }): boolean {
  const count = [body.url !== undefined, body.entityId !== undefined, body.date !== undefined].filter(Boolean).length
  return count === 1
}

export const apiLinkTokenSchema = z
  .object({
    type: z.literal('LinkToken'),
    text: z.string(),
    url: z.string().optional(),
    entityId: z.string().optional().describe('Referenced object id when the link targets a Capacities object.'),
    date: datePayloadReadableSchema.optional().describe('Date value when the link targets a UtilDate object.'),
  })
  .refine(linkTokenTargetIsExclusive, {
    message: 'Provide at most one of `url`, `entityId`, or `date` on a LinkToken.',
  })
  .meta({
    id: 'ApiLinkToken',
    description: 'Hyperlink with display text and optional URL, object reference, or date.',
  })

export const writableApiLinkTokenSchema = z
  .object({
    type: z.literal('LinkToken'),
    text: z.string(),
    url: z.string().optional(),
    entityId: z.string().optional().describe('Referenced object id when the link targets a Capacities object.'),
    date: datePayloadWritableSchema.optional().describe('Date value; creates or updates a linked UtilDate object.'),
  })
  .refine(writableLinkTokenHasExactlyOneTarget, {
    message: 'Provide exactly one of `url`, `entityId`, or `date` on a LinkToken.',
  })
  .meta({
    id: 'WritableApiLinkToken',
    description: 'Writable hyperlink — exactly one target: URL, entity id, or date.',
  })

export const apiMathTokenSchema = z
  .object({
    type: z.literal('MathToken'),
    text: z.string(),
  })
  .meta({
    id: 'ApiMathToken',
    description: 'Inline math (LaTeX).',
  })

export const apiCodeTokenSchema = z
  .object({
    type: z.literal('CodeToken'),
    text: z.string(),
  })
  .meta({
    id: 'ApiCodeToken',
    description: 'Inline code span.',
  })

export const apiTokenSchema = z
  .discriminatedUnion('type', [apiTextTokenSchema, apiLinkTokenSchema, apiMathTokenSchema, apiCodeTokenSchema])
  .meta({
    id: 'ApiToken',
    description: 'Inline token inside a TextBlock.',
  })

export const writableApiTokenSchema = z
  .discriminatedUnion('type', [apiTextTokenSchema, writableApiLinkTokenSchema, apiMathTokenSchema, apiCodeTokenSchema])
  .meta({
    id: 'WritableApiToken',
    description: 'Inline token for append or block update.',
  })

export type ApiTextToken = z.infer<typeof apiTextTokenSchema>
export type ApiLinkToken = z.infer<typeof apiLinkTokenSchema>
export type WritableApiLinkToken = z.infer<typeof writableApiLinkTokenSchema>
export type ApiMathToken = z.infer<typeof apiMathTokenSchema>
export type ApiCodeToken = z.infer<typeof apiCodeTokenSchema>
export type ApiToken = z.infer<typeof apiTokenSchema>
export type WritableApiToken = z.infer<typeof writableApiTokenSchema>

// ── Highlight schemas ─────────────────────────────────────────────────────────

export const highlightColorSchema = z.enum(['yellow', 'orange', 'green', 'red', 'purple', 'blue'])
export type HighlightColor = z.infer<typeof highlightColorSchema>

export const apiHighlightSchema = z
  .object({
    type: z.enum(['webhighlights', 'readwise', 'kindle-import', 'custom']),
    url: z.string().optional().describe('Source URL associated with this highlight, if any.'),
    label: z.string().optional().describe('Display label; present for custom highlights.'),
    location: z
      .string()
      .max(20)
      .optional()
      .describe('Location text shown below the block; present for custom highlights (max 20 characters).'),
    color: highlightColorSchema.optional().describe('Highlight color stored as annotation metadata.'),
  })
  .meta({
    id: 'ApiHighlight',
    description: 'Highlight annotation attached to a text block.',
  })

export type ApiHighlight = z.infer<typeof apiHighlightSchema>

const writableApiWebhighlightsHighlightSchema = z
  .object({
    type: z.literal('webhighlights'),
    url: z.string().optional().describe('Source URL of the web highlight.'),
    color: highlightColorSchema.optional().describe('Highlight color stored as annotation metadata.'),
  })
  .meta({
    id: 'WritableApiWebhighlightsHighlight',
    description:
      'Web highlight from the WebHighlights browser extension. **Restricted**: only requests authenticated via the authorized WebHighlights OAuth client are permitted to create highlights of this type. All other callers will receive a 400 error.',
  })

const writableApiCustomHighlightSchema = z
  .object({
    type: z.literal('custom'),
    label: z.string().min(1).max(20).describe('Display label for the custom highlight (max 20 characters).'),
    location: z
      .string()
      .max(20)
      .optional()
      .describe('Optional location text shown below the highlighted block (max 20 characters).'),
    url: z.string().optional().describe('Optional source URL for the custom highlight.'),
    color: highlightColorSchema.optional().describe('Highlight color stored as annotation metadata.'),
  })
  .meta({
    id: 'WritableApiCustomHighlight',
    description: 'Custom user-defined highlight with a required label and optional location.',
  })

export const writableApiHighlightSchema = z
  .discriminatedUnion('type', [writableApiWebhighlightsHighlightSchema, writableApiCustomHighlightSchema])
  .meta({
    id: 'WritableApiHighlight',
    description:
      "Highlight annotation to attach to a text block. Allowed types: 'custom' (available to all callers) and 'webhighlights' (restricted to the authorized WebHighlights OAuth client).",
  })

export type WritableApiHighlight = z.infer<typeof writableApiHighlightSchema>

// ── Shared block pieces ───────────────────────────────────────────────────────

const blockHierarchySchema = z.object({
  key: z.string(),
  val: z.number(),
})

const listPayloadSchema = z.object({
  type: z.enum(['bullet', 'alphabetical', 'numerical', 'roman']),
})

const todoPayloadSchema = z.object({
  isDone: z.boolean(),
})

const togglePayloadSchema = z.object({
  isOpen: z.boolean(),
})

const quotePayloadSchema = z.object({
  layout: z.enum(['normal', 'standout']),
})

/** Output shape for `GET /object` blocks (recursive). Mirrors {@link apiBlockSchema}; kept explicit because TS cannot infer a self-referential `z.lazy` schema without `implicitly any`. */
export type ApiBlock =
  | {
      id: string
      type: 'TextBlock'
      tokens: ApiToken[]
      blocks: ApiBlock[]
      hierarchy: { key: string; val: number }
      list?: { type: 'bullet' | 'alphabetical' | 'numerical' | 'roman' } | null
      todo?: { isDone: boolean }
      toggle?: { isOpen: boolean } | null
      quote?: { layout: 'normal' | 'standout' }
      colorTheme?: TextOrBackgroundColorTheme
      highlight?: ApiHighlight
    }
  | {
      id: string
      type: 'GroupBlock'
      blocks: ApiBlock[]
      list?: { type: 'bullet' | 'alphabetical' | 'numerical' | 'roman' } | null
      todo?: { isDone: boolean }
      toggle?: { isOpen: boolean } | null
      colorTheme?: TextOrBackgroundColorTheme
    }
  | {
      id: string
      type: 'GridBlock'
      columns: ApiBlock[][]
      dividers: number[]
      gridLayout?: 'columns' | 'grid'
      colorTheme?: TextOrBackgroundColorTheme
    }
  | {
      id: string
      type: 'CodeBlock'
      lang: string
      text: string
    }
  | {
      id: string
      type: 'MathBlock'
      text: string
      colorTheme?: TextOrBackgroundColorTheme
    }
  | {
      id: string
      type: 'EntityBlock'
      entityId: string | null
      date?: ApiDatePayload
    }
  | {
      id: string
      type: 'HorizontalLineBlock'
    }
  | {
      id: string
      type: 'unsupported'
      blockType: string
    }

// ── Block schema (recursive) ──────────────────────────────────────────────────

export const apiBlockSchema: z.ZodType<ApiBlock> = z
  .lazy(() => apiBlockUnion)
  .meta({
    id: 'ApiBlock',
    description:
      'A block in a Capacities object (text, code, grid, entity embed, etc.). Nested via `blocks` or grid `columns`.',
  })

const apiTextBlockSchema = z
  .object({
    id: z.string(),
    type: z.literal('TextBlock'),
    tokens: z.array(apiTokenSchema),
    blocks: z.array(apiBlockSchema),
    hierarchy: blockHierarchySchema,
    list: listPayloadSchema.nullable().optional(),
    todo: todoPayloadSchema.optional(),
    toggle: togglePayloadSchema.nullable().optional(),
    quote: quotePayloadSchema.optional(),
    colorTheme: textOrBackgroundColorThemeSchema.optional(),
    highlight: apiHighlightSchema.optional().describe('Highlight annotation attached to this block, if any.'),
  })
  .meta({
    id: 'ApiTextBlock',
    description: 'Paragraph or heading with inline tokens and optional nested blocks.',
  })

const apiGroupBlockSchema = z
  .object({
    id: z.string(),
    type: z.literal('GroupBlock'),
    blocks: z.array(apiBlockSchema),
    list: listPayloadSchema.nullable().optional(),
    todo: todoPayloadSchema.optional(),
    toggle: togglePayloadSchema.nullable().optional(),
    colorTheme: textOrBackgroundColorThemeSchema.optional(),
  })
  .meta({
    id: 'ApiGroupBlock',
    description: 'Container block that groups nested blocks (e.g. list or toggle group).',
  })

const apiGridBlockSchema = z
  .object({
    id: z.string(),
    type: z.literal('GridBlock'),
    columns: z.array(z.array(apiBlockSchema)),
    dividers: z.array(z.number()),
    gridLayout: z.enum(['columns', 'grid']).optional(),
    colorTheme: textOrBackgroundColorThemeSchema.optional(),
  })
  .meta({
    id: 'ApiGridBlock',
    description: 'Multi-column layout; each column is an array of blocks.',
  })

const apiCodeBlockSchema = z
  .object({
    id: z.string(),
    type: z.literal('CodeBlock'),
    lang: z.string(),
    text: z.string(),
  })
  .meta({
    id: 'ApiCodeBlock',
    description: 'Fenced code block with language and source text.',
  })

const apiMathBlockSchema = z
  .object({
    id: z.string(),
    type: z.literal('MathBlock'),
    text: z.string(),
    colorTheme: textOrBackgroundColorThemeSchema.optional(),
  })
  .meta({
    id: 'ApiMathBlock',
    description: 'Display math block (LaTeX).',
  })

const apiEntityBlockSchema = z
  .object({
    id: z.string(),
    type: z.literal('EntityBlock'),
    entityId: z.string().nullable(),
    date: datePayloadReadableSchema.optional().describe('Date value when the embed targets a UtilDate object.'),
  })
  .meta({
    id: 'ApiEntityBlock',
    description: 'Embedded Capacities object reference, or null when empty.',
  })

const apiHorizontalLineBlockSchema = z
  .object({
    id: z.string(),
    type: z.literal('HorizontalLineBlock'),
  })
  .meta({
    id: 'ApiHorizontalLineBlock',
    description: 'Horizontal divider line.',
  })

const apiUnsupportedBlockSchema = z
  .object({
    id: z.string(),
    type: z.literal('unsupported'),
    blockType: z.string(),
  })
  .meta({
    id: 'ApiUnsupportedBlock',
    description: 'Placeholder for block types not available in the API.',
  })

const apiBlockUnion = z.discriminatedUnion('type', [
  apiTextBlockSchema,
  apiGroupBlockSchema,
  apiGridBlockSchema,
  apiCodeBlockSchema,
  apiMathBlockSchema,
  apiEntityBlockSchema,
  apiHorizontalLineBlockSchema,
  apiUnsupportedBlockSchema,
])

export const apiObjectBlocksSchema = z
  .record(z.string(), z.array(apiBlockSchema))
  .describe('Block content keyed by property definition id.')

export type ApiObjectBlocks = z.infer<typeof apiObjectBlocksSchema>

// ── Writable block schema (`POST /blocks/append`) ─────────────────────────────

/** Request block shape for append — no `id`; server assigns via {@link generateBlock}. */
export type WritableApiBlock =
  | {
      type: 'TextBlock'
      tokens?: WritableApiToken[]
      blocks?: WritableApiBlock[]
      hierarchy?: { key: string; val: number }
      list?: { type: 'bullet' | 'alphabetical' | 'numerical' | 'roman' } | null
      todo?: { isDone: boolean }
      toggle?: { isOpen: boolean } | null
      quote?: { layout: 'normal' | 'standout' }
      textAlignment?: 'left' | 'center' | 'right'
      colorTheme?: TextOrBackgroundColorTheme
      highlight?: WritableApiHighlight
    }
  | {
      type: 'GroupBlock'
      blocks?: WritableApiBlock[]
      list?: { type: 'bullet' | 'alphabetical' | 'numerical' | 'roman' } | null
      todo?: { isDone: boolean }
      toggle?: { isOpen: boolean } | null
      textAlignment?: 'left' | 'center' | 'right'
      colorTheme?: TextOrBackgroundColorTheme
    }
  | {
      type: 'GridBlock'
      columns?: WritableApiBlock[][]
      dividers: number[]
      gridLayout?: 'columns' | 'grid'
      colorTheme?: TextOrBackgroundColorTheme
    }
  | {
      type: 'CodeBlock'
      lang: string
      text: string
    }
  | {
      type: 'MathBlock'
      text: string
      colorTheme?: TextOrBackgroundColorTheme
    }
  | {
      type: 'EntityBlock'
      entityId: string | null
    }
  | {
      type: 'HorizontalLineBlock'
    }

export const writableApiBlockSchema: z.ZodType<WritableApiBlock> = z
  .lazy(() => writableApiBlockUnion)
  .meta({
    id: 'WritableApiBlock',
    description: 'Block for append or update. Omit `id` when creating new blocks.',
  })

const writableApiTextBlockSchema = z
  .object({
    type: z.literal('TextBlock'),
    tokens: z.array(writableApiTokenSchema).optional(),
    blocks: z.array(writableApiBlockSchema).optional(),
    hierarchy: blockHierarchySchema.optional(),
    list: listPayloadSchema.nullable().optional(),
    todo: todoPayloadSchema.optional(),
    toggle: togglePayloadSchema.nullable().optional(),
    quote: quotePayloadSchema.optional(),
    textAlignment: z.enum(['left', 'center', 'right']).optional(),
    colorTheme: textOrBackgroundColorThemeSchema.optional(),
    highlight: writableApiHighlightSchema.optional().describe('Highlight annotation to attach.'),
  })
  .meta({
    id: 'WritableApiTextBlock',
    description: 'Paragraph or heading with inline tokens and optional nested blocks.',
  })

const writableApiGroupBlockSchema = z
  .object({
    type: z.literal('GroupBlock'),
    blocks: z.array(writableApiBlockSchema).optional(),
    list: listPayloadSchema.nullable().optional(),
    todo: todoPayloadSchema.optional(),
    toggle: togglePayloadSchema.nullable().optional(),
    textAlignment: z.enum(['left', 'center', 'right']).optional(),
    colorTheme: textOrBackgroundColorThemeSchema.optional(),
  })
  .meta({
    id: 'WritableApiGroupBlock',
    description: 'Container block that groups nested blocks.',
  })

const writableApiGridBlockSchema = z
  .object({
    type: z.literal('GridBlock'),
    columns: z.array(z.array(writableApiBlockSchema)).optional(),
    dividers: z.array(z.number()),
    gridLayout: z.enum(['columns', 'grid']).optional(),
    colorTheme: textOrBackgroundColorThemeSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.columns === undefined) return
    if (data.columns.length < 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'GridBlock must include at least two columns.',
        path: ['columns'],
      })
    }
  })
  .meta({
    id: 'WritableApiGridBlock',
    description:
      'Grid layout block. When `columns` is provided it must include at least two column arrays. Use `gridLayout: "grid"` for grid mode or `"columns"` for column mode.',
  })

const writableApiCodeBlockSchema = z
  .object({
    type: z.literal('CodeBlock'),
    lang: z.string(),
    text: z.string(),
  })
  .meta({
    id: 'WritableApiCodeBlock',
    description: 'Fenced code block with language and source text.',
  })

const writableApiMathBlockSchema = z
  .object({
    type: z.literal('MathBlock'),
    text: z.string(),
    colorTheme: textOrBackgroundColorThemeSchema.optional(),
  })
  .meta({
    id: 'WritableApiMathBlock',
    description: 'Display math block (LaTeX).',
  })

const writableApiEntityBlockSchema = z
  .object({
    type: z.literal('EntityBlock'),
    entityId: z.string().nullable(),
    date: datePayloadWritableSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.date !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'EntityBlock does not accept `date`; use a LinkToken with `date` instead.',
        path: ['date'],
      })
    }
  })
  .meta({
    id: 'WritableApiEntityBlock',
    description: 'Embedded Capacities object reference, or null when empty.',
  })

const writableApiHorizontalLineBlockSchema = z
  .object({
    type: z.literal('HorizontalLineBlock'),
  })
  .meta({
    id: 'WritableApiHorizontalLineBlock',
    description: 'Horizontal divider line.',
  })

const writableApiBlockUnion = z.discriminatedUnion('type', [
  writableApiTextBlockSchema,
  writableApiGroupBlockSchema,
  writableApiGridBlockSchema,
  writableApiCodeBlockSchema,
  writableApiMathBlockSchema,
  writableApiEntityBlockSchema,
  writableApiHorizontalLineBlockSchema,
])
