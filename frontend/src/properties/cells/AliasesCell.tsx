import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { lineColor } from '@/theme/palette'
import { placeholderFor } from '../format'
import { CELL_TEXT, type CellProps } from './types'

export const MAX_ALIASES = 8

/** Aliases: up to 8 unique names as chips, with an input that adds one on Enter. */
export function AliasesCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string[] | null>) {
  const aliases = value ?? []
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const name = draft.trim()
    if (!name) return
    if (aliases.some((a) => a.toLowerCase() === name.toLowerCase())) {
      setError('That alias is already in the list.')
      return
    }
    if (aliases.length >= MAX_ALIASES) {
      setError(`You can only add up to ${MAX_ALIASES} aliases.`)
      return
    }
    setError(null)
    setDraft('')
    onChange([...aliases, name])
  }

  return (
    <div className="flex flex-col gap-1 py-0.5">
      <div className="flex flex-wrap items-center gap-1">
        {aliases.map((a) => (
          <span key={a} className="inline-flex items-center gap-0.5 rounded-md bg-hover px-1.5 py-[1px] text-[13px] text-fg">
            {a}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${a}`}
                onClick={() => {
                  setError(null)
                  onChange(aliases.filter((x) => x !== a))
                }}
                className="flex h-4 w-4 items-center justify-center rounded text-fg-muted hover:text-fg"
              >
                <Icon name="ph-x" size={10} />
              </button>
            )}
          </span>
        ))}
        {readOnly && aliases.length === 0 && <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>}
        {!readOnly && (
          <input
            aria-label="Add alias"
            value={draft}
            placeholder={aliases.length === 0 ? placeholderFor(def, inTable ? 'table' : density) : ''}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onBlur={() => {
              if (draft.trim() && !error) add()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              } else if (e.key === 'Escape') {
                setDraft('')
                setError(null)
                e.currentTarget.blur()
              }
            }}
            className={`${CELL_TEXT} min-w-[6rem] flex-1`}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-[12px]" style={{ color: lineColor('red') }}>
          {error}
        </p>
      )}
    </div>
  )
}
