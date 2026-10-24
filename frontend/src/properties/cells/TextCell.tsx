import { useEffect, useRef, useState } from 'react'
import { placeholderFor } from '../format'
import { CELL_TEXT, type CellProps } from './types'

/**
 * A single line of plain text (`text`). Commits on blur and Enter; Esc blurs, which commits. An
 * empty text commits `null`; an unchanged text commits nothing.
 */
export function TextCell({ def, value, readOnly, onChange }: CellProps<string | null>) {
  const [text, setText] = useState(value ?? '')
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value ?? '')
  }, [value])

  const commit = () => {
    const next = text === '' ? null : text
    if (next !== (value ?? null) && !(next === null && !value)) onChange(next)
  }

  return (
    <input
      aria-label={def.name}
      value={text}
      readOnly={readOnly}
      placeholder={placeholderFor(def)}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false
        if (!readOnly) commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className={CELL_TEXT}
    />
  )
}
