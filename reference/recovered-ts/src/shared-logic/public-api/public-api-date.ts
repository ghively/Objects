/**
 * Shared Public API date payload schemas — used by object properties and LinkToken targets.
 */
import { z } from 'zod'

export const dateResolutionSchema = z.enum(['time', 'day'])

export const datePayloadReadableSchema = z
  .object({
    dateResolution: dateResolutionSchema.describe('`day` or `time`.'),
    start: z.string().nullable().describe('ISO 8601 start.'),
    end: z.string().nullable().describe('ISO 8601 end, if any.'),
  })
  .meta({
    id: 'ApiDatePayload',
    description: 'Date value.',
  })

export type ApiDatePayload = z.infer<typeof datePayloadReadableSchema>

export const datePayloadWritableSchema = z
  .object({
    dateResolution: dateResolutionSchema
      .optional()
      .describe('`day` or `time` (defaults to `day` for link-token dates).'),
    start: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 start. For `dateResolution: "day"` the calendar day: "YYYY-MM-DD" or ISO UTC midnight (e.g. "2026-08-07" or "2026-08-07T00:00:00.000Z"). For `dateResolution: "time"` a full ISO 8601 datetime (e.g. "2026-08-07T15:30:00.000Z"). Pass `null` to clear the date.'
      ),
    end: z
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 end, if any (same formats as start). Cleared together with `start` when removing the date.'),
  })
  .meta({
    id: 'WritableApiDatePayload',
    description: 'Date value when writing.',
  })

export type WritableApiDatePayload = z.infer<typeof datePayloadWritableSchema>
