// M23 Task 8: a text-and-dot chip in one of the Work tones (Design language: never a filled badge).
import type { JSX, ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'

export type ChipTone = 'you' | 'agent' | 'others' | 'approve' | 'critical' | 'high' | 'ok' | 'capture' | 'muted'

/** Each tone's text colour, a theme token (T17's `--work-*`). */
export const TONE_TEXT: Record<ChipTone, string> = {
  you: 'text-[var(--work-you)]',
  agent: 'text-[var(--work-agent)]',
  others: 'text-[var(--work-others)]',
  approve: 'text-[var(--work-approve)]',
  critical: 'text-[var(--work-critical)]',
  high: 'text-[var(--work-high)]',
  ok: 'text-[var(--work-ok)]',
  capture: 'text-[var(--work-capture)]',
  muted: 'text-fg-muted',
}

/** A dot (or the icon) and the text, in the tone's colour. */
export function Chip({ tone, icon, children }: { tone: ChipTone; icon?: string; children: ReactNode }): JSX.Element {
  return (
    <span data-tone={tone} className={cn('inline-flex min-w-0 items-center gap-1 text-[12px] leading-5', TONE_TEXT[tone])}>
      {icon ? (
        <Icon name={icon} size={12} />
      ) : (
        <svg aria-hidden="true" width="6" height="6" viewBox="0 0 6 6" className="shrink-0">
          <circle cx="3" cy="3" r="3" fill="currentColor" />
        </svg>
      )}
      <span className="truncate">{children}</span>
    </span>
  )
}
