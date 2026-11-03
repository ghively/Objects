/**
 * The object's "Export" dialog (M9; polish item 23, catalog section 10; Object's
 * `entity.settings.export.*`): format tiles PDF, Markdown, Microsoft Word and Latex.
 *
 * - PDF: Style cards Notes, Essay and Academic (all available, nothing gated), Options
 *   (Include embedded content, Include outline, Hide empty properties on by default, Show type
 *   labels), Format A4 | Letter and Properties (All properties plus one per property). The
 *   server builds a printable page (`format=html`); the dialog prints it from a hidden frame, so
 *   "Save as PDF" in the print dialog writes the file (our choice: no PDF library, no network).
 * - Markdown: Export folder containing all subpages (zip), Include media, Include title as
 *   heading 1, Links as wikilinks (on by default: the file's own form; our choice).
 * - Microsoft Word (.docx) and Latex (.tex): Object's tabs were not seen; they take the
 *   Properties list and Hide empty properties / Show type labels (our choice).
 *
 * Markdown is the format selected on open (our choice: Object's own file format).
 * "Export" saves pending body edits first, then downloads (or prints) and shows
 * "The export is ready and will be downloaded."
 */
import { type ReactNode, useEffect, useId, useState } from 'react'
import { api, type ExportProperty, type ExportUrlOptions } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { showToast } from '@/editor/media/upload'
import { downloadUrl } from '@/lib/download'
import { cn } from '@/lib/utils'

/** Reference strings (`entity.settings.*`; keys in the comments). */
export const EXPORT_TEXT = {
  heading: 'Export', // export.heading
  format: 'Format', // export.format.text
  pdf: 'PDF', // pdf.description
  markdown: 'Markdown', // md.description
  word: 'Microsoft Word', // docx.description
  latex: 'Latex', // latex.description
  style: 'Style', // typesetPdf.mode.text
  notes: 'Notes', // typesetPdf.mode.notes
  notesDescription: 'A PDF that matches the styling of the current page, including colors and embeds.',
  essay: 'Essay', // typesetPdf.mode.essay
  essayDescription: 'A single-column typeset PDF for reading and sharing. This is a layout, not a citation style.',
  academic: 'Academic', // typesetPdf.mode.academic
  academicDescription:
    'A compact two-column typeset PDF with numbered headings. This is a layout, not a journal submission format.',
  options: 'Options', // export.options.heading
  includeEmbedded: 'Include embedded content', // export.options.includeEmbedded.text
  includeEmbeddedDescription: "Embeds are included. Tags, queries, and collections aren't (PDF).",
  includeOutline: 'Include outline', // export.options.includeOutline.text
  includeOutlineDescription: 'Adds an outline of all headings at the top.',
  hideEmptyProperties: 'Hide empty properties', // export.options.hideEmptyProperties.text
  showTypeLabels: 'Show type labels', // export.options.showTypeLabels.text
  includeTreedown: 'Export folder containing all subpages', // export.options.includeTreedown.text
  includeTreedownDescription: 'Also exports linked subpages as a zip.',
  includeMedia: 'Include media', // export.options.includeMedia.text
  includeMediaDescription: 'Adds files and images to the zip.',
  includeTitleAsHeading: 'Include title as heading 1', // export.options.includeTitleAsHeading.text
  includeTitleAsHeadingDescription: 'Starts each item with its title as H1.',
  asWikiLink: 'Links as wikilinks', // export.options.asWikiLink.text
  asWikiLinkDescription: 'Export links as [[title]] instead of [title](path).',
  paper: 'Format', // export.format.text (the A4 | Letter row)
  a4: 'A4', // our string
  letter: 'Letter', // our string
  properties: 'Properties', // export.properties.heading
  propertiesDescription: 'Deselect properties to hide them from the export.', // export.properties.description
  allProperties: 'All properties', // export.properties.toggleAll
  button: 'Export', // export.button
  success: 'The export is ready and will be downloaded.', // export.success
} as const

export type ExportFormat = 'pdf' | 'md' | 'docx' | 'latex'
type PdfStyle = 'notes' | 'essay' | 'academic'

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'pdf', label: EXPORT_TEXT.pdf },
  { id: 'md', label: EXPORT_TEXT.markdown },
  { id: 'docx', label: EXPORT_TEXT.word },
  { id: 'latex', label: EXPORT_TEXT.latex },
]

