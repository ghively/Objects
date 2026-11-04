/** "Clear Whiteboard" confirmation. */
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { WB } from '../strings'

export interface ClearBoardDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  onConfirm(): void
}

export function ClearBoardDialog({ open, onOpenChange, onConfirm }: ClearBoardDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-line bg-raised-2 text-fg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px]">{WB.clearWhiteboardHeading.text}</AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] text-fg-muted">{WB.clearWhiteboardExplanation.text}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{WB.cancel.text}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {WB.clearWhiteboardConfirm.text}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
