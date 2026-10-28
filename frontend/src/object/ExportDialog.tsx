/**
 * The object's "Export" dialog (M9, Capacities' `entity.settings.export.*`): Format "Markdown"
 * and the option "Include media" ("Adds files and images to the zip."). "Export" saves pending
 * body edits, then downloads `GET /api/object/export` (the `.md` as on disk, or a zip with its
 * media) and shows "The export is ready and will be downloaded."
 * Capacities' other formats (PDF, Microsoft Word, LaTeX) and options are not offered: the file
 * already is Markdown with wikilinks (our choice, listed for Gene).
 */
import { useId, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { showToast } from '@/editor/media/upload'
import { downloadUrl } from '@/lib/download'

/** Reference strings (`entity.settings.export.*`, `entity.settings.md.description`). */
export const EXPORT_TEXT = {
  heading: 'Export',
  format: 'Format',
  markdown: 'Markdown',
  options: 'Options',
  includeMedia: 'Include media',
  includeMediaDescription: 'Adds files and images to the zip.',
  button: 'Export',
  success: 'The export is ready and will be downloaded.',
} as const

export interface ExportDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  path: string
  /** Save pending edits before the download (rejects while a conflict is open). */
  prepare?(): Promise<unknown>
}

/** The download's file name: the object's file stem, `.md` or `.zip`. */
export function exportFileName(path: string, media: boolean): string {
  const stem = path.replace(/^.*\//, '').replace(/\.md$/i, '')
  return `${stem}.${media ? 'zip' : 'md'}`
}

export function ExportDialog({ open, onOpenChange, path, prepare }: ExportDialogProps) {
  const [media, setMedia] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mediaId = useId()

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await prepare?.()
      downloadUrl(api.exportObjectUrl(path, { media }), exportFileName(path, media))
      showToast(EXPORT_TEXT.success)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[420px]" aria-describedby={undefined}>
        <DialogTitle className="text-[17px]">{EXPORT_TEXT.heading}</DialogTitle>
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-fg-muted">{EXPORT_TEXT.format}</h3>
          <div className="flex h-9 items-center rounded-md border border-line bg-raised px-3 text-[14px]">
            {EXPORT_TEXT.markdown}
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-fg-muted">{EXPORT_TEXT.options}</h3>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col">
              <label htmlFor={mediaId} className="text-[14px]">
                {EXPORT_TEXT.includeMedia}
              </label>
              <span className="text-[13px] text-fg-muted">{EXPORT_TEXT.includeMediaDescription}</span>
            </div>
            <Switch id={mediaId} checked={media} onCheckedChange={setMedia} disabled={busy} />
          </div>
        </section>
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
