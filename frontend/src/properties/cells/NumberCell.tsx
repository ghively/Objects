import { useEffect, useRef, useState } from 'react'
import type { NumberFormat } from '@/api/types'
import { useSettings } from '@/settings/useSettings'
import { lineColor } from '@/theme/palette'
import { formatNumber, parseNumberInput, placeholderFor, progressFraction } from '../format'
import { CELL_TEXT, type CellProps } from './types'

const DEBOUNCE_MS = 250

/**
 * A number. While focused it edits the plain number and saves 250 ms after typing stops and on
 * blur; an empty input saves `null` and text that isn't a number is ignored. Unfocused it shows
 * the number in its format, and a progress format also shows a bar of the steps done. Shown and
 * typed numbers follow the "Decimal separator" setting (`format.ts`'s `usesRadixComma`).
 */
export function NumberCell({ def, value, readOnly, density, inTable, onChange }: CellProps<number | null>) {
  const fmt = def.options.numberFormat ?? null
  // Re-render when the separator or the language (which `automatic` follows) changes.
  useSettings((s) => `${s.settings.decimalSeparator}|${s.settings.language}`)
  // A percentage stores the fraction (0.25) and is edited as the percent (25).
  const scale = fmt?.type === 'percentage' ? 100 : 1
  const editFmt: NumberFormat = { type: 'number', options: { separators: fmt?.options.separators } }
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const last = useRef<number | null>(value)
  // The text the field showed on focus: leaving it unchanged writes nothing.
  const initial = useRef('')
  // The last value saved or received: a save of the same number is skipped.
  useEffect(() => {
    last.current = value
  }, [value])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const save = (s: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const typed = parseNumberInput(s, fmt)
    if (typed === undefined) return
    const n = typed === null ? null : scale === 1 ? typed : typed / scale
    if (n === last.current) return
    last.current = n
    onChange(n)
  }

  const shown = focused ? text : formatNumber(value, fmt)
  const isProgress = fmt?.type === 'progress'
  const pct = Math.round(progressFraction(value, fmt) * 100)

  return (
    <div className="flex items-center gap-3">
      <input
        aria-label={def.name}
        inputMode="decimal"
        value={shown}
        readOnly={readOnly}
        placeholder={placeholderFor(def, inTable ? 'table' : density)}
        onFocus={() => {
          setFocused(true)
          // The last value saved or received (the row may not have caught up with a save yet).
          const cur = last.current
          initial.current =
            cur === null || cur === undefined ? '' : formatNumber(scale === 1 ? cur : Number((cur * scale).toPrecision(12)), editFmt)
          setText(initial.current)
        }}
        onChange={(e) => {
          const s = e.target.value
          setText(s)
          if (readOnly) return
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => save(s), DEBOUNCE_MS)
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current)
          timer.current = null
          if (!readOnly && text !== initial.current) save(text)
          setFocused(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className={`${CELL_TEXT} ${isProgress ? 'w-16 shrink-0' : ''}`}
      />
      {isProgress && value !== null && value !== undefined && (
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover-2"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            data-testid="progress-bar"
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: lineColor(fmt?.options.progress?.color ?? 'blue') }}
          />
        </div>
      )}
    </div>
  )
}
