import { z } from 'zod'

/** Inclusive bounds for a finite retention count. `null` means keep every export. */
export const EXPORT_KEEP_MIN = 1
export const EXPORT_KEEP_MAX = 99

/**
 * Device-local retention count.
 * "All" used to store Infinity. Zod 4 rejects that, and a failed preferences parse
 * skips the whole save, so Infinity is stored as null. A count outside 1–99 becomes
 * 1 on this field only, so the rest of the schedule still saves.
 */
export const exportKeepSchema = z
  .preprocess(
    (value) => (value === Number.POSITIVE_INFINITY ? null : value),
    z.union([z.int().min(EXPORT_KEEP_MIN).max(EXPORT_KEEP_MAX), z.null()]).catch(1)
  )
  .default(1)

export type ExportKeep = number | null

/** Accept a count from the export request. Undefined means the request is invalid. */
export function readExportKeep(value: unknown): ExportKeep | undefined {
  if (value === null || value === Number.POSITIVE_INFINITY) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < EXPORT_KEEP_MIN || value > EXPORT_KEEP_MAX) {
    return undefined
  }
  return value
}

/** How many oldest exports to delete. Unlimited counts delete none. */
export function exportsToDrop(historyLength: number, keep: ExportKeep): number {
  if (keep === null || !Number.isFinite(keep)) return 0
  return Math.max(historyLength - keep, 0)
}
