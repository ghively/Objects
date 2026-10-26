import { IconOrEmoji } from '@/components/Icon'
import { typeOf, useLinkIndex } from '@/links/linkIndex'
import { chipStyle } from '@/theme/palette'
import type { CellProps } from './types'

export interface TypeChipCellProps extends CellProps<string | null> {
  /** Opens "Change type" (Task 19); without it the chip is inert. */
  onChangeType?(): void
}

/** The object's type as a chip (`value` is the type id). Read-only; a click opens "Change type". */
export function TypeChipCell({ value, readOnly, onChangeType }: TypeChipCellProps) {
  // Re-render when the types load or change.
  useLinkIndex((s) => s.types)
  const type = typeOf(value)
  const chip = (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-[var(--chip-bg)] px-1.5 py-[1px] text-[13px] text-[var(--chip-fg)]"
      style={chipStyle(type?.color)}
    >
      <IconOrEmoji icon={type?.icon ?? null} size={12} fallback="ph-cube" />
      {type?.name ?? value ?? '—'}
    </span>
  )
  if (readOnly || !onChangeType) return <div className="py-0.5">{chip}</div>
  return (
    <button type="button" title="Change type" onClick={onChangeType} className="py-0.5 text-left">
      {chip}
    </button>
  )
}
