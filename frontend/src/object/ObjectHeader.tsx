import type { ObjectSummary, TypeDef } from '@/api/types'
import type { Icon as IconValue } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { chipStyle } from '@/theme/palette'

/** An object's icon: an Iconify id (`ph-…`, `vscode-icons-…`) renders as an icon; anything else (emoji) as text. */
export function ObjectIcon({ icon, size }: { icon: IconValue | string | null; size: number }) {
  return <IconOrEmoji icon={icon} size={size} />
}

export interface ObjectHeaderProps {
  summary: ObjectSummary
  type?: TypeDef
}

/** Type chip, icon + title (36px bold), and muted tags. */
export function ObjectHeader({ summary, type }: ObjectHeaderProps) {
  const color = type?.color ?? 'gray'
  return (
    <header className="mb-9">
      <div className="flex items-center gap-2">
        <span
          data-type-chip=""
          data-color={color}
          style={chipStyle(color)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--chip-bg)_85%,white)] bg-[var(--chip-bg)] px-2 text-[15px] font-medium text-[var(--chip-fg)]"
        >
          <IconOrEmoji icon={type?.icon ?? null} fallback="ph-file-text" size={15} />
          {type?.name ?? summary.type}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <ObjectIcon icon={summary.icon} size={36} />
        <h1 className="text-[36px] leading-tight font-bold break-words">{summary.title}</h1>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[15px] text-fg-muted">
        {summary.tags.length === 0 ? (
          <span>Tags</span>
        ) : (
          summary.tags.map((t) => (
            <span key={t} className="rounded-md bg-hover px-1.5 py-0.5 text-[13px]">
              #{t}
            </span>
          ))
        )}
      </div>
    </header>
  )
}
