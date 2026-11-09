// One row of the sidebar's main navigation (Calendar, Tasks, Graph, Assistant); Ctrl+click opens
// a new tab. Shared by the Sidebar's own rows and the Assistant entry (which lives in the agents
// module but is not an agent section row: it is a built-in, always-on part of the program).
import type { MouseEvent } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'

export function MainNavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[38px] w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-medium text-fg hover:bg-hover',
        active && 'bg-hover',
      )}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  )
}
