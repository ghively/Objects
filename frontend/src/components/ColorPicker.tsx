import { colorName, lineColor, THEME_COLORS, themeColor, type ThemeColor } from '@/theme/palette'
import { cn } from '@/lib/utils'

export interface ColorPickerProps {
  /** The current colour (`teal`, or a tag's `bg-teal`); null or unknown selects nothing. */
  value: string | null | undefined
  onChange(next: ThemeColor): void
  className?: string
}

/** Object's 18 theme colours as swatches, in menu order. There is no "none" option. */
export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const current = value ? themeColor(value) : null
  return (
    <div role="group" aria-label="Color" className={cn('grid grid-cols-9 gap-1', className)}>
      {THEME_COLORS.map((c) => {
        const selected = current === c && !!value
        return (
          <button
            key={c}
            type="button"
            aria-label={colorName(c)}
            title={colorName(c)}
            aria-pressed={selected}
            onClick={() => onChange(c)}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full border-2 border-transparent hover:border-fg-muted',
              selected && 'border-fg',
            )}
          >
            <span className="block h-4 w-4 rounded-full" style={{ backgroundColor: lineColor(c) }} />
          </button>
        )
      })}
    </div>
  )
}
