// The sidebar's section header: a small icon, the section's name, and an optional action at the
// right edge (the Object Types `...` and `+`, the Agents `+` menu). Shared by the sidebar's own
// sections (Object Types) and the Agents section so every section reads the same.
import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon'

export function SectionHeader({
  id,
  icon,
  children,
  action,
}: {
  id: string
  icon?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="group/sh flex items-center pr-1">
      <h2
        id={id}
        className="flex flex-1 items-center gap-1.5 px-2 pt-5 pb-2 text-[14px] font-semibold text-[var(--text-section)]"
      >
        {icon && <Icon name={icon} size={14} />}
        {children}
      </h2>
      {action && <div className="pt-3">{action}</div>}
    </div>
  )
}
