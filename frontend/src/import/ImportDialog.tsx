/**
 * M15 "Import from another app" (our string): a Notion Markdown & CSV export, an Obsidian vault or
 * an Anytype Markdown export, as a `.zip` or a folder named by its path, is read into a dry-run
 * preview (`api.importPreview`, nothing written), the user reviews the mappings (types and property
 * kinds), picks the target (a new space by default, or this space) and starts the import
 * (`api.startImport`), whose progress is polled (`api.importJob`). Contract:
 * `docs/superpowers/plans/2026-11-05-m15-importers.md`.
 *
 * T1 stub: the source step and the preview call only. Lane U builds the mapping step, the target,
 * progress, cancel and the finish ("Switch space", the Import report).
 */
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import type { ImportPreview, ImportSourceKind } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useImportDialog } from './useImportDialog'

/** Every label is our string (the behaviour catalog doesn't specify the import dialog). */
export const IMPORT_TEXT = {
  title: 'Import from another app',
  description: 'Object reads the export and shows what it will import. Nothing is written until you choose Import.',
  source: 'Zip file or folder',
  sourcePlaceholder: 'Full path of the .zip file or folder',
  kind: 'Exported from',
  kinds: { auto: 'Detect automatically', notion: 'Notion', obsidian: 'Obsidian', anytype: 'Anytype' } as Record<
    ImportSourceKind | 'auto',
    string
  >,
  preview: 'Preview',
  reading: 'Reading…',
  mappings: 'Review mappings',
  typesFrom: 'Make types from',
  typesFromFolder: 'Top-level folders',
  typesFromKey: 'A frontmatter key',
  typesFromNone: 'Nothing (everything is a Page)',
  target: 'Import into',
  newSpace: 'A new space',
  thisSpace: 'This space',
  name: 'Name',
  location: 'Location',
  import: 'Import',
  importing: 'Importing…',
  stop: 'Stop import',
  cancel: 'Cancel',
  finished: 'Import finished. Switch to the new space now?',
  finishedHere: 'Import finished.',
  switchNow: 'Switch space',
  later: 'Later',
  openReport: 'Open import report',
  stopped: 'The import stopped. What was written so far is kept.',
  /** The preview's summary line. */
  summary: (objects: number, types: number, attachments: number) =>
    `${objects} objects, ${types} types, ${attachments} attachments`,
} as const

const T = IMPORT_TEXT

const KINDS: (ImportSourceKind | 'auto')[] = ['auto', 'notion', 'obsidian', 'anytype']

export function ImportDialog() {
  const isOpen = useImportDialog((s) => s.isOpen)
  const preset = useImportDialog((s) => s.preset)
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<ImportSourceKind | 'auto'>('auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setPath('')
    setKind(preset.kind ?? 'auto')
    setBusy(false)
    setError(null)
    setPreview(null)
  }, [isOpen, preset])

  const close = () => useImportDialog.getState().close()

  const read = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!path.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await api.importPreview({ source: { path: path.trim(), kind } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => (o ? useImportDialog.getState().open(preset) : close())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-line bg-raised-2 text-fg sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.title}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{T.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void read(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {T.source}
            <input
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
          {preview && (
            <p role="status" className="text-[14px]">
              {T.summary(preview.counts.objects, preview.counts.types, preview.counts.attachments)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {T.cancel}
            </Button>
            <Button type="submit" disabled={!path.trim() || busy}>
              {busy ? T.reading : T.preview}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
