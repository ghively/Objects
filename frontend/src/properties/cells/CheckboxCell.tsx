import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import type { CellProps } from './types'

/** A boolean as a checkbox, with the property's description beside it. */
export function CheckboxCell({ def, value, readOnly, onChange }: CellProps<boolean | null>) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        aria-label={def.name}
        checked={!!value}
        disabled={readOnly}
        onCheckedChange={(c) => {
          if (!readOnly) onChange(c === true)
        }}
      />
      {def.description && (
        <label htmlFor={id} className="text-[15px] text-fg-muted">
          {def.description}
        </label>
      )}
    </div>
  )
}
