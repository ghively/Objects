// The preview's summary: where the export came from, what it holds (objects, types, properties,
// links that will resolve, attachments, repeated titles), the skipped items and the warnings.
// Objects per type, and each type's properties with their guessed kinds, are in the mapping rows.
import type { ImportPreview, ImportSourceKind } from '@/api/types'
import { Icon } from '@/components/Icon'
import { formatBytes } from './mapping'
import { IMPORT_TEXT as T } from './text'

export function PreviewSummary({
  preview,
  chosenKind,
  updating,
}: {
  preview: ImportPreview
  chosenKind: ImportSourceKind | 'auto'
  updating: boolean
}) {
  const c = preview.counts
  const detected = chosenKind === 'auto' && preview.detected === preview.kind
  const shownSkipped = preview.skipped.length
  return (
    <section aria-labelledby="import-summary-heading" className="flex flex-col gap-2">
      <h3 id="import-summary-heading" tabIndex={-1} className="text-[14px] font-semibold outline-none">
        {T.summaryHeading}
      </h3>
      <p className="truncate font-mono text-[12px] text-fg-muted" title={preview.sourcePath}>
        {preview.sourcePath}
      </p>
      <p className="text-[13px] text-fg-muted">{T.sourceLine(T.kinds[preview.kind], preview.container, detected)}</p>
      <p role="status" aria-live="polite" className="text-[14px]">
        {T.summary(c.objects, c.types, c.attachments)}
        {updating && <span className="ml-2 text-[13px] text-fg-muted">{T.updating}</span>}
      </p>
      <ul className="flex flex-col gap-0.5 text-[13px] text-fg-muted" aria-label={T.summaryHeading}>
        <li>{T.properties(c.properties)}</li>
        <li>{T.links(c.resolvedLinks, c.links)}</li>
        <li>{T.attachments(c.attachments, formatBytes(c.attachmentBytes))}</li>
        {c.renamed > 0 && <li>{T.renamed(c.renamed)}</li>}
        <li>{T.skippedCount(c.skipped)}</li>
      </ul>
      {preview.warnings.length > 0 && (
        <section aria-label={T.warningsHeading} className="flex gap-2 rounded-lg bg-hover/60 p-3 text-[13px]">
          <Icon name="ph-warning" size={16} className="mt-0.5 shrink-0" />
          <ul className="flex flex-col gap-1">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      {shownSkipped > 0 && (
        <details className="rounded-lg border border-line text-[13px]">
          <summary className="cursor-pointer px-3 py-2 font-semibold">
            {T.skippedHeading} ({c.skipped})
          </summary>
          <div className="max-h-48 overflow-y-auto px-3 pb-2">
            {c.skipped > shownSkipped && <p className="mb-1 text-fg-muted">{T.skippedShown(shownSkipped, c.skipped)}</p>}
            <ul className="flex flex-col gap-1">
              {preview.skipped.map((s, i) => (
                <li key={`${s.path}-${i}`} className="min-w-0">
                  <span className="break-all font-mono text-[12px]">{s.path}</span>
                  <span className="text-fg-muted">
                    {' '}
                    · {T.reasons[s.reason] ?? s.reason}
                    {s.detail ? ` · ${s.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  )
}
