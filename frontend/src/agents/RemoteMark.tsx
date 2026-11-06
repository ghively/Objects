// M20: the small "remote" mark (spec section 2: "Remote agents show a small 'remote' mark"), on a
// remote agent's row in the Agents section, in the chat header's agent picker and on its page.
import { cn } from '@/lib/utils'
import { REMOTE_TEXT } from './agentText'

export function RemoteMark({ className }: { className?: string }) {
  return (
    <span
      data-remote-mark=""
      aria-label={REMOTE_TEXT.markLabel}
      title={REMOTE_TEXT.markLabel}
      className={cn(
        'inline-flex h-[16px] shrink-0 items-center rounded border border-line px-1 text-[11px] leading-none font-normal text-fg-muted',
        className,
      )}
    >
      {REMOTE_TEXT.mark}
    </span>
  )
}
