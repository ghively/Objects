/**
 * M26 wizard step "Check for sensitive content" (design section 6). Runs the local scan
 * (`POST /api/import/scan`, reads only) on the source folder with the user's "Leave out" list, shows each
 * flagged file with its findings (kind and line, never the value) and a per-file choice,
 * "Import, excluded from AI" (default) or "Leave out". Continue hands the result to the wizard:
 * the leave-out patterns plus the files to leave out and the files to import with `excludeFromAI`.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { scanSource, type ScanChoice, type ScanReport } from './scanApi'
import { SCAN_TEXT as T } from './text'

export interface ScanOutcome {
  /** The patterns typed in "Leave out", trimmed, empty lines dropped. */
  leaveOut: string[]
  /** Flagged files the user chose to leave out (relative paths). */
  leaveOutFiles: string[]
  /** Flagged files imported with `excludeFromAI: true` (relative paths). */
  excludeFromAi: string[]
  report: ScanReport
}

export function parsePatterns(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

export function ScanStep({
  sourcePath,
  onBack,
  onDone,
  scan = scanSource,
}: {
  sourcePath: string
  onBack?: () => void
  onDone: (outcome: ScanOutcome) => void
  scan?: typeof scanSource
}) {
  const [patterns, setPatterns] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ScanReport | null>(null)
  const [used, setUsed] = useState<string[]>([])
  const [choices, setChoices] = useState<Record<string, ScanChoice>>({})

  async function run() {
    setBusy(true)
    setError(null)
    const leaveOut = parsePatterns(patterns)
    try {
      const r = await scan(sourcePath, leaveOut)
      setReport(r)
      setUsed(leaveOut)
      setChoices(Object.fromEntries(Object.keys(r.findings).map((p) => [p, r.defaultChoice ?? 'excludeFromAi'])))
    } catch (e) {
      setReport(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function done() {
    if (!report) return
    const files = Object.keys(report.findings)
    onDone({
      leaveOut: used,
      leaveOutFiles: files.filter((f) => choices[f] === 'leaveOut'),
      excludeFromAi: files.filter((f) => choices[f] !== 'leaveOut'),
      report,
    })
  }

  const flagged = report ? Object.entries(report.findings) : []
  return (
    <section aria-labelledby="scan-heading" className="flex flex-col gap-3">
      <h3 id="scan-heading" className="text-[14px] font-semibold">
        {T.heading}
      </h3>
      <p className="text-[13px] text-fg-muted">{T.intro}</p>
      <label className="flex flex-col gap-1 text-[13px]">
        {T.leaveOutLabel}
        <textarea
          className="min-h-16 rounded-md border bg-background px-2 py-1 font-mono text-[12px]"
          value={patterns}
          onChange={(e) => setPatterns(e.target.value)}
          spellCheck={false}
        />
        <span className="text-[12px] text-fg-muted">{T.leaveOutHint}</span>
      </label>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={run}>
          {busy ? T.scanning : T.scan}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      {report && (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <p className="text-[13px]">
            {T.summary(report.counts.scanned, report.counts.flagged, report.counts.leftOut, report.counts.unscanned)}
          </p>
          {report.counts.unscanned > 0 && <p className="text-[13px] text-fg-muted">{T.uncheckedNote}</p>}
          {flagged.length === 0 ? (
            <p className="text-[13px] text-fg-muted">{T.noFindings}</p>
          ) : (
            <>
              <h4 className="text-[13px] font-semibold">{T.flaggedHeading}</h4>
              <ul className="flex flex-col gap-2">
                {flagged.map(([file, fs]) => (
                  <li key={file} className="rounded-md border p-2 text-[13px]">
                    <div className="truncate font-mono text-[12px]" title={file}>
                      {file}
                    </div>
                    <ul className="text-fg-muted">
                      {fs.map((f, i) => (
                        <li key={`${f.kind}-${f.line}-${i}`}>{T.finding(T.kinds[f.kind] ?? f.kind, f.line)}</li>
                      ))}
                    </ul>
                    <select
                      aria-label={T.choiceLabel(file)}
                      className="mt-1 rounded-md border bg-background px-2 py-1"
                      value={choices[file] ?? 'excludeFromAi'}
                      onChange={(e) => setChoices({ ...choices, [file]: e.target.value as ScanChoice })}
                    >
                      <option value="excludeFromAi">{T.excludeFromAi}</option>
                      <option value="leaveOut">{T.leaveOut}</option>
                    </select>
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.leftOut.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[13px]">{`${T.leftOutHeading} (${report.leftOut.length})`}</summary>
              <ul className="font-mono text-[12px] text-fg-muted">
                {report.leftOut.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack}>
            {T.back}
          </Button>
        )}
        <Button type="button" disabled={!report || busy} onClick={done}>
          {T.continue}
        </Button>
      </div>
    </section>
  )
}
