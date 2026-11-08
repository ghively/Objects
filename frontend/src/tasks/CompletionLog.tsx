// "Completion Log" under "Task Stats": the recurring task's
// occurrence log, newest first, each entry its scheduled date and action ("Completed", "Skipped",
// "Excused"). An entry can be deleted after a confirm ("Remove this entry from the log?");
// the owner writes the remaining log lines (an unparseable line is never listed and always kept),
// so the file changes only by that entry's line. Deleting the last line removes the key.
import { useState } from 'react'
import { Icon } from '@/components/Icon'
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
import { formatDate } from '@/properties/format'

export const COMPLETION_LOG_TEXT = {
  heading: 'Completion Log',
  deleteTitle: 'Remove this entry from the log?',
  deleteDescription: 'It will be gone from the task history for good.',
  cancel: 'Cancel',
  delete: 'Delete',
} as const

const T = COMPLETION_LOG_TEXT

/** For the logged actions. */
const ACTION_LABEL = { completed: 'Completed', skipped: 'Skipped', excused: 'Excused' } as const
type LoggedAction = keyof typeof ACTION_LABEL

export interface LogEntry {
  /** The entry's line index in the raw log. */
  line: number
  scheduled: string
  action: LoggedAction
  at: string
}

const SCHEDULED = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z)?$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** The log's valid entries in file order (oldest first); other lines are skipped. */
export function parseLogEntries(raw: string | null | undefined): LogEntry[] {
  if (!raw) return []
  const out: LogEntry[] = []
  raw.split('\n').forEach((text, line) => {
    const parts = text.trim().split(/\s+/)
    if (parts.length !== 3) return
    const [scheduled, action, at] = parts
    if (!SCHEDULED.test(scheduled) || !INSTANT.test(at) || !(action in ACTION_LABEL)) return
    out.push({ line, scheduled, action: action as LoggedAction, at })
  })
  return out
}

/** The raw log without line `line`; null when nothing is left (remove the key). */
export function withoutLine(raw: string, line: number): string | null {
  const lines = raw.split('\n')
  lines.splice(line, 1)
  return lines.length === 0 || lines.every((l) => l.trim() === '') ? null : lines.join('\n')
}

const scheduledText = (s: string) => formatDate({ start: s, resolution: s.length === 10 ? 'day' : 'time' })

export function CompletionLog({
  log,
  readOnly = false,
  onChange,
}: {
  /** The raw `occurrenceLog` text. */
  log: string | null | undefined
  readOnly?: boolean
  /** Write the log (`null`: remove the key). */
  onChange(next: string | null): void
}) {
  const [pending, setPending] = useState<LogEntry | null>(null)
  const entries = parseLogEntries(log).reverse()
  if (entries.length === 0) return null
  return (
    <section aria-label={T.heading} className="mt-4 flex flex-col gap-1" data-testid="completion-log">
      <h3 className="text-[14px] font-semibold text-fg">{T.heading}</h3>
      <ul className="flex flex-col">
        {entries.map((e) => (
          <li
            key={e.line}
            className="group flex h-8 items-center justify-between gap-2 rounded-md px-2 text-[14px] hover:bg-hover"
            title={formatDate({ start: e.at, resolution: 'time' })}
          >
            <span className="truncate text-fg">{scheduledText(e.scheduled)}</span>
            <span className="flex items-center gap-1">
              <span className="text-fg-muted" data-action={e.action}>
                {ACTION_LABEL[e.action]}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`${T.delete} ${scheduledText(e.scheduled)}`}
                  title={T.delete}
                  onClick={() => setPending(e)}
                  className="flex size-6 items-center justify-center rounded-md text-fg-muted opacity-0 hover:bg-line hover:text-fg focus:opacity-100 group-hover:opacity-100"
                >
                  <Icon name="ph-trash" size={14} />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="border-line bg-raised-2 text-fg">
          <AlertDialogHeader>
            <AlertDialogTitle>{T.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-fg-muted">{T.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--danger)] text-white hover:opacity-90"
              onClick={() => {
                if (pending && log) onChange(withoutLine(log, pending.line))
                setPending(null)
              }}
            >
              {T.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
