// The inline (linkToken) view of an object: its icon and title, and a type chip when the view
// spans several types.
import type { Row, TypeDef } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { chipStyle } from '@/theme/palette'
import { displayTitle } from '../filter'

export function InlineToken({
  row,
  type,
  showType,
  className,
}: {
  row: Row
  type?: TypeDef
  showType?: boolean
  className?: string
}) {
  const icon = row.summary.icon ?? type?.icon ?? null
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span className="inline-flex w-5 shrink-0 justify-center">
        <IconOrEmoji icon={icon} fallback="ph-file-text" size={16} />
      </span>
      <span className="truncate text-[15px] text-fg">{displayTitle(row)}</span>
      {showType && type && (
        <span
          data-testid="type-chip"
          className="shrink-0 rounded-md bg-[var(--chip-bg)] px-1.5 py-[1px] text-[12px] text-[var(--chip-fg)]"
          style={chipStyle(type.color)}
        >
          {type.name}
        </span>
      )}
    </span>
  )
}
