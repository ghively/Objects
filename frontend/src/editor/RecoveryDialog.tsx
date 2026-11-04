/**
 * Offers edits that could not be saved when the object was last left (see
 * `unsaved.ts`): save them over the version on disk, or discard them. Both texts
 * are shown side by side. The wording follows the voice-note recovery
 * ("Recover voice note", "…was kept locally before it
 * finished saving. You can save it … now.").
 */
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { stemOf } from '@/links/linkIndex'

export interface RecoveryDialogProps {
  open: boolean
  path: string
  /** The kept text. */
  kept: string
  /** The body now on disk. */
  onDisk: string
  /** Set while the last save of the kept text failed. */
  error?: string | null
  /** Set while the kept text is being saved: the buttons wait for it. */
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
}

function Pane({ label, text }: { label: string; text: string }) {
  const id = `recovery-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
      <h3 id={id} className="text-[13px] font-semibold text-fg-muted">
        {label}
      </h3>
      <pre
        aria-labelledby={id}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
      >
        {text}
      </pre>
    </section>
  )
}

export function RecoveryDialog({ open, path, kept, onDisk, error, saving, onSave, onDiscard }: RecoveryDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        // A choice is required: Escape and outside clicks don't dismiss.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[min(640px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] max-w-none flex-col gap-4 rounded-xl border-line bg-raised-2 p-5 text-fg sm:max-w-none"
      >
        <div>
          <DialogTitle className="text-[17px]">Recover unsaved changes</DialogTitle>
          <DialogDescription className="mt-1 text-[14px] text-fg-muted">
            {`Changes to “${stemOf(path)}” were kept locally before they finished saving. You can save them now, or discard them.`}
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 gap-3">
          <Pane label="Unsaved changes" text={kept} />
          <Pane label="Version on disk" text={onDisk} />
        </div>
        {error && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="h-9 rounded-lg bg-raised px-3 text-[14px] font-medium hover:bg-hover"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="h-9 rounded-lg bg-primary-btn px-3 text-[14px] font-medium text-app hover:opacity-90"
          >
            Save changes
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
