// M23 Task 14: the work header's Confidence: a three-segment meter (High 3, Medium 2, Low 1,
// N/A or none 0) with the reason under it.
import type { JSX } from 'react'
import { cn } from '@/lib/utils'
import { WORK_TEXT } from '../workText'

const LEVELS: Record<string, number> = { high: 3, medium: 2, low: 1 }

/** How many of the three segments a confidence fills. */
function confidenceLevel(confidence: string | null | undefined): number {
  return LEVELS[(confidence ?? '').trim().toLowerCase()] ?? 0
}

export function ConfidenceMeter({ confidence, reason }: { confidence: string | null; reason?: string | null }): JSX.Element {
  const filled = confidenceLevel(confidence)
  const label = confidence?.trim() || 'N/A'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          role="meter"
          aria-label={WORK_TEXT.confidence}
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={filled}
          aria-valuetext={label}
          data-filled={filled}
          className="inline-flex items-center gap-0.5"
        >
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              data-segment=""
              data-on={i <= filled ? '' : undefined}
              className={cn('h-1.5 w-5 rounded-full', i <= filled ? 'bg-[var(--work-you)]' : 'bg-line')}
            />
          ))}
        </span>
        <span className="text-[12px] text-fg-muted">{label}</span>
      </div>
      {reason && <p className="text-[12px] text-fg-muted">{reason}</p>}
    </div>
  )
}
