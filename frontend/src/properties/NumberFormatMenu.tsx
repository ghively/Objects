import { useState, type ReactNode } from 'react'
import type { NumberFormat } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { CURRENCIES } from './currencies'
import type { NumberFormatChoice } from './typeEdits'

export interface NumberFormatMenuProps {
  value: NumberFormat | undefined
  onChange(next: NumberFormatChoice): void
}

const STANDARD: readonly { choice: Exclude<NumberFormatChoice, object>; name: string; icon: string }[] = [
  { choice: 'none', name: 'None', icon: 'ph-text-t' },
  { choice: 'number', name: 'Number', icon: 'ph-hash' },
  { choice: 'percentage', name: 'Percentage', icon: 'ph-percent' },
  { choice: 'progress', name: 'Progress', icon: 'ph-chart-bar-horizontal' },
]

function Item({ selected, onClick, icon, children }: { selected: boolean; onClick(): void; icon: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[14px] hover:bg-hover',
        selected && 'font-medium',
      )}
    >
      <Icon name={icon} size={14} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Icon name="ph-check" size={13} />}
    </button>
  )
}

/** The number format picker: "Standard" formats and "Currencies", with search. */
export function NumberFormatMenu({ value, onChange }: NumberFormatMenuProps) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const current = value?.type ?? 'none'
  const standard = STANDARD.filter((s) => !q || s.name.toLowerCase().includes(q))
  const currencies = CURRENCIES.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.symbol.includes(q),
  )
  return (
    <div className="w-64 text-fg">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Choose a format"
        aria-label="Choose a format"
        className="mb-1 w-full rounded border border-line bg-transparent px-2 py-1 text-[14px] outline-none"
      />
      <div className="max-h-80 overflow-auto">
        {standard.length > 0 && (
          <>
            <div className="px-2 pt-1 text-[12px] font-semibold text-fg-muted">Standard</div>
            {standard.map((s) => (
              <Item key={s.choice} icon={s.icon} selected={current === s.choice} onClick={() => onChange(s.choice)}>
                {s.name}
              </Item>
            ))}
          </>
        )}
        {currencies.length > 0 && (
          <>
            <div className="px-2 pt-2 text-[12px] font-semibold text-fg-muted">Currencies</div>
            {currencies.map((c) => (
              <Item
                key={c.code}
                icon="ph-currency-circle-dollar"
                selected={current === 'currency' && value?.options.currency === c.code}
                onClick={() => onChange({ currency: c.code })}
              >
                {`${c.name} (${c.symbol})`}
              </Item>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
