// M29: synced facts. A property marked `synced` is filled only by a script or agent through the
// API (`POST /api/v1/synced/{typeId}`); its values live in `.object/synced/<typeId>.json`, never
// in the file, and the app shows them read-only with their source, when they were refreshed and
// "Stale" once they are older than the property's stale-after days.
import { useEffect, useState } from 'react'
import type { PropertyDef } from '@/api/types'
import { SYNCABLE_KINDS, SYNCED_STALE_DEFAULT } from '@/api/types'
import { ago } from '@/automations/ruleModel'

/** Our strings. */
export const SYNCED_TEXT = {
  refreshed: (source: string, ago: string) => `${source} · Refreshed ${ago}`,
  never: (source: string) => `${source} · Not refreshed yet`,
  stale: 'Stale',
  readOnly: (name: string, source: string) => `"${name}" is filled by ${source} and can't be edited.`,
}

const DAY_MS = 86_400_000
/** How often a synced line reads the clock again ("Refreshed ... ago", "Stale"). */
const TICK_MS = 60_000

/** Whether the property is synced: a syncable kind carrying a synced mark with a source (as the
 *  backend's `synced.is_synced` reads it; a hand-edited `synced: "yes"` or a mark on a relation is not). */
export function isSynced(def: Pick<PropertyDef, 'type' | 'synced'> | undefined | null): boolean {
  if (!def || !SYNCABLE_KINDS.has(def.type)) return false
  const source = (def.synced as { source?: unknown } | null | undefined)?.source
  return typeof source === 'string' && source.trim() !== ''
}

/** The stale-after days of a synced mark (7 when it gives none). */
export function staleAfterDays(def: PropertyDef | undefined | null): number {
  const n = def?.synced?.staleAfterDays
  return typeof n === 'number' && Number.isFinite(n) ? n : SYNCED_STALE_DEFAULT
}

/** Stale strictly after `staleAfterDays` days since `refreshedAt`; never refreshed is not stale. */
export function isStale(refreshedAt: string | null | undefined, staleAfterDays: number, now: Date): boolean {
  if (!refreshedAt) return false
  const t = new Date(refreshedAt).getTime()
  if (Number.isNaN(t)) return false
  return now.getTime() - t > staleAfterDays * DAY_MS
}

/** Whether a synced property's values (refreshed at `refreshedAt`) are stale now. */
export function syncedStale(def: PropertyDef, refreshedAt: string | null | undefined, now: Date = new Date()): boolean {
  return isSynced(def) && isStale(refreshedAt, staleAfterDays(def), now)
}

/** The line under a synced value: "{source} · Refreshed {time ago}" (or "Not refreshed yet"), then "Stale". */
export function SyncedLine({ def, refreshedAt, now }: { def: PropertyDef; refreshedAt: string | null; now?: Date }) {
  // Re-render once a minute so the time ago and Stale move on while the page stays open.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (now) return
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [now])
  const at = now ?? new Date()
  const source = def.synced?.source ?? ''
  const stale = syncedStale(def, refreshedAt, at)
  return (
    <p data-synced-line="" className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
      <span>{refreshedAt ? SYNCED_TEXT.refreshed(source, ago(refreshedAt, at)) : SYNCED_TEXT.never(source)}</span>
      {stale && (
        <span data-stale="" className="rounded bg-hover px-1.5 text-[11px] font-medium text-fg-muted">
          {SYNCED_TEXT.stale}
        </span>
      )}
    </p>
  )
}