const STYLES: { id: PdfStyle; label: string; description: string }[] = [
  { id: 'notes', label: EXPORT_TEXT.notes, description: EXPORT_TEXT.notesDescription },
  { id: 'essay', label: EXPORT_TEXT.essay, description: EXPORT_TEXT.essayDescription },
  { id: 'academic', label: EXPORT_TEXT.academic, description: EXPORT_TEXT.academicDescription },
]

export interface ExportDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  path: string
  /** Save pending edits before the download (rejects while a conflict is open). */
  prepare?(): Promise<unknown>
}

/** The download's file name: the object's file stem with the format's extension. */
export function exportFileName(path: string, media: boolean, format: ExportFormat = 'md', subpages = false): string {
  const stem = path.replace(/^.*\//, '').replace(/\.md$/i, '')
  if (format === 'docx') return `${stem}.docx`
  if (format === 'latex') return `${stem}.tex`
  if (format === 'pdf') return `${stem}.pdf`
  return `${stem}.${media || subpages ? 'zip' : 'md'}`
}

/** Print a same-origin page from a hidden frame (the PDF: "Save as PDF" in the print dialog). */
export function printUrl(url: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  const remove = () => window.setTimeout(() => frame.remove(), 1000)
  frame.addEventListener('load', () => {
    const win = frame.contentWindow
    if (!win) return remove()
    win.addEventListener('afterprint', remove)
    win.focus()
    win.print()
  })
  frame.src = url
  document.body.appendChild(frame)
}

interface ToggleRowProps {
  label: string
  description?: string
  checked: boolean
  onChange(v: boolean): void
  disabled?: boolean
}

function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <label htmlFor={id} className="text-[14px]">
          {label}
        </label>
        {description && <span className="text-[13px] text-fg-muted">{description}</span>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-fg-muted">{title}</h3>
      {children}
    </section>
  )
}

