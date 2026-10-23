import type { ObjectSummary, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { chipStyle } from '@/shell/typeColor'

/** An object's icon: a Phosphor name (`ph-…`) renders as an icon; anything else (emoji) as text. */
export function ObjectIcon({ icon, size }: { icon: string | null; size: number }) {
  if (!icon) return null
  if (/^ph[-:]/.test(icon)) return <Icon name={icon} size={size} />
  return (
    <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
      {icon}
    </span>
  )
}

export interface ObjectHeaderProps {
  summary: ObjectSummary
  type?: TypeDef
}

/** Type chip, icon + title (36px bold), and muted tags. */
export function ObjectHeader({ summary, type }: ObjectHeaderProps) {
  const color = type?.color ?? 'gray'
  return (
    <header className="mb-6">
      <div className="flex items-center gap-2">
        <span
          data-type-chip=""
          data-color={color}
          style={chipStyle(color)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--chip-bg)] px-2 text-[15px] font-medium text-[var(--chip-fg)]"
        >
          <Icon name={type?.icon ?? 'ph-file-text'} size={15} />
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
