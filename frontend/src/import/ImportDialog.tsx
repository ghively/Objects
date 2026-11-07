/**
 * M15 "Import from another app" (our string): a Notion Markdown & CSV export, an Obsidian vault or
 * an Anytype Markdown export, as a `.zip` or a folder named by its path, is read into a dry-run
 * preview (`api.importPreview`, nothing written), the user reviews the mappings (types and property
 * kinds), picks the target (a new space by default, or this space when picked) and starts the
 * import (`api.startImport`), whose progress is polled (`api.importJob`) until it is done, failed
 * or stopped ("Stop import", `api.cancelImport`). The finish offers "Switch space" for a new space
 * and "Open import report" for this space. Contract: `docs/superpowers/plans/2026-11-05-m15-importers.md`.
 *
 * Steps: source (path, "Exported from", "Preview") -> review (the summary, "Review mappings",
 * "Import into", "Import"; every mapping or target change re-previews after 300 ms) -> running
 * (progress, "Stop import"; the dialog can't be closed) -> finished.
 *
 * Review fixes: the mapping holds only what the user changed, the rest is the latest preview's
 * (finding 4); a start refused with 404 (the preview expired or was dropped) reads the export again
 * and waits for the user (finding 15); a job that ends into this space reloads this window's
 * objects and types (`announceResync`, finding 2).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { announceResync, api, ApiError } from '@/api/client'
import type {
  ImportJob,
  ImportKeepOriginals,
  ImportMapping,
  ImportPhase,
  ImportPreview,
  ImportSourceKind,
  ImportTarget,
} from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { openObject } from '@/create/createAndOpen'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { parentFolder } from '@/spaces/CreateSpaceDialog'
import { switchSpace } from '@/spaces/switchSpace'
import { AgentFlow } from './agent/AgentFlow'
import { AGENT_TEXT } from './agent/text'
import { BatchPanel } from './BatchPanel'
import { ImportOptions } from './ImportOptions'
import { MappingEditor } from './MappingEditor'
import { cleanMapping, cleanSourcePath, emptyMapping, seedMapping, type ImportTargetKind } from './mapping'
import { ScanStep, type ScanOutcome } from './scan/ScanStep'
import { PreviewSummary } from './PreviewSummary'
import { TargetPicker } from './TargetPicker'
import { IMPORT_TEXT } from './text'
import { useImportDialog } from './useImportDialog'

export { IMPORT_TEXT } from './text'

const T = IMPORT_TEXT

const KINDS: (ImportSourceKind | 'auto')[] = ['auto', 'notion', 'obsidian', 'anytype', 'files']

/** How often a running job is polled, and how long a mapping change waits before re-previewing (our choices; tests shorten them). */
export const importTiming = { pollMs: 500, debounceMs: 300 }

const OVER: ReadonlySet<ImportPhase> = new Set(['done', 'failed', 'cancelled'])

type Step = 'source' | 'scan' | 'review' | 'running' | 'finished' | 'agent'

/** Ids the dialog moves focus to when a step opens. */
const FOCUS_ID: Record<Step, string> = {
  source: 'import-source-path',
  scan: 'scan-heading',
  review: 'import-summary-heading',
  running: 'import-progress-heading',
  finished: 'import-finish-heading',
  agent: 'proposal-heading',
}

