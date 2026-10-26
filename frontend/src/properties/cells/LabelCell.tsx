import { useState } from 'react'
import type { PropertyDef } from '@/api/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { placeholderFor } from '../format'
import { LabelMenu, LabelPill } from '../LabelMenu'
import type { CellProps } from './types'

export interface LabelCellProps extends CellProps<string[] | null> {
  /** Saves an edited option set (the parent saves the type before it applies the value). */
  onDefChange?(next: PropertyDef): void | Promise<void>
  /** Opens the property's settings (from the menu's gear). */
  onOpenSettings?(): void
}

/** A label (single or multi-select): pills; a click opens the LabelMenu. */
export function LabelCell({ def, value, readOnly, density, onChange, onDefChange, onOpenSettings }: LabelCellProps) {
  const [open, setOpen] = useState(false)
  const selected = value ?? []
  const set = def.options.set ?? []
  const table = density === 'table'
  const pills = selected.map((text) => {
    const option = set.find((o) => o.text === text) ?? { text, color: null, icon: null }
    return <LabelPill key={text} option={option} className={table ? 'px-1.5 py-0 text-[12px]' : undefined} />
  })
  const shown =
    pills.length > 0 ? (
      <span className={table ? 'flex flex-nowrap gap-1' : 'flex flex-wrap gap-1'}>{pills}</span>
    ) : (
      <span className="text-[15px] text-fg-muted">{placeholderFor(def)}</span>
    )
  if (readOnly) return <div className="py-0.5">{shown}</div>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Edit ${def.name}`} className="w-full py-0.5 text-left">
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
        <LabelMenu
          def={def}
          value={selected}
          onChange={onChange}
          onDefChange={onDefChange ?? (() => undefined)}
          onClose={() => setOpen(false)}
          onOpenSettings={
            onOpenSettings &&
            (() => {
              setOpen(false)
              onOpenSettings()
            })
          }
        />
      </PopoverContent>
    </Popover>
  )
}
