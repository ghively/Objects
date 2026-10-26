import type { ReactNode } from 'react'
import { Icon, IconOrEmoji, iconName } from '@/components/Icon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { TypeDef } from '@/api/types'
import { cn } from '@/lib/utils'
import { chipStyle } from './typeColor'

export interface SidebarProps {
  types: TypeDef[]
  activeTypeId?: string | null
  onOpenType?: (type: TypeDef) => void
  /** Optional object counts per type id, shown muted at the row's end. */
  counts?: Record<string, number>
  /** "+ New": create an object. */
  onNew?: () => void
  /** The `+` beside "Object Types": create a type. */
  onCreateType?: () => void
  /** A type row's context menu › "Object Type Settings". */
  onOpenTypeSettings?: (type: TypeDef) => void
  /** A type row's context menu › "Delete object type" (non-basic types only). */
  onDeleteType?: (type: TypeDef) => void
  /** "Trash": the app's own trash. */
  onOpenTrash?: () => void
  /** Highlights the Trash item. */
  trashActive?: boolean
}

export function byPluralName(a: TypeDef, b: TypeDef): number {
  return a.pluralName.localeCompare(b.pluralName, undefined, { sensitivity: 'base' })
}

export function TypeChip({ type, size = 22 }: { type: Pick<TypeDef, 'icon' | 'color'>; size?: number }) {
  return (
    <span
      data-type-chip=""
      data-color={type.color}
      data-icon={iconName(type.icon, 'ph-cube')}
      style={{ ...chipStyle(type.color), width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--chip-bg)_85%,white)] bg-[var(--chip-bg)] text-[var(--chip-fg)]"
    >
      <IconOrEmoji icon={type.icon} fallback="ph-cube" size={Math.round(size * 0.68)} />
    </span>
  )
}

function SectionHeader({
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
        className="flex flex-1 items-center gap-1.5 px-2 pt-5 pb-2 text-[14px] font-semibold text-[#a7a2a1]"
      >
        {icon && <Icon name={icon} size={14} />}
        {children}
      </h2>
      {action && <div className="pt-3">{action}</div>}
    </div>
  )
}

function NavItem({ icon, label, hint }: { icon: string; label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span wrapper so the tooltip still works over a disabled button */}
        <span className="block">
          <button
            type="button"
            disabled
            aria-label={label}
            className="flex h-[38px] w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-medium text-fg disabled:cursor-default disabled:opacity-50"
          >
            <Icon name={icon} size={16} />
            <span>{label}</span>
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{hint}</TooltipContent>
    </Tooltip>
  )
}

export function Sidebar({
  types,
  activeTypeId,
  onOpenType,
  counts,
  onNew,
  onCreateType,
  onOpenTypeSettings,
  onDeleteType,
  onOpenTrash,
  trashActive,
}: SidebarProps) {
  const sorted = [...types].sort(byPluralName)
  return (
    <aside className="flex h-full w-[358px] shrink-0 flex-col bg-app pr-3.5 pl-2.5 text-fg" aria-label="Sidebar">
      <div className="flex items-center gap-2 pt-3 pb-3">
        <button
          type="button"
          onClick={() => onNew?.()}
          className="flex h-[42px] flex-1 items-center gap-2 rounded-xl border border-[#2a292d] bg-raised px-3 text-[15px] font-medium hover:bg-hover"
        >
          <Icon name="ph-plus" size={16} />
          New
        </button>
        <button
          type="button"
          aria-label="Search"
          title="Search (M5)"
          className="flex size-[42px] items-center justify-center rounded-xl border border-[#2a292d] bg-raised hover:bg-hover"
        >
          <Icon name="ph-magnifying-glass" size={18} />
        </button>
      </div>

      <TooltipProvider>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <NavItem icon="ph-calendar-blank" label="Calendar" hint="Calendar arrives in M4" />
        <NavItem icon="ph-check-circle" label="Tasks" hint="Tasks arrive in M4" />
        <NavItem icon="ph-graph" label="Graph" hint="Graph arrives in M5" />
      </nav>
      </TooltipProvider>

      <ScrollArea className="min-h-0 flex-1">
        <section aria-labelledby="sb-pinned">
          <SectionHeader id="sb-pinned">Pinned</SectionHeader>
          <p className="px-2 text-[14px] text-fg-muted italic">No pinned content</p>
        </section>

        <section aria-labelledby="sb-types">
          <SectionHeader
            id="sb-types"
            action={
              <button
                type="button"
                aria-label="Create object type"
                title="Create object type"
                onClick={() => onCreateType?.()}
                className="flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Icon name="ph-plus" size={14} />
              </button>
            }
          >
            Object Types
          </SectionHeader>
          <ul className="flex flex-col gap-0.5 pb-2">
            {sorted.map((t) => (
              <li key={t.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onOpenType?.(t)}
                      aria-current={activeTypeId === t.id ? 'page' : undefined}
                      className={cn(
                        'flex h-[36px] w-full items-center gap-2 rounded-lg px-1.5 text-left text-[15px] font-medium hover:bg-hover',
                        activeTypeId === t.id && 'bg-hover',
                      )}
                    >
                      <TypeChip type={t} />
                      <span className="min-w-0 flex-1 truncate">{t.pluralName}</span>
                      {counts && counts[t.id] !== undefined && (
                        <span className="text-[13px] text-fg-muted tabular-nums">{counts[t.id]}</span>
                      )}
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="border-line bg-raised text-fg">
                    <ContextMenuItem onSelect={() => onOpenTypeSettings?.(t)}>
                      <Icon name="ph-gear" size={14} />
                      Object Type Settings
                    </ContextMenuItem>
                    {!t.basic && (
                      <ContextMenuItem variant="destructive" onSelect={() => onDeleteType?.(t)}>
                        <Icon name="ph-trash" size={14} />
                        Delete object type
                      </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              </li>
            ))}
          </ul>
        </section>

        <div className="pb-3">
          <button
            type="button"
            onClick={() => onOpenTrash?.()}
            aria-current={trashActive ? 'page' : undefined}
            className={cn(
              'flex h-[36px] w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-medium text-fg-muted hover:bg-hover hover:text-fg',
              trashActive && 'bg-hover text-fg',
            )}
          >
            <Icon name="ph-trash" size={16} />
            Trash
          </button>
        </div>
      </ScrollArea>

      <footer className="flex items-center gap-1 py-2 text-fg-muted">
        <button type="button" disabled aria-label="Profile" className="flex size-8 items-center justify-center rounded-md disabled:opacity-60">
          <Icon name="ph-user" size={17} />
        </button>
        <button type="button" disabled aria-label="Settings" className="flex size-8 items-center justify-center rounded-md disabled:opacity-60">
          <Icon name="ph-gear" size={17} />
        </button>
        <button type="button" disabled aria-label="Theme" className="flex size-8 items-center justify-center rounded-md disabled:opacity-60">
          <Icon name="ph-sun" size={17} />
        </button>
        <button type="button" disabled aria-label="Share" className="ml-auto flex size-8 items-center justify-center rounded-md disabled:opacity-60">
          <Icon name="ph-share-fat" size={17} />
        </button>
      </footer>
    </aside>
  )
}
