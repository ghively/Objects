import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Icon as IconValue, PropertyDef, TypeDef, Visibility } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { kindIcon } from './kinds'
import { NumberFormatMenu } from './NumberFormatMenu'
import { setNumberFormat, updateProperty } from './typeEdits'

export const VISIBILITY_OPTIONS: readonly { value: Visibility; name: string; icon: string }[] = [
  { value: 'alwaysShow', name: 'Always Show', icon: 'ph-eye' },
  { value: 'hideWhenEmpty', name: 'Hide When Empty', icon: 'ph-eye-closed' },
  { value: 'hidden', name: 'Hidden', icon: 'ph-eye-slash' },
]

/** The title is always shown and can't be deleted; a basic type's properties can't be deleted. */
export function canChangeVisibility(def: PropertyDef): boolean {
  return def.type !== 'entity_title'
}
export function canDeleteProperty(type: TypeDef, def: PropertyDef): boolean {
  return !type.basic && def.type !== 'entity_title'
}

export interface PropertyMenuProps {
  type: TypeDef
  def: PropertyDef
  /** Save the edited type. */
  onSave(next: TypeDef): Promise<unknown> | void
  /** "Edit Property": open the property settings. */
  onEditProperty(): void
  /** "Delete": ask, then delete the property. */
  onDelete(): void
}

function MenuButton({
  icon,
  onClick,
  children,
  danger,
  selected,
  trailing,
}: {
  icon: string
  onClick(): void
  children: ReactNode
  danger?: boolean
  selected?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[14px] hover:bg-hover',
        danger && 'text-red-400',
      )}
    >
      <Icon name={icon} size={14} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Icon name="ph-check" size={13} />}
      {trailing}
    </button>
  )
}

/** A property row's menu: icon and name, Format (numbers), Visibility, Edit Property, Delete. */
export function PropertyMenu({ type, def, onSave, onEditProperty, onDelete }: PropertyMenuProps) {
  const [name, setName] = useState(def.name)
  // The last name committed here (Enter or blur): Escape goes back to it, never past it, even
  // while the type's save is still on its way.
  const committed = useRef(def.name)
  const [iconOpen, setIconOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  useEffect(() => {
    committed.current = def.name
    setName(def.name)
  }, [def.name])

  const save = (patch: Partial<PropertyDef> | ((d: PropertyDef) => PropertyDef)) =>
    void onSave(updateProperty(type, def.id, patch))

  const commitName = () => {
    const next = name.trim()
    if (!next) return setName(committed.current)
    committed.current = next
    if (next !== def.name) save({ name: next })
  }

  const setIcon = (icon: IconValue | null) => {
    setIconOpen(false)
    save({ icon })
  }

  return (
    <div className="w-64 text-fg" data-property-menu={def.id}>
      <div className="flex items-center gap-1.5 border-b border-line pb-1.5">
        <Popover open={iconOpen} onOpenChange={setIconOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Property icon" className="rounded p-1 hover:bg-hover">
              <IconOrEmoji icon={def.icon ?? kindIcon(def.type)} size={15} fallback="ph-note-blank" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
            <IconPicker value={def.icon} onChange={setIcon} />
          </PopoverContent>
        </Popover>
        <input
          aria-label="Property name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setName(committed.current)
          }}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[14px] font-medium outline-none focus:bg-hover"
        />
      </div>
      <div className="pt-1">
        {def.type === 'number' && (
          <>
            <MenuButton
              icon="ph-math-operations"
              onClick={() => setFormatOpen((v) => !v)}
              trailing={<Icon name={formatOpen ? 'ph-caret-down' : 'ph-caret-right'} size={12} />}
            >
              Format
            </MenuButton>
            {formatOpen && (
              <div className="py-1 pl-2">
                <NumberFormatMenu
                  value={def.options.numberFormat}
                  onChange={(choice) => save((d) => setNumberFormat(d, choice))}
                />
              </div>
            )}
          </>
        )}
        {canChangeVisibility(def) && (
          <div role="group" aria-label="Visibility">
            <div className="flex items-center gap-2 px-2 pt-1.5 pb-0.5 text-[12px] font-semibold text-fg-muted">
              Visibility
            </div>
            {VISIBILITY_OPTIONS.map((o) => (
              <MenuButton
                key={o.value}
                icon={o.icon}
                selected={def.visibility === o.value}
                onClick={() => def.visibility !== o.value && save({ visibility: o.value })}
              >
                {o.name}
              </MenuButton>
            ))}
            <hr className="my-1 border-line" />
          </div>
        )}
        <MenuButton icon="ph-pencil-simple" onClick={onEditProperty}>
          Edit Property
        </MenuButton>
        {canDeleteProperty(type, def) && (
          <MenuButton icon="ph-trash" danger onClick={onDelete}>
            Delete
          </MenuButton>
        )}
      </div>
    </div>
  )
}
