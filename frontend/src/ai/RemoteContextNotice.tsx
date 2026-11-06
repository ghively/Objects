/**
 * M20: the notice before the first send of context to a remote agent (spec section 7: "the first
 * time Gene sends context to a remote agent, a notice says so (once per remote agent)"). A dialog
 * with Send and Cancel (the plan's guess 6); closing it any other way is Cancel.
 */
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { REMOTE_CHAT_TEXT as R } from './aiText'

export interface RemoteContextNoticeProps {
  open: boolean
  agentName: string
  host: string
  onSend(): void
  onCancel(): void
}

export function RemoteContextNotice({ open, agentName, host, onSend, onCancel }: RemoteContextNoticeProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} className="border-line bg-raised-2 text-fg sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{R.noticeTitle}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{R.noticeBody(agentName, host)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {R.noticeCancel}
          </Button>
          <Button type="button" autoFocus onClick={onSend}>
            {R.noticeSend}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
