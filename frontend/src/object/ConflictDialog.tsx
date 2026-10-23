/**
 * Asks what to do when an object's file changed on disk while it had unsaved
 * edits: keep mine (save my text over the new version) or take theirs (drop my
 * edits and load the file). Both texts are shown side by side.
 */
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { stemOf } from '@/links/linkIndex'

export interface ConflictDialogProps {
  open: boolean
  path: string
  /** The editor's current body (with the unsaved edits). */
  mine: string
  /** The body now on disk. */
  theirs: string
  onKeepMine: () => void
  onTakeTheirs: () => void
}

function Pane({ label, text }: { label: string; text: string }) {
  const id = `conflict-${label.toLowerCase().replace(/\s+/g, '-')}`
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

export function ConflictDialog({ open, path, mine, theirs, onKeepMine, onTakeTheirs }: ConflictDialogProps) {
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
          <DialogTitle className="text-[17px]">“{stemOf(path)}” changed on disk</DialogTitle>
          <DialogDescription className="mt-1 text-[14px] text-fg-muted">
            The file was changed outside Object while you had unsaved edits. Nothing has been overwritten yet.
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 gap-3">
          <Pane label="Your version" text={mine} />
          <Pane label="Version on disk" text={theirs} />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onTakeTheirs}
            className="h-9 rounded-lg bg-raised px-3 text-[14px] font-medium hover:bg-hover"
          >
            Take theirs
          </button>
          <button
            type="button"
            onClick={onKeepMine}
            className="h-9 rounded-lg bg-primary-btn px-3 text-[14px] font-medium text-app hover:opacity-90"
          >
            Keep mine
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
