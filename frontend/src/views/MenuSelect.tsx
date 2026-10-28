// A dropdown menu picker for the filter, sort and group editors, in place of a native <select>:
// a small trigger showing the current choice (icon + name), and a menu of rows with a check on
// the current one, styled like the layout picker.
import { useState, type ReactNode } from 'react'
import type { Icon as IconValue } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { kindIcon } from '@/properties/kinds'
import type { PropChoice } from './properties'

export interface MenuOption {
  value: string
  label: ReactNode
  /** An Iconify name or a property's icon value. */
  icon?: string | IconValue | null
}

export interface MenuSelectProps {
  /** The trigger's accessible name ("Operator", "Sort property"). */
  label: string
  value: string
  options: MenuOption[]
  onChange(value: string): void
  /** Shown when `value` matches no option. */
  placeholder?: ReactNode
  /** A heading row at the top of the menu. */
  heading?: string
  className?: string
  menuClassName?: string
}

export const TRIGGER =
  'flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-raised px-1.5 text-left text-[13px] text-fg outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-line'

function OptionIcon({ icon }: { icon: MenuOption['icon'] }) {
  if (!icon) return null
  return typeof icon === 'string' ? <Icon name={icon} size={14} /> : <IconOrEmoji icon={icon} size={14} fallback="ph-note-blank" />
}

export function MenuSelect({ label, value, options, onChange, placeholder, heading, className, menuClassName }: MenuSelectProps) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} aria-haspopup="menu" data-value={value} className={cn(TRIGGER, className)}>
          {current && <OptionIcon icon={current.icon} />}
          <span className={cn('min-w-0 flex-1 truncate', !current && 'text-fg-muted')}>{current ? current.label : placeholder}</span>
          <Icon name="ph-caret-down" size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        role="menu"
        aria-label={label}
        className={cn('max-h-72 w-auto min-w-44 overflow-y-auto border-line bg-raised p-1', menuClassName)}
      >
        {heading && <div className="px-2 py-1 text-[12px] text-fg-muted">{heading}</div>}
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={on}
              onClick={() => {
                setOpen(false)
                if (!on) onChange(o.value)
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
            >
              <OptionIcon icon={o.icon} />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {on && <Icon name="ph-check" size={14} />}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

/** Property choices as menu rows: each property's icon beside its name. */
export function propertyOptions(choices: PropChoice[]): MenuOption[] {
  return choices.map((c) => ({ value: c.key, label: c.name, icon: c.def.icon ?? kindIcon(c.kind) }))
}
