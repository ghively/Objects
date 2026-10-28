/**
 * The recorder chip shown while "Record audio" runs: a red dot, "Recording…"
 * (or "Paused"), the elapsed time, and Pause/Resume, Stop and Cancel (our
 * strings, `RECORD_TEXT`). It only drives the controls `recordAudio` hands it.
 */
import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'

/** Our strings. */
export const RECORD_TEXT = {
  recording: 'Recording…',
  paused: 'Paused',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  cancel: 'Cancel',
  denied: 'Microphone access was denied.',
  failed: 'The recording could not be saved.',
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Elapsed time as `m:ss` (or `h:mm:ss` past an hour). */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** What the chip drives. */
export interface RecordingControls {
  /** Milliseconds recorded so far, pauses excluded. */
  elapsed(): number
  paused(): boolean
  pause(): void
  resume(): void
  stop(): void
  cancel(): void
}

const TICK_MS = 250

export function AudioRecorder({ controls }: { controls: RecordingControls }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])
  const paused = controls.paused()
  const rerender = () => setTick((n) => n + 1)

  const btn =
    'flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg hover:bg-hover focus-visible:outline focus-visible:outline-1'
  return (
    <div
      role="group"
      aria-label={RECORD_TEXT.recording}
      data-testid="audio-recorder"
      className="flex items-center gap-2 rounded-full border border-line bg-raised py-1 pr-1 pl-3 text-[14px] text-fg shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      <span
        aria-hidden
        className={`size-2.5 rounded-full ${paused ? 'bg-fg-muted' : 'animate-pulse bg-red-500'}`}
      />
      <span>{paused ? RECORD_TEXT.paused : RECORD_TEXT.recording}</span>
      <span className="tabular-nums text-fg-muted" data-testid="audio-recorder-elapsed">
        {elapsedText(controls.elapsed())}
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => {
          if (paused) controls.resume()
          else controls.pause()
          rerender()
        }}
      >
        <Icon name={paused ? 'ph-play' : 'ph-pause'} size={14} />
        {paused ? RECORD_TEXT.resume : RECORD_TEXT.pause}
      </button>
      <button type="button" className={btn} onClick={() => controls.stop()}>
        <Icon name="ph-stop" size={14} />
        {RECORD_TEXT.stop}
      </button>
      <button type="button" className={btn} onClick={() => controls.cancel()}>
        {RECORD_TEXT.cancel}
      </button>
    </div>
  )
}