export function ExportDialog({ open, onOpenChange, path, prepare }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('md')
  // Markdown
  const [subpages, setSubpages] = useState(false)
  const [media, setMedia] = useState(false)
  const [titleH1, setTitleH1] = useState(false)
  const [wikilinks, setWikilinks] = useState(true)
  // PDF (and the property choices for Word and Latex)
  const [style, setStyle] = useState<PdfStyle>('notes')
  const [embedded, setEmbedded] = useState(true)
  const [outline, setOutline] = useState(false)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [typeLabels, setTypeLabels] = useState(false)
  const [paper, setPaper] = useState<'A4' | 'Letter'>('A4')
  const [props, setProps] = useState<ExportProperty[] | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allId = useId()

  const document_ = format !== 'md'
  useEffect(() => {
    if (!open || !document_ || props !== null) return
    let live = true
    api.exportProperties(path).then(
      (list) => live && setProps(list),
      () => live && setProps([]),
    )
    return () => {
      live = false
    }
  }, [open, document_, path, props])

  const options = (): ExportUrlOptions => {
    if (format === 'md') {
      // Only what differs from the defaults, so the plain export keeps its short URL.
      const o: ExportUrlOptions = { media }
      if (subpages) o.subpages = true
      if (titleH1) o.titleH1 = true
      if (!wikilinks) o.wikilinks = false
      return o
    }
    const o: ExportUrlOptions = {
      media: false,
      format: format === 'pdf' ? 'html' : format,
      hideEmpty,
      typeLabels,
      hide: [...hidden],
    }
    if (format === 'pdf') Object.assign(o, { style, paper, embedded, outline })
    return o
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await prepare?.()
      const opts = options()
      if (format === 'pdf') printUrl(api.exportObjectUrl(path, opts))
      else downloadUrl(api.exportObjectUrl(path, opts), exportFileName(path, media, format, subpages))
      if (format !== 'pdf') showToast(EXPORT_TEXT.success) // the PDF opens the print dialog instead
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleProp = (key: string, on: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (on) next.delete(key)
      else next.add(key)
      return next
    })
  const shownProps = (props ?? []).filter((p) => !(hideEmpty && p.empty))
  const allOn = shownProps.every((p) => !hidden.has(p.key))

  const propertyChoices = (
    <>
      <Section title={EXPORT_TEXT.options}>
        {format === 'pdf' && (
          <>
            <ToggleRow
              label={EXPORT_TEXT.includeEmbedded}
              description={EXPORT_TEXT.includeEmbeddedDescription}
              checked={embedded}
              onChange={setEmbedded}
              disabled={busy}
            />
            <ToggleRow
              label={EXPORT_TEXT.includeOutline}
              description={EXPORT_TEXT.includeOutlineDescription}
              checked={outline}
              onChange={setOutline}
              disabled={busy}
            />
          </>
        )}
        <ToggleRow label={EXPORT_TEXT.hideEmptyProperties} checked={hideEmpty} onChange={setHideEmpty} disabled={busy} />
        <ToggleRow label={EXPORT_TEXT.showTypeLabels} checked={typeLabels} onChange={setTypeLabels} disabled={busy} />
      </Section>
      {format === 'pdf' && (
        <Section title={EXPORT_TEXT.paper}>
          <div role="radiogroup" aria-label={EXPORT_TEXT.paper} className="flex w-fit rounded-md border border-line p-0.5">
            {(['A4', 'Letter'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={paper === p}
                onClick={() => setPaper(p)}
                className={cn('rounded px-3 py-1 text-[13px]', paper === p ? 'bg-raised text-fg' : 'text-fg-muted')}
              >
                {p === 'A4' ? EXPORT_TEXT.a4 : EXPORT_TEXT.letter}
              </button>
            ))}
          </div>
        </Section>
      )}
      {shownProps.length > 0 && (
        <Section title={EXPORT_TEXT.properties}>
          <span className="text-[13px] text-fg-muted">{EXPORT_TEXT.propertiesDescription}</span>
          <div className="flex items-center gap-2">
            <Checkbox
              id={allId}
              checked={allOn}
              onCheckedChange={(v) => setHidden(v === true ? new Set() : new Set(shownProps.map((p) => p.key)))}
            />
            <label htmlFor={allId} className="text-[14px] font-medium">
              {EXPORT_TEXT.allProperties}
            </label>
          </div>
          <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pl-6">
            {shownProps.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-[14px]">
                <Checkbox checked={!hidden.has(p.key)} onCheckedChange={(v) => toggleProp(p.key, v === true)} />
                {p.name}
              </label>
            ))}
          </div>
        </Section>
      )}
    </>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto border-line bg-raised-2 text-fg sm:max-w-[480px]"
        aria-describedby={undefined}
      >
        <DialogTitle className="text-[17px]">{EXPORT_TEXT.heading}</DialogTitle>
        <Section title={EXPORT_TEXT.format}>
          <div role="radiogroup" aria-label={EXPORT_TEXT.format} className="grid grid-cols-4 gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                disabled={busy}
                onClick={() => setFormat(f.id)}
                className={cn(
                  'flex h-14 items-center justify-center rounded-md border px-2 text-center text-[13px] leading-tight',
                  format === f.id ? 'border-primary bg-raised text-fg' : 'border-line text-fg-muted hover:bg-raised',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Section>

        {format === 'pdf' && (
          <Section title={EXPORT_TEXT.style}>
            <div role="radiogroup" aria-label={EXPORT_TEXT.style} className="flex flex-col gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={style === s.id}
                  onClick={() => setStyle(s.id)}
                  className={cn(
                    'flex flex-col rounded-md border px-3 py-2 text-left',
                    style === s.id ? 'border-primary bg-raised' : 'border-line hover:bg-raised',
                  )}
                >
                  <span className="text-[14px]">{s.label}</span>
                  <span className="text-[12px] text-fg-muted">{s.description}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {format === 'md' ? (
          <Section title={EXPORT_TEXT.options}>
            <ToggleRow
              label={EXPORT_TEXT.includeTreedown}
              description={EXPORT_TEXT.includeTreedownDescription}
              checked={subpages}
              onChange={setSubpages}
              disabled={busy}
            />
            <ToggleRow
              label={EXPORT_TEXT.includeMedia}
              description={EXPORT_TEXT.includeMediaDescription}
              checked={media}
              onChange={setMedia}
              disabled={busy}
            />
            <ToggleRow
              label={EXPORT_TEXT.includeTitleAsHeading}
              description={EXPORT_TEXT.includeTitleAsHeadingDescription}
              checked={titleH1}
              onChange={setTitleH1}
              disabled={busy}
            />
            <ToggleRow
              label={EXPORT_TEXT.asWikiLink}
              description={EXPORT_TEXT.asWikiLinkDescription}
              checked={wikilinks}
              onChange={setWikilinks}
              disabled={busy}
            />
          </Section>
        ) : (
          propertyChoices
        )}

        {error && (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button disabled={busy} onClick={() => void run()}>
            {EXPORT_TEXT.button}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
