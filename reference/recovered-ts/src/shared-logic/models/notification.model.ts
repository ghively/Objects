import { z } from 'zod'
import { dateObject } from './date.model.js'

export const NOTIFICATION_TYPES = ['reminder'] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const NOTIFICATION_RECIPIENT_STATES = ['scheduled', 'unread', 'read', 'archived', 'cancelled'] as const
export type NotificationRecipientState = (typeof NOTIFICATION_RECIPIENT_STATES)[number]

/** Meta payload for `type: 'reminder'` notifications. */
export const reminderNotificationMetaSchema = z.object({
  type: z.literal('reminder'),
  entityId: z.string(),
  propertyId: z.string(),
  /** When the date owner is a UtilDate, the parent object to open/show in the inbox. */
  parentEntityId: z.string().optional(),
  blockId: z.string().optional(),
  occurrenceStartTime: z.string().optional(),
  titleSnapshot: z.string().optional(),
  /** Subtitle for delivery surfaces (e.g. formatted date). */
  descriptionSnapshot: z.string().optional(),
  /**
   * How many due occurrences of this reminder have not been checked off.
   * Omitted or 1 for a single fire; greater than 1 after later occurrences were folded in.
   */
  unseenCount: z.number().int().positive().optional(),
  /**
   * DateObject captured at materialize time for recurring (`dueDate`) reminders. The entity's
   * date property is the source of truth; this snapshot only lets the dispatch worker and nightly
   * repair job advance/detect broken chains without a `getComponentFull` round trip.
   */
  dateSnapshot: dateObject.optional(),
})
export type ReminderNotificationMeta = z.infer<typeof reminderNotificationMetaSchema>

/**
 * Discriminated union of per-notification-type meta payloads.
 * Add a new variant (and a matching `NOTIFICATION_TYPES` entry) when introducing a new type.
 */
export const notificationMetaSchema = z.discriminatedUnion('type', [
  reminderNotificationMetaSchema,
  // Future: mentionNotificationMetaSchema, shareNotificationMetaSchema, …
])
export type NotificationMeta = z.infer<typeof notificationMetaSchema>

/**
 * Normalizes persisted meta (and legacy `{ trigger: 'reminder' }` rows) into the current
 * discriminated-union shape for the client. Call when reading from SQLite / untrusted JSON.
 * Deliberately drops `dateSnapshot` — it is a server-only recurrence-advance optimization; the
 * client already has the authoritative date via the entity itself.
 */
function readPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(n) || n < 1) return undefined
  return n
}

export function normalizeNotificationMeta(
  type: NotificationType,
  meta: Record<string, unknown> | null | undefined
): NotificationMeta {
  const raw = meta && typeof meta === 'object' ? meta : {}
  if (type === 'reminder') {
    return {
      type: 'reminder',
      entityId: typeof raw.entityId === 'string' ? raw.entityId : '',
      propertyId: typeof raw.propertyId === 'string' ? raw.propertyId : '',
      parentEntityId: typeof raw.parentEntityId === 'string' ? raw.parentEntityId : undefined,
      blockId: typeof raw.blockId === 'string' ? raw.blockId : undefined,
      occurrenceStartTime: typeof raw.occurrenceStartTime === 'string' ? raw.occurrenceStartTime : undefined,
      titleSnapshot: typeof raw.titleSnapshot === 'string' ? raw.titleSnapshot : undefined,
      descriptionSnapshot: typeof raw.descriptionSnapshot === 'string' ? raw.descriptionSnapshot : undefined,
      unseenCount: readPositiveInt(raw.unseenCount),
    }
  }
  // Exhaustive for current NOTIFICATION_TYPES; future types add branches above.
  return {
    type: 'reminder',
    entityId: '',
    propertyId: '',
  }
}

/** Client-facing notification row (joined content + recipient state). */
export const notificationSyncRowSchema = z.object({
  id: z.string(),
  spaceId: z.string().nullable(),
  type: z.enum(NOTIFICATION_TYPES),
  meta: notificationMetaSchema,
  fireAt: z.string(),
  state: z.enum(NOTIFICATION_RECIPIENT_STATES),
  seenAt: z.string().nullable().optional(),
  readAt: z.string().nullable().optional(),
  actedAt: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  lastUpdated: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable().optional(),
})
export type NotificationSyncRow = z.infer<typeof notificationSyncRowSchema>
