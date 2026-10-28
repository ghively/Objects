/**
 * The focus timer (`ComponentHeader.focusMode.timer.*`): a floating control shown while focus
 * mode is on or a session runs, and the "Focus time completed" dialog. Its placement (bottom
 * right of the window) is our choice. It reads and drives `useFocusMode`; nothing here writes a file.
 */
import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { DEFAULT_FOCUS_MINUTES, FOCUS_PRESETS, FOCUS_TEXT, formatRemaining, timeLeft, useFocusMode } from './useFocusMode'

/** Re-renders every second while `active`; finishes the timer when it reaches zero. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

const PILL = 'flex h-10 items-center gap-1 rounded-xl border border-[var(--float-border)] bg-[var(--float-bg)] px-1 text-fg shadow-sm'
const BTN = 'flex h-8 items-center gap-1.5 rounded-md px-2 text-[14px] hover:bg-hover'

function TimerButton({ label, icon, onClick }: { label: string; icon: string; onClick(): void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex size-8 items-center justify-center rounded-md hover:bg-hover">
      <Icon name={icon} size={16} />
    </button>
  )
}

function DurationChooser() {
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState(DEFAULT_FOCUS_MINUTES)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={BTN} title={FOCUS_TEXT.chooseDuration}>
          <Icon name="ph-timer" size={16} />
          {FOCUS_TEXT.label}
          <span className="text-fg-muted">{FOCUS_TEXT.idleDuration(minutes)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-64 border-line bg-raised p-3">
        <div className="text-[13px] font-medium text-fg-muted">{FOCUS_TEXT.chooseDuration}</div>
        <div role="radiogroup" aria-label={FOCUS_TEXT.chooseDuration} className="mt-2 grid grid-cols-4 gap-1">
          {FOCUS_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === minutes}
              onClick={() => setMinutes(m)}
              className={cn(
                'h-8 rounded-md border text-[13px] hover:bg-hover',
                m === minutes ? 'border-fg-muted bg-line' : 'border-line',
              )}
            >
              {FOCUS_TEXT.preset(m)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[14px] text-fg">{FOCUS_TEXT.prompt(minutes)}</p>
        <button
          type="button"
          onClick={() => {
            useFocusMode.getState().startTimer(minutes)
            setOpen(false)
          }}
          className="mt-2 h-8 w-full rounded-md bg-primary-btn px-3 text-[14px] font-medium text-app hover:opacity-90"
        >
          {FOCUS_TEXT.start(minutes)}
        </button>
      </PopoverContent>
    </Popover>
  )
}

function CompletedDialog() {
  const completed = useFocusMode((s) => s.completed)
  const dismiss = () => useFocusMode.getState().dismissCompleted()
  return (
    <Dialog open={!!completed} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="border-line bg-raised sm:max-w-sm" showCloseButton={false}>
        <DialogTitle>{FOCUS_TEXT.completeTitle}</DialogTitle>
        <DialogDescription>
          {completed
            ? completed.minutes !== null
              ? FOCUS_TEXT.completeBody(completed.minutes)
              : FOCUS_TEXT.completeBodySeconds(completed.seconds)
            : null}
        </DialogDescription>
        <DialogFooter>
          <button type="button" onClick={dismiss} className="h-8 rounded-md bg-primary-btn px-3 text-[14px] font-medium text-app hover:opacity-90">
            {FOCUS_TEXT.continue}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The floating timer control (when `show` or a session runs) and the completion dialog. */
export function FocusTimer({ show }: { show: boolean }) {
  const timer = useFocusMode((s) => s.timer)
  const running = timer.minutes !== null && timer.endsAt !== null
  const now = useTick(running)
  const left = timeLeft(timer, now)
  const active = timer.minutes !== null

  useEffect(() => {
    if (running && left <= 0) useFocusMode.getState().finishTimer()
  }, [running, left])

  const s = useFocusMode.getState()
  return (
    <>
      {(show || active) && (
        <div data-focus-timer="" className="fixed right-4 bottom-4 z-40">
          {active ? (
            <div className={PILL}>
              <span role="timer" className="px-2 text-[14px] tabular-nums">
                {FOCUS_TEXT.running(formatRemaining(left))}
              </span>
              {running ? (
                <TimerButton label={FOCUS_TEXT.pause} icon="ph-pause" onClick={() => s.pauseTimer()} />
              ) : (
                <TimerButton label={FOCUS_TEXT.resume} icon="ph-play" onClick={() => s.resumeTimer()} />
              )}
              <TimerButton label={FOCUS_TEXT.stop} icon="ph-stop" onClick={() => s.stopTimer()} />
              <TimerButton label={FOCUS_TEXT.cancel} icon="ph-x" onClick={() => s.cancelTimer()} />
            </div>
          ) : (
            <div className={PILL}>
              <DurationChooser />
            </div>
          )}
        </div>
      )}
      <CompletedDialog />
    </>
  )
}

export default FocusTimer