function previewError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return T.notFound
    if (err.status === 415) return T.notZip
    if (err.status === 413) return T.tooLarge
  }
  return err instanceof Error ? err.message : String(err)
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function ImportDialog() {
  const isOpen = useImportDialog((s) => s.isOpen)
  const preset = useImportDialog((s) => s.preset)
  const space = useSpaceInfo((s) => s.space)

  const [step, setStep] = useState<Step>('source')
  // Source.
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<ImportSourceKind | 'auto'>('auto')
  const [source, setSource] = useState<{ path: string; kind: ImportSourceKind | 'auto' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Review.
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping)
  const [defaultTypeKey, setDefaultTypeKey] = useState<string | null>(null)
  const [target, setTarget] = useState<ImportTargetKind>('newSpace')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [location, setLocation] = useState('')
  // M25: keep originals as, and the scratch copy (the default for a first run into this space).
  const [keepOriginals, setKeepOriginals] = useState<ImportKeepOriginals>('attachments')
  const [tryCopy, setTryCopy] = useState(false)
  const [copyTouched, setCopyTouched] = useState(false)
  const [copyName, setCopyName] = useState('')
  const [firstRun, setFirstRun] = useState(true)
  // M27: the scan step's choices, carried into the import request.
  const [scanOutcome, setScanOutcome] = useState<ScanOutcome | null>(null)
  const [rev, setRev] = useState(0)
  const [updating, setUpdating] = useState(false)
  const [stale, setStale] = useState(false)
  const [starting, setStarting] = useState(false)
  /** Shown after a start found the preview expired and the export was read again (finding 15). */
  const [notice, setNotice] = useState<string | null>(null)
  // Running and finished.
  const [jobId, setJobId] = useState<string | null>(null)
  const [targetPath, setTargetPath] = useState<string | null>(null)
  const [startedInto, setStartedInto] = useState<ImportTargetKind>('newSpace')
  const [job, setJob] = useState<ImportJob | null>(null)
  const [stopping, setStopping] = useState(false)
  const [lost, setLost] = useState(false)

  const seq = useRef(0)
  const lastStep = useRef<Step>('source')
  /** The last start answered 404 and the export is being, or was, read again: a second 404 is not an expiry. */
  const reread = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    void useSpaceInfo.getState().ensure()
    seq.current++
    setStep('source')
    lastStep.current = 'source'
    setPath('')
    setKind(preset.kind ?? 'auto')
    setSource(null)
    setBusy(false)
    setError(null)
    setPreview(null)
    setMapping(emptyMapping())
    setDefaultTypeKey(null)
    setTarget('newSpace')
    setName(preset.name ?? '')
    setNameTouched(!!preset.name)
    setLocation(preset.location ?? '')
    setKeepOriginals('attachments')
    setTryCopy(false)
    setCopyTouched(false)
    setCopyName('')
    setFirstRun(true)
    setScanOutcome(null)
    setRev(0)
    setUpdating(false)
    setStale(false)
    setStarting(false)
    setNotice(null)
    reread.current = false
    setJobId(null)
    setTargetPath(null)
    setStartedInto('newSpace')
    setJob(null)
    setStopping(false)
    setLost(false)
  }, [isOpen, preset])

  // M25: a source never imported into this space before starts on a copy of it (design section 7).
  useEffect(() => {
    if (step !== 'review' || !source) return
    let alive = true
    api
      .importBatches()
      .then((all) => {
        if (alive) setFirstRun(!all.some((b) => b.source.path === source.path))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [step, source])
  useEffect(() => {
    if (!copyTouched) setTryCopy(target === 'currentSpace' && firstRun)
  }, [target, firstRun, copyTouched])
  useEffect(() => {
    if (space?.name) setCopyName((n) => n || T.copyDefaultName(space.name))
  }, [space?.name])

  // The new space's location defaults to the folder that holds the open space.
  const root = space?.root ?? null
  useEffect(() => {
    if (isOpen && root) setLocation((l) => l || parentFolder(root))
  }, [isOpen, root])

  // Focus follows the step (the source step's field focuses itself when the dialog opens).
  useEffect(() => {
    if (lastStep.current === step) return
    lastStep.current = step
    document.getElementById(FOCUS_ID[step])?.focus()
  }, [step])

  const running = step === 'running'

  const close = () => {
    if (running) return
    seq.current++
    useImportDialog.getState().close()
  }

  // ---- Source -> preview ----

  const read = async (e?: FormEvent) => {
    e?.preventDefault()
    const p = cleanSourcePath(path)
    if (!p || busy) return
    if (p !== path) setPath(p)
    const my = ++seq.current
    setBusy(true)
    setError(null)
    try {
      const res = await api.importPreview({ source: { path: p, kind } })
      if (my !== seq.current) return
      setSource({ path: p, kind })
      setPreview(res)
      setMapping(seedMapping(res.mapping))
      setDefaultTypeKey(res.mapping.typeKey)
      setTarget('newSpace')
      setRev(0)
      setUpdating(false)
      setStale(false)
      setNotice(null)
      reread.current = false
      if (!nameTouched) setName(res.suggestedName)
      setScanOutcome(null)
      setStep('scan')
    } catch (err) {
      if (my === seq.current) setError(previewError(err))
    } finally {
      if (my === seq.current) setBusy(false)
    }
  }

  // ---- Review: every change re-previews, debounced ----

  const repreview = () => {
    setUpdating(true)
    setRev((r) => r + 1)
  }
  const changeMapping = (next: ImportMapping) => {
    setMapping(next)
    setNotice(null)
    repreview()
  }
  const changeTarget = (next: ImportTargetKind) => {
    if (next === target) return
    setTarget(next)
    setNotice(null)
    repreview()
  }

  useEffect(() => {
    if (rev === 0 || !source) return
    const my = ++seq.current
    const timer = setTimeout(() => {
      api
        .importPreview({ source, mapping: cleanMapping(mapping, target), target })
        .then((res) => {
          if (my !== seq.current) return
          setPreview(res)
          setStale(false)
          setError(null)
        })
        .catch((err: unknown) => {
          if (my !== seq.current) return
          setStale(true)
          setError(previewError(err))
        })
        .finally(() => {
          if (my === seq.current) setUpdating(false)
        })
    }, importTiming.debounceMs)
    return () => clearTimeout(timer)
  }, [rev, source, mapping, target])

  const copying = target === 'currentSpace' && tryCopy
  const newSpaceReady =
    target === 'currentSpace' ? !copying || (copyName.trim() !== '' && location.trim() !== '') : name.trim() !== '' && location.trim() !== ''
  const canImport = !!preview && !updating && !stale && !starting && newSpaceReady

  const start = async () => {
    if (!preview || !canImport) return
    const into: ImportTarget =
      target === 'newSpace'
        ? { kind: 'newSpace', name: name.trim(), location: location.trim() }
        : copying
          ? { kind: 'spaceCopy', name: copyName.trim(), location: location.trim() }
          : { kind: 'currentSpace' }
    setStarting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.startImport({
        previewId: preview.previewId,
        mapping: cleanMapping(mapping, target),
        target: into,
        ...(preview.kind === 'files' ? { keepOriginals } : {}),
        ...(scanOutcome &&
        (scanOutcome.leaveOut.length || scanOutcome.leaveOutFiles.length || scanOutcome.excludeFromAi.length)
          ? {
              scan: {
                leaveOut: scanOutcome.leaveOut,
                leaveOutFiles: scanOutcome.leaveOutFiles,
                excludeFromAi: scanOutcome.excludeFromAi,
              },
            }
          : {}),
      })
      reread.current = false
      setJobId(res.jobId)
      setTargetPath(res.targetPath)
      setStartedInto(into.kind === 'currentSpace' ? 'currentSpace' : 'newSpace')
      setJob(null)
      setStep('running')
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && !reread.current) {
        // The server dropped the preview (expired, or a newer read replaced it): read the export
        // again with the same request and let the user check it before importing (finding 15).
        // A 404 right after reading again is something else (a new space's location that isn't a
        // folder): its message is shown.
        reread.current = true
        setNotice(T.previewExpired)
        repreview()
      } else {
        reread.current = false
        setError(message(err))
      }
    } finally {
      setStarting(false)
    }
  }

  // ---- Running: poll the job until it is over ----

  useEffect(() => {
    if (!jobId) return
    let alive = true
    // A job that wrote into the open space (done, stopped, failed, or forgotten by a restarted
    // server) reloads this window's objects and types once: the server's end-of-import resync may
    // not reach this window (finding 2).
    const finishedHere = () => {
      if (startedInto === 'currentSpace') announceResync()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const j = await api.importJob(jobId)
        if (!alive) return
        setJob(j)
        if (OVER.has(j.phase)) {
          finishedHere()
          setStep('finished')
          return
        }
      } catch (err) {
        if (!alive) return
        // A server restart forgets jobs: nothing more to wait for.
        if (err instanceof ApiError && err.status === 404) {
          finishedHere()
          setLost(true)
          setStep('finished')
          return
        }
        // Anything else (the server busy, a dropped request): keep polling.
      }
      timer = setTimeout(() => void tick(), importTiming.pollMs)
    }
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // `startedInto` is set with `jobId` and doesn't change while the job runs.
  }, [jobId, startedInto])

  const stop = () => {
    if (!jobId || stopping) return
    setStopping(true)
    api.cancelImport(jobId).catch((err: unknown) => {
      setStopping(false)
      setError(message(err))
    })
  }

  // ---- Finished ----

  const result = job?.result ?? null
  const finalPath = result?.targetPath || job?.targetPath || targetPath
  const switchNow = () => {
    if (!finalPath) return
    useImportDialog.getState().close()
    void switchSpace(finalPath)
  }
  const openReport = () => {
    if (!result?.reportPath) return
    useImportDialog.getState().close()
    openObject(result.reportPath)
  }
  const offerSwitch = startedInto === 'newSpace' && !!finalPath && !lost

  return (
    <Dialog open={isOpen} onOpenChange={(o) => (o ? useImportDialog.getState().open(preset) : close())}>
      <DialogContent
        showCloseButton={!running}
        onEscapeKeyDown={(e) => {
          if (running) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (running) e.preventDefault()
        }}
        className="max-h-[85vh] overflow-y-auto border-line bg-raised-2 text-fg sm:max-w-[640px]"
      >
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.title}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{T.description}</DialogDescription>
        </DialogHeader>

        {step === 'source' && (
          <form onSubmit={(e) => void read(e)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              {T.source}
              <input
                id={FOCUS_ID.source}
                autoFocus
                value={path}
                placeholder={T.sourcePlaceholder}
                spellCheck={false}
                onChange={(e) => setPath(e.target.value)}
                className="h-9 rounded-md border border-line bg-transparent px-2 font-mono text-[13px] font-normal outline-none focus:border-fg-muted"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              {T.kind}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ImportSourceKind | 'auto')}
                className="h-9 rounded-md border border-line bg-raised px-2 text-[14px] font-normal"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {T.kinds[k]}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {T.cancel}
              </Button>
              <Button type="submit" disabled={!path.trim() || busy}>
                {busy ? T.reading : T.preview}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'scan' && source && (
          <ScanStep
            sourcePath={source.path}
            onBack={() => setStep('source')}
            onDone={(o) => {
              setScanOutcome(o)
              setStep('review')
            }}
          />
        )}

        {step === 'review' && preview && (
          // Not a form: Enter in a name field never starts the import, only the Import button does.
          <div className="flex flex-col gap-4">
            <PreviewSummary preview={preview} chosenKind={source?.kind ?? 'auto'} updating={updating} />
            <MappingEditor
              preview={preview}
              mapping={mapping}
              onChange={changeMapping}
              target={target}
              spaceTypes={space?.types ?? []}
              defaultTypeKey={defaultTypeKey}
            />
            <TargetPicker
              target={target}
              onTarget={changeTarget}
              name={name}
              onName={(n) => {
                setName(n)
                setNameTouched(true)
              }}
              location={location}
              onLocation={setLocation}
              spaceName={space?.name ?? null}
            />
            <ImportOptions
              kind={preview.kind}
              target={target}
              keepOriginals={keepOriginals}
              onKeepOriginals={setKeepOriginals}
              tryCopy={tryCopy}
              onTryCopy={(v) => {
                setCopyTouched(true)
                setTryCopy(v)
              }}
              copyName={copyName}
              onCopyName={setCopyName}
            />
            {notice && (
              <p role="alert" className="text-[13px]">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                onClick={() => {
                  seq.current++
                  setError(null)
                  setNotice(null)
                  setUpdating(false)
                  setStep('source')
                }}
              >
                {T.back}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                {T.cancel}
              </Button>
              <Button type="button" disabled={!canImport} onClick={() => void start()}>
                {starting ? T.importing : T.import}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'agent' && result?.batch && <AgentFlow batch={result.batch} onClose={close} />}

        {step === 'running' && <Progress job={job} stopping={stopping} onStop={stop} error={error} />}

        {step === 'finished' && (
          <section aria-labelledby={FOCUS_ID.finished} className="flex flex-col gap-3">
            <h3 id={FOCUS_ID.finished} tabIndex={-1} className="text-[14px] font-semibold outline-none">
              {lost
                ? T.jobLost
                : job?.phase === 'cancelled' || result?.cancelled
                  ? T.stopped
                  : job?.phase === 'failed'
                    ? T.failed
                    : startedInto === 'newSpace'
                      ? T.finished
                      : T.finishedHere}
            </h3>
            {job?.phase === 'failed' && job.error && (
              <p role="alert" className="text-[13px] text-danger">
                {job.error}
              </p>
            )}
            {result && (
              <>
                <p className="text-[14px]">{T.result(result)}</p>
                {result.skipped > 0 && <p className="text-[13px] text-fg-muted">{T.resultSkipped(result.skipped)}</p>}
                <BatchPanel result={result} inOpenSpace={startedInto === 'currentSpace'} />
              </>
            )}
            {startedInto === 'currentSpace' && result?.batch && !lost && job?.phase === 'done' && (
              <div className="flex flex-col gap-1 rounded-md border border-line p-3">
                <h4 className="text-[13px] font-semibold">{AGENT_TEXT.continueHeading}</h4>
                <p className="text-[13px] text-fg-muted">{AGENT_TEXT.continueIntro}</p>
                <div>
                  <Button type="button" variant="outline" onClick={() => setStep('agent')}>
                    {AGENT_TEXT.continueButton}
                  </Button>
                </div>
              </div>
            )}
            {offerSwitch && (
              <p className="truncate font-mono text-[12px] text-fg-muted" title={finalPath ?? undefined}>
                {finalPath}
              </p>
            )}
            <DialogFooter>
              {offerSwitch ? (
                <>
                  <Button type="button" variant="ghost" onClick={close}>
                    {T.later}
                  </Button>
                  <Button type="button" onClick={switchNow}>
                    {T.switchNow}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant={result?.reportPath ? 'ghost' : 'default'} onClick={close}>
                    {T.close}
                  </Button>
                  {result?.reportPath && (
                    <Button type="button" onClick={openReport}>
                      {T.openReport}
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Progress({
  job,
  stopping,
  onStop,
  error,
}: {
  job: ImportJob | null
  stopping: boolean
  onStop(): void
  error: string | null
}) {
  const done = job?.done ?? 0
  const total = job?.total ?? 0
  const max = Math.max(total, 1)
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const announced = useAnnouncedProgress(job)
  return (
    <section aria-labelledby={FOCUS_ID.running} className="flex flex-col gap-3">
      <h3 id={FOCUS_ID.running} tabIndex={-1} className="text-[14px] font-semibold outline-none">
        {T.importing}
      </h3>
      <div
        role="progressbar"
        aria-label={T.progress}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(done, max)}
        aria-valuetext={T.importingCount(done, total)}
        className="h-2 overflow-hidden rounded-full bg-hover"
      >
        <div className="h-full rounded-full bg-fg transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[14px]">{T.importingCount(done, total)}</p>
      <p role="status" className="sr-only">
        {announced}
      </p>
      <p className="truncate text-[13px] text-fg-muted" title={job?.currentPath ?? undefined}>
        {job ? T.phases[job.phase] : T.phases.preparing}
        {job?.currentPath ? ` · ${job.currentPath}` : ''}
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onStop} disabled={stopping}>
          {stopping ? T.stopping : T.stop}
        </Button>
      </DialogFooter>
    </section>
  )
}

/**
 * The progress a screen reader hears: it changes when the phase changes and every tenth of the
 * way, not on every poll (review O3; the visible count still follows every poll).
 */
function useAnnouncedProgress(job: ImportJob | null): string {
  const phase = job?.phase ?? 'preparing'
  const done = job?.done ?? 0
  const total = job?.total ?? 0
  const tenth = total > 0 ? Math.floor((Math.min(done, total) * 10) / total) : 0
  const [announced, setAnnounced] = useState({ key: '', text: '' })
  const key = `${phase}|${tenth}`
  if (announced.key !== key) setAnnounced({ key, text: T.progressStatus(T.phases[phase], done, total) })
  return announced.key === key ? announced.text : T.progressStatus(T.phases[phase], done, total)
}
