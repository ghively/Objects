// M29: the synced mark in property settings. A synced property is filled only by a script or
// agent through the API (`POST /api/v1/synced/{typeId}`); the mark is the property's top-level
// `synced: {source, staleAfterDays}` (null or absent when not synced). Turning it on saves nothing
// until the source is filled in; turning it off saves `synced: null`.
import { useState } from 'react'
import type { PropertyDef, SyncedSpec } from '@/api/types'
import { SYNCED_STALE_DEFAULT } from '@/api/types'
import { Switch } from '@/components/ui/switch'
import { SettingsSection } from './shared'

/** Our strings. */
export const SYNCED_SETTINGS_TEXT = {
  title: 'Synced',
  description: 'Filled only by a script or agent through the API. Read-only in Object, and never written to the file.',
  toggle: 'Synced from a script or agent',
  source: 'Source',
  sourcePlaceholder: 'Inventory script',
  staleAfter: 'Stale after',
  days: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
  hidesFileValues: 'Values typed into the file for this property stop showing.',
}

const T = SYNCED_SETTINGS_TEXT
const MAX_SOURCE = 60
const MAX_STALE_DAYS = 365

/** A source as saved: trimmed, 1-60 characters on one line; null when it isn't one. */
function cleanSource(s: string): string | null {
  const v = s.trim()
  return v && v.length <= MAX_SOURCE && !/[\r\n]/.test(v) ? v : null
}

/** "Stale after" as saved: a whole number of days from 1 to 365; null when it isn't one. */
function cleanDays(s: string): number | null {
  if (!/^\d+$/.test(s.trim())) return null
  const n = Number(s.trim())
  return n >= 1 && n <= MAX_STALE_DAYS ? n : null
}

function sameSpec(a: SyncedSpec | null | undefined, b: SyncedSpec | null | undefined): boolean {
  return (a?.source ?? null) === (b?.source ?? null) && (a?.staleAfterDays ?? null) === (b?.staleAfterDays ?? null)
}

export function SyncedSection({ def, save }: { def: PropertyDef; save(next: PropertyDef): void }) {
  const mark = def.synced ?? null
  const savedDays = mark?.staleAfterDays ?? SYNCED_STALE_DEFAULT
  const [on, setOn] = useState(!!mark)
  const [source, setSource] = useState(mark?.source ?? '')
  const [days, setDays] = useState(String(savedDays))
  // Edits from elsewhere (or a save's answer) replace the drafts.
  const markKey = JSON.stringify(mark)
  const [seen, setSeen] = useState(markKey)
  if (seen !== markKey) {
    setSeen(markKey)
    setOn(!!mark)
    setSource(mark?.source ?? '')
    setDays(String(savedDays))
  }

  const validSource = cleanSource(source)
  const commit = (nextSource: string, nextDays: string) => {
    if (!on) return
    const s = cleanSource(nextSource)
    if (s === null) return
    const n = cleanDays(nextDays)
    if (n === null) setDays(String(savedDays))
    const spec: SyncedSpec = { source: s, staleAfterDays: n ?? savedDays }
    if (!sameSpec(spec, mark)) save({ ...def, synced: spec })
  }
  const toggle = (v: boolean) => {
    setOn(v)
    if (!v) {
      if (mark) save({ ...def, synced: null })
      return
    }
    const s = cleanSource(source)
    const n = cleanDays(days) ?? SYNCED_STALE_DEFAULT
    if (s !== null) save({ ...def, synced: { source: s, staleAfterDays: n } })
  }
  const n = cleanDays(days) ?? savedDays
  const unit = T.days(n).slice(String(n).length + 1)

  return (
    <SettingsSection title={T.title} description={T.description}>
      <label className="flex items-center gap-2 text-[13px]">
        <Switch aria-label={T.toggle} checked={on} onCheckedChange={toggle} />
        {T.toggle}
      </label>
      {on && (
        <div className="mt-2 space-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            <span className="w-28 text-fg-muted">{T.source}</span>
            <input
              aria-label={T.source}
              aria-invalid={validSource === null}
              placeholder={T.sourcePlaceholder}
              maxLength={MAX_SOURCE}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onBlur={() => commit(source, days)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
              className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-0.5 outline-none aria-[invalid=true]:border-red-400"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-28 text-fg-muted">{T.staleAfter}</span>
            <input
              type="number"
              aria-label={T.staleAfter}
              min={1}
              max={MAX_STALE_DAYS}
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              onBlur={() => {
                if (cleanDays(days) === null) setDays(String(savedDays))
                else commit(source, days)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
              className="w-20 rounded border border-line bg-transparent px-2 py-0.5 outline-none"
            />
            <span className="text-fg-muted">{unit}</span>
          </label>
          <p className="text-fg-muted">{T.hidesFileValues}</p>
        </div>
      )}
    </SettingsSection>
  )
}
