import { useEffect, useRef, useState } from 'react'
import { placeholderFor } from '../format'
import { CELL_TEXT, type CellProps } from './types'

/**
 * The description: multi-line plain text that grows with its content. Enter commits (Shift+Enter
 * adds a line); blur commits; empty commits `null`.
 */
export function DescriptionCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string | null>) {
  const [text, setText] = useState(value ?? '')
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value ?? '')
  }, [value])

  const commit = () => {
    const next = text.trim() === '' ? null : text
    if (next !== (value || null)) onChange(next)
  }

  return (
    <textarea
      aria-label={def.name || 'Description'}
      value={text}
      readOnly={readOnly}
      rows={1}
      placeholder={placeholderFor(def, inTable ? 'table' : density)}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false
        if (!readOnly) commit()
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className={`${CELL_TEXT} field-sizing-content resize-none`}
    />
  )
}
