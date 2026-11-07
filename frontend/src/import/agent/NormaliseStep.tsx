/** M27 "Normalise" step (design section 9): near-duplicate tags and option values to merge. */
import { useState } from 'react'
import { api } from '@/api/client'
import type { FilingMergeSuggestion } from '@/api/types'
import { Button } from '@/components/ui/button'
import { AGENT_TEXT as T } from './text'

export function NormaliseStep({
  batch,
  suggestions,
  onDone,
}: {
  batch: string
  suggestions: FilingMergeSuggestion[]
  onDone: () => void
}) {
  const [on, setOn] = useState<Record<number, boolean>>(() => Object.fromEntries(suggestions.map((_, i) => [i, true])))
  const [target, setTarget] = useState<Record<number, string>>(() => Object.fromEntries(suggestions.map((s, i) => [i, s.suggested])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = suggestions.map((s, i) => ({ s, i })).filter(({ i }) => on[i])
  const merge = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.normaliseFiling(
        batch,
        chosen.map(({ s, i }) => ({ from: s.values.filter((v) => v !== target[i]), to: target[i] })),
      )
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="normalise-heading" className="flex flex-col gap-3">
      <h3 id="normalise-heading" tabIndex={-1} className="text-[14px] font-semibold outline-none">
        {T.normaliseHeading}
      </h3>
      {suggestions.length === 0 ? (
        <p className="text-[13px] text-fg-muted">{T.normaliseNone}</p>
      ) : (
        <>
          <p className="text-[13px] text-fg-muted">{T.normaliseIntro}</p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2 text-[13px]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!on[i]}
                    aria-label={T.mergeLabel(s.values)}
                    onChange={(e) => setOn({ ...on, [i]: e.target.checked })}
                  />
                  <span className="text-[11px] uppercase text-fg-muted">{T.kinds[s.kind]}</span>
                  {s.values.join(', ')}
                </label>
                <label className="ml-auto flex items-center gap-1 text-fg-muted">
                  {T.mergeInto}
                  <select
                    value={target[i]}
                    onChange={(e) => setTarget({ ...target, [i]: e.target.value })}
                    className="h-8 rounded-md border border-line bg-raised px-2 text-[13px] text-fg"
                  >
                    {[...new Set([s.suggested, ...s.values])].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {suggestions.length > 0 && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {T.skip}
          </Button>
        )}
        {suggestions.length > 0 ? (
          <Button type="button" disabled={busy || chosen.length === 0} onClick={() => void merge()}>
            {busy ? T.merging : T.mergeCount(chosen.length)}
          </Button>
        ) : (
          <Button type="button" onClick={onDone}>
            {T.next}
          </Button>
        )}
      </div>
    </section>
  )
}
