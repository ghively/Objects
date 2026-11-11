/**
 * Asks before a type edit that changes objects' values (the server answered 428): shows the
 * server's explanation and how many files would change. Confirm resends the edit with `confirm`.
 */
import { NOTE_LOWER, NOTES_LOWER } from '@/lib/words'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface ConfirmChangesDialogProps {
  open: boolean
  detail: string
  affected: number
  onConfirm(): void
  onCancel(): void
}

export function ConfirmChangesDialog({ open, detail, affected, onConfirm, onCancel }: ConfirmChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="border-line bg-raised-2 text-fg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px]">Apply changes?</AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] text-fg-muted">{detail}</AlertDialogDescription>
        </AlertDialogHeader>
        <p data-affected={affected} className="text-[14px]">
          {affected === 1 ? `1 ${NOTE_LOWER} will change.` : `${affected} ${NOTES_LOWER} will change.`}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
