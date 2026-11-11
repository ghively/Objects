/** Shown on an object this window moved to the Trash: "Deleted content", "Go back", "Undo Delete". */
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/Icon'
import { NOTE_LOWER } from '@/lib/words'

export const DELETED_TEXT = {
  heading: 'Deleted content',
  hint: `This ${NOTE_LOWER} is in the Trash.`,
  back: 'Go back',
  undo: 'Undo Delete',
}

export interface DeletedBannerProps {
  onBack?(): void
  onUndo?(): void
  busy?: boolean
  error?: string | null
}

export function DeletedBanner({ onBack, onUndo, busy, error }: DeletedBannerProps) {
  return (
    <div
      role="status"
      aria-label={DELETED_TEXT.heading}
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-danger/60 bg-raised px-3 py-2 text-[14px]"
    >
      <Icon name="ph-trash" size={16} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{DELETED_TEXT.heading}</p>
        <p className="text-fg-muted">{error ?? DELETED_TEXT.hint}</p>
      </div>
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack}>
          {DELETED_TEXT.back}
        </Button>
      )}
      {onUndo && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onUndo}>
          {DELETED_TEXT.undo}
        </Button>
      )}
    </div>
  )
}
