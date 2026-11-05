// M12: an ID property's settings: the prefix, the next ID (read-only) and "Number existing
// objects", which gives every object of the type without an ID the next number, oldest first.
import { useState } from 'react'
import { api, RevisionConflictError } from '@/api/client'
import type { PropertyDef, TypeDef } from '@/api/types'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { SettingsSection } from './shared'
import { UNIQUE_ID_TEXT } from './texts'

const PREFIX = /^[A-Za-z0-9_-]{0,20}$/

/** A valid ID prefix: at most 20 letters, digits, `-` and `_` (empty is fine). */
function validPrefix(s: string): boolean {
  return PREFIX.test(s)
}

/** Put the answered type into the index, so every view shows it (and its revision) at once. */
function adoptType(t: TypeDef) {
  useLinkIndex.setState((s) => ({
    types: s.types.some((x) => x.id === t.id) ? s.types.map((x) => (x.id === t.id ? t : x)) : [...s.types, t],
    revision: s.revision + 1,
  }))
}

export function UniqueIdSection({ type, def, save }: { type: TypeDef; def: PropertyDef; save(next: PropertyDef): void }) {
  const saved = def.options.prefix ?? ''
  const [prefix, setPrefix] = useState(saved)
  const [synced, setSynced] = useState(saved)
  if (synced !== saved) {
    setSynced(saved)
    setPrefix(saved)
  }
  const valid = validPrefix(prefix)
  const commit = () => {
    if (!valid) return
    if (prefix !== saved) save({ ...def, options: { ...def.options, prefix } })
  }

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const numberExisting = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await api.numberExistingObjects(type.id, def.id, type.revision)
      if (res?.type) adoptType(res.type)
      const skipped = res?.skipped?.length ?? 0
      const text = UNIQUE_ID_TEXT.numbered(res?.numbered ?? 0) + (skipped ? ` (${UNIQUE_ID_TEXT.skipped(skipped)})` : '')
      setResult({ ok: true, text })
    } catch (err) {
      if (err instanceof RevisionConflictError) {
        setResult({ ok: false, text: UNIQUE_ID_TEXT.conflict })
        await invalidateLinkIndex()
      } else {
        setResult({ ok: false, text: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title={UNIQUE_ID_TEXT.heading} description={UNIQUE_ID_TEXT.description}>
      <label className="flex items-center gap-2 text-[13px]">
        <span className="w-28 text-fg-muted">{UNIQUE_ID_TEXT.prefix}</span>
        <input
          aria-label={UNIQUE_ID_TEXT.prefix}
          aria-invalid={!valid}
          placeholder={UNIQUE_ID_TEXT.prefixPlaceholder}
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setPrefix(saved)
          }}
          className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-0.5 outline-none aria-[invalid=true]:border-red-400"
        />
      </label>
      {!valid && (
        <p data-prefix-error className="mt-1 text-[13px] text-red-400">
          {UNIQUE_ID_TEXT.prefixInvalid}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2 text-[13px]">
        <span className="w-28 text-fg-muted">{UNIQUE_ID_TEXT.nextId}</span>
        <span data-next-id className="font-mono">{`${saved}${def.options.nextNumber ?? 1}`}</span>
      </div>
      <div className="mt-3">
        <p className="text-[13px] text-fg-muted">{UNIQUE_ID_TEXT.numberExistingDescription}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void numberExisting()}
          className="mt-1 rounded bg-hover px-3 py-1 text-[13px] font-medium disabled:opacity-50"
        >
          {busy ? UNIQUE_ID_TEXT.numbering : UNIQUE_ID_TEXT.numberExisting}
        </button>
        {result && (
          <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'mt-1 text-[13px]' : 'mt-1 text-[13px] text-red-400'}>
            {result.text}
          </p>
        )}
      </div>
    </SettingsSection>
  )
}
