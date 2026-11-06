// M16: the model picker (spec section 11), used in the chat header (this chat's model) and in
// Settings > AI Assistant > Model (the default agent's model). Its rows come from the served list:
// Default, "Latest" (the CLI's aliases), "Versions" (pinned ids), a current custom value, Custom….
import { useEffect, useId, useRef, useState } from 'react'
import type { AiModelChoice } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { MODEL_TEXT as T, isModelName, modelLabel, useAiModels } from './models'

export interface ModelPickerProps {
  value: string | null
  onChange(next: string | null): void
  /** The "Default" row's text, e.g. "Default" or "Default (Sonnet 5.5)". The trigger says "Default" with no pick. */
  defaultLabel: string
  ariaLabel: string
  /** Header use: a small borderless trigger. */
  compact?: boolean
  disabled?: boolean
}

type Row =
  | { kind: 'model'; key: string; value: string | null; label: string }
  | { kind: 'custom'; key: string; disabled: boolean }

export function ModelPicker({ value, onChange, defaultLabel, ariaLabel, compact, disabled }: ModelPickerProps) {
  const models = useAiModels()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'list' | 'custom'>('list')
  const [active, setActive] = useState(0)
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const uid = useId()

  const aliases: AiModelChoice[] = models?.models.filter((m) => m.kind === 'alias') ?? []
  const ids: AiModelChoice[] = models?.models.filter((m) => m.kind === 'id') ?? []
  const known = !!models?.models.some((m) => m.id === value)
  const rows: Row[] = [{ kind: 'model', key: 'default', value: null, label: defaultLabel }]
  for (const m of [...aliases, ...ids]) rows.push({ kind: 'model', key: `m:${m.id}`, value: m.id, label: m.label })
  if (models && value !== null && !known) rows.push({ kind: 'model', key: 'current', value, label: value })
  rows.push({ kind: 'custom', key: 'custom', disabled: !models })
  const selectedIndex = Math.max(
    0,
    rows.findIndex((r) => r.kind === 'model' && r.value === value),
  )
  const example = ids[0]?.id

  useEffect(() => {
    if (open && mode === 'list') listRef.current?.focus()
  }, [open, mode])

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (next) {
      setMode('list')
      setActive(selectedIndex)
      setText('')
      setBad(false)
    }
  }

  const pick = (row: Row) => {
    if (row.kind === 'custom') {
      if (row.disabled) return
      setMode('custom')
      setText(value !== null && !known ? value : '')
      setBad(false)
      return
    }
    onChange(row.value)
    setOpen(false)
  }

  const save = () => {
    const name = text.trim()
    if (!isModelName(name, models)) {
      setBad(true)
      return
    }
    onChange(name)
    setOpen(false)
  }

  const move = (delta: number) => {
    setActive((i) => {
      let next = i
      for (let n = 0; n < rows.length; n++) {
        next = (next + delta + rows.length) % rows.length
        const r = rows[next]
        if (!(r.kind === 'custom' && r.disabled)) return next
      }
      return i
    })
  }

  const optionId = (i: number) => `${uid}-opt-${i}`

  const renderRow = (row: Row, i: number) => {
    const isDisabled = row.kind === 'custom' && row.disabled
    const selected = row.kind === 'model' && row.value === value
    return (
      <div
        key={row.key}
        id={optionId(i)}
        role="option"
        aria-selected={selected}
        aria-disabled={isDisabled || undefined}
        onMouseEnter={() => !isDisabled && setActive(i)}
        onClick={() => pick(row)}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[14px]',
          i === active && !isDisabled && 'bg-hover',
          isDisabled && 'cursor-default text-fg-muted opacity-60',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{row.kind === 'custom' ? T.custom : row.label}</span>
        {selected && <Icon name="ph-check" size={14} />}
      </div>
    )
  }

  const heading = (id: string, label: string) => (
    <div id={id} className="px-2 pb-0.5 pt-1.5 text-[12px] font-medium text-fg-muted">
      {label}
    </div>
  )

  // Rows by index: 0 Default, then aliases, then ids, then the optional current value and Custom….
  const aliasStart = 1
  const idStart = aliasStart + aliases.length
  const restStart = idStart + ids.length

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'flex items-center gap-1 text-left disabled:opacity-50',
            compact
              ? 'h-7 max-w-[200px] rounded-md px-1.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg'
              : 'h-8 w-full max-w-[420px] rounded-md border border-line bg-transparent px-2 text-[14px] text-fg hover:border-fg-muted',
          )}
        >
          <span className="min-w-0 flex-1 truncate">{value === null ? T.default : modelLabel(value, models, defaultLabel)}</span>
          <Icon name="ph-caret-down" size={compact ? 12 : 14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[260px] border-line bg-raised p-1 text-fg"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          listRef.current?.focus()
        }}
        onEscapeKeyDown={(e) => {
          if (mode === 'custom') {
            e.preventDefault()
            setMode('list')
            setBad(false)
          }
        }}
      >
        {mode === 'list' ? (
          <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={0}
            aria-activedescendant={optionId(active)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                move(1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                move(-1)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const row = rows[active]
                if (row) pick(row)
              }
            }}
            className="max-h-[320px] overflow-y-auto outline-none"
          >
            {renderRow(rows[0], 0)}
            {aliases.length > 0 && (
              <div role="group" aria-labelledby={`${uid}-latest`}>
                {heading(`${uid}-latest`, T.latest)}
                {rows.slice(aliasStart, idStart).map((r, j) => renderRow(r, aliasStart + j))}
              </div>
            )}
            {ids.length > 0 && (
              <div role="group" aria-labelledby={`${uid}-versions`}>
                {heading(`${uid}-versions`, T.versions)}
                {rows.slice(idStart, restStart).map((r, j) => renderRow(r, idStart + j))}
              </div>
            )}
            {rows.slice(restStart).map((r, j) => renderRow(r, restStart + j))}
          </div>
        ) : (
          <div className="p-1">
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                aria-label="Model id"
                aria-invalid={bad || undefined}
                placeholder={example ? T.customPlaceholder.replace('{id}', example) : undefined}
                value={text}
                spellCheck={false}
                onChange={(e) => {
                  setText(e.target.value)
                  setBad(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    save()
                  }
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
              />
              <button
                type="button"
                onClick={save}
                className="h-8 rounded-md border border-line px-2.5 text-[13px] text-fg hover:bg-hover"
              >
                {T.save}
              </button>
            </div>
            {bad && (
              <p role="alert" className="px-0.5 pt-1.5 text-[13px] text-[var(--danger)]">
                {T.badName}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
