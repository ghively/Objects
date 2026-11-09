// Today's timeline captions: a block too short for its label and time (a 24-minute Morning brief is
// about 35px wide at 1440px and read "M…") hangs the two, on one line, under the track. Captions that
// would meet take the next row down. Pure; `TodayView` renders them.
import { DEFAULT_DAY_RANGE, type DayBlock, type DayRange } from './daySlots'

/** Blocks shorter than this (minutes) show their label and time as a caption under the track. */
export const SHORT_BLOCK_MINUTES = 50
/** The track's narrowest width (its `min-w`); the captions' scale until the track is measured. */
export const TRACK_MIN_PX = 640
/** The gap between the track and a caption, and between two captions in a row (px). */
export const CAPTION_GAP_PX = 4

export interface BlockCaption {
  /** The caption row under the track, 0 nearest it. */
  lane: number
  /** Hangs from the block's start, or from its end when it would run past the range's end. */
  align: 'start' | 'end'
}

/** A caption's width in minutes on a `trackPx` wide track (a generous guess: 12px label, 11px time). */
const captionMinutes = (b: DayBlock, trackPx: number, span: number): number => ((b.label.length * 6.5 + 76) / trackPx) * span

/** The short blocks' captions: each in the first row free at its span (greedy, in start order). */
export function blockCaptions(
  blocks: readonly DayBlock[],
  trackPx = TRACK_MIN_PX,
  range: DayRange = DEFAULT_DAY_RANGE,
): Map<DayBlock, BlockCaption> {
  const { start: DAY_START, end: DAY_END } = range
  const SPAN = DAY_END - DAY_START
  const clamp = (m: number) => Math.min(Math.max(m, DAY_START), DAY_END)
  const px = Math.max(trackPx, TRACK_MIN_PX)
  const gap = (CAPTION_GAP_PX / px) * SPAN
  const out = new Map<DayBlock, BlockCaption>()
  const laneEnds: number[] = []
  for (const b of [...blocks].sort((x, y) => x.start - y.start)) {
    const start = clamp(b.start)
    const end = clamp(b.end)
    if (end - start >= SHORT_BLOCK_MINUTES) continue
    const w = captionMinutes(b, px, SPAN)
    const align = start + w <= DAY_END ? 'start' : 'end'
    const from = align === 'start' ? start : Math.max(DAY_START, end - w)
    let lane = laneEnds.findIndex((e) => e + gap <= from)
    if (lane < 0) lane = laneEnds.push(0) - 1
    laneEnds[lane] = from + w
    out.set(b, { lane, align })
  }
  return out
}
