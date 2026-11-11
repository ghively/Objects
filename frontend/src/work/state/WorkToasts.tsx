// M23 Task 8: the Work section's toasts (problems, and the 5-second Undo). Mounted once by App.
// M32: nothing is drawn while Work is off for the space.
import type { JSX } from 'react'
import { useWorkOn } from '../useWorkOn'
import { WORK_TEXT } from '../workText'
import { runUndo, useWorkToasts } from './workToasts'

/** The work toasts; mounted once by App. */
export function WorkToasts(): JSX.Element | null {
  const toasts = useWorkToasts((s) => s.toasts)
  const on = useWorkOn()
  if (!on) return null
  return (
    <div
      data-work-toasts=""
      className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-1.5"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex max-w-[480px] items-center gap-3 rounded-lg border border-line bg-raised px-3.5 py-2 text-[13px] text-fg shadow-md"
        >
          <span>{t.text}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => void runUndo(t.id)}
              className="rounded px-1.5 font-medium text-[var(--work-you)] hover:bg-hover"
            >
              {WORK_TEXT.undo}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
