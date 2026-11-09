/**
 * M27 "Trial" step (design section 9): the filing pass runs on the first 50 objects; every value is
 * shown with the quote it came from, marked right or wrong, and the bulk pass starts only on
 * "Continue with the rest". The share marked right is shown (and recorded in the report by the server).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { FilingStatus, FilingTrialItem, FilingVerdict } from '@/api/types'
import { Button } from '@/components/ui/button'
import { AGENT_TEXT as T } from './text'

/** How often a running pass is polled (tests shorten it). */
export const agentTiming = { pollMs: 1500 }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function TrialStep({ batch, onDone }: { batch: string; onDone: (status: FilingStatus) => void }) {
  const [status, setStatus] = useState<FilingStatus | null>(null)
  const [verdicts, setVerdicts] = useState<Record<string, FilingVerdict>>({})
  const [busy, setBusy] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const finished = useRef(false)

  /** Whether the error shown came from a failed status load (a later answer clears it). */
  const loadFailed = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const s = await api.filingStatus(batch)
      if (loadFailed.current) {
        // An answer after failed tries: their error no longer stands.
        loadFailed.current = false
        setError(null)
      }
      setStatus(s)
      setVerdicts((v) => ({
        ...Object.fromEntries(s.trial.items.filter((i) => i.verdict).map((i) => [i.path, i.verdict as FilingVerdict])),
        ...v,
      }))
      if (s.state === 'done' && !finished.current) {
        finished.current = true
        onDone(s)
      }
      return s
    } catch (e) {
      loadFailed.current = true
      setError(msg(e))
      return null
    }
  }, [batch, onDone])
  /** Shows an error from an action (not a status load), which a later status answer keeps. */
  const fail = (e: unknown) => {
    loadFailed.current = false
    setError(msg(e))
  }

  const state = status?.state
  // Audit 2026-11-07 #42: a failed first load is tried again (else no Start button ever comes). Each
  // try is scheduled after the last one failed, so tries never overlap.
  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const s = await refresh()
      if (s === null && !cancelled) retry = setTimeout(() => void load(), agentTiming.pollMs)
    }
    void load()
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [refresh])
  useEffect(() => {
    if (state !== 'running' && !(continuing && state !== 'done' && state !== 'failed')) return
    const t = setInterval(() => void refresh(), agentTiming.pollMs)
    return () => clearInterval(t)
  }, [state, continuing, refresh])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.startFiling(batch, true)
      await refresh()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const mark = (path: string, verdict: FilingVerdict) => {
    setVerdicts((v) => ({ ...v, [path]: verdict }))
    api.markFiling(batch, path, verdict).catch(fail)
  }
  const proceed = async () => {
    setContinuing(true)
    setError(null)
    try {
      await api.continueFiling(batch)
      await refresh()
    } catch (e) {
      setContinuing(false)
      fail(e)
    }
  }

  const items = status?.trial.items ?? []
  const marked = Object.values(verdicts)
  const right = marked.filter((v) => v === 'right').length
  const pct = marked.length > 0 ? Math.round((right / marked.length) * 100) : status?.trial.rightShare != null ? Math.round(status.trial.rightShare * 100) : null

  return (
    <section aria-labelledby="trial-heading" className="flex flex-col gap-3">
      <h3 id="trial-heading" tabIndex={-1} className="text-[14px] font-semibold outline-none">
        {T.trialHeading}
      </h3>
      <p className="text-[13px] text-fg-muted">{T.trialIntro}</p>
      {!status && !error && <p className="text-[13px] text-fg-muted">{T.loading}</p>}
      {state === 'idle' && (
        <div>
          <Button type="button" disabled={busy} onClick={() => void start()}>
            {busy ? T.starting : T.startTrial}
          </Button>
        </div>
      )}
      {state === 'running' && !continuing && (
        <p role="status" className="text-[13px]">
          {T.trialRunning}
        </p>
      )}
      {state === 'failed' && (
        <p role="alert" className="text-[13px] text-danger">
          {T.failed}
        </p>
      )}
      {(state === 'trial' || continuing) && items.length === 0 && <p className="text-[13px] text-fg-muted">{T.noTrialItems}</p>}
      {items.length > 0 && (
        <>
          <p role="status" aria-label="Accuracy" className="text-[13px] font-semibold">
            {pct == null ? T.noMarks : T.accuracy(right, marked.length || items.filter((i) => i.verdict).length, pct)}
          </p>
          <ul className="flex flex-col gap-2">
            {items.map((i) => (
              <TrialRow key={i.path} item={i} verdict={verdicts[i.path] ?? null} locked={continuing} onMark={(v) => mark(i.path, v)} />
            ))}
          </ul>
        </>
      )}
      {continuing && state !== 'failed' && (
        <p role="status" className="text-[13px]">
          {T.continuing}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" disabled={state !== 'trial' || continuing} onClick={() => void proceed()}>
          {T.continueRest}
        </Button>
      </div>
    </section>
  )
}

function TrialRow({
  item,
  verdict,
  locked,
  onMark,
}: {
  item: FilingTrialItem
  verdict: FilingVerdict | null
  locked: boolean
  onMark: (v: FilingVerdict) => void
}) {
  return (
    <li role="group" aria-label={item.title} className="flex flex-col gap-1 rounded-md border border-line p-2 text-[13px]">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">{item.title}</span>
        <span className="text-fg-muted">{item.type}</span>
        <span className="text-[12px] text-fg-muted">{T.confidence[item.confidence]}</span>
        <span className="ml-auto flex gap-1">
          {(['right', 'wrong'] as const).map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={verdict === v ? 'default' : 'outline'}
              aria-pressed={verdict === v}
              aria-label={T.markLabel(T[v], item.title)}
              disabled={locked}
              onClick={() => onMark(v)}
            >
              {T[v]}
            </Button>
          ))}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {item.values.map((v) => (
          <li key={v.key}>
            <span className="font-medium">{v.key}</span>: {Array.isArray(v.value) ? v.value.join(', ') : String(v.value)}
            {!v.ok && <span className="ml-1 text-danger">({T.valueRejected})</span>}
            <blockquote className="border-l-2 border-line pl-2 text-[12px] text-fg-muted">
              <span className="sr-only">{T.quote}: </span>
              {v.quote}
            </blockquote>
          </li>
        ))}
        {(
          [
            ['tags', T.tagsLabel],
            ['collections', T.collectionsLabel],
          ] as const
        ).flatMap(([field, label]) =>
          (item[field] ?? []).map((t, n) => (
            <li key={`${field}-${n}`}>
              <span className="font-medium">{label}</span>: {t.value}
              {!t.ok && <span className="ml-1 text-danger">({T.valueRejected})</span>}
              <blockquote className="border-l-2 border-line pl-2 text-[12px] text-fg-muted">
                <span className="sr-only">{T.quote}: </span>
                {t.quote}
              </blockquote>
            </li>
          )),
        )}
      </ul>
    </li>
  )
}
