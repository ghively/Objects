/**
 * Quick-create on a connector drop (M8). Dropping a connector on
 * empty canvas opens this menu at the drop point: "Objects" ("Create Object", "Link Object" and
 * "Link {name}" for each type), "Shapes" (the shape picker's shapes), then "Nothing" (the
 * connector keeps a point end there) and "Remove" (the connector is dropped). Escape or a click
 * outside counts as "Remove" (our choice). The canvas places the choice and connects it.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { TypeDef } from '@/api/types'
import type { WhiteboardPickerShape } from '@/api/whiteboardTypes'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { useLinkIndex } from '@/links/linkIndex'
import { PICKER_SHAPES } from '../model'
import { WB, quickCreateLinkTyped } from '../strings'
import { MenuHeading, MenuRow, MenuSeparator, ShapeIcon, toolLabel } from './controls'

export type QuickCreatePick =
  | { kind: 'createObject' }
  | { kind: 'linkObject'; typeId?: string }
  | { kind: 'shape'; shape: WhiteboardPickerShape }
  | { kind: 'none' }
  | { kind: 'remove' }

export interface QuickCreateMenuProps {
  onPick(pick: QuickCreatePick): void
  /** Escape or a click outside (the canvas treats it as "Remove"). */
  onClose(): void
}

const byPluralName = (a: TypeDef, b: TypeDef) => a.pluralName.localeCompare(b.pluralName, undefined, { sensitivity: 'base' })

export function QuickCreateMenu({ onPick, onClose }: QuickCreateMenuProps) {
  const types = useLinkIndex((s) => s.types)
  const sorted = useMemo(() => [...types].sort(byPluralName), [types])
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={WB.quickCreateObjects.text}
      data-whiteboard-quick-create=""
      className="nodrag nopan flex max-h-[420px] w-60 flex-col overflow-y-auto rounded-xl border border-line bg-raised-2 p-1 text-fg shadow-xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <MenuHeading>{WB.quickCreateObjects.text}</MenuHeading>
      <MenuRow label={WB.quickCreateCreateObject.text} icon={<Icon name="ph-plus" size={14} />} onSelect={() => onPick({ kind: 'createObject' })} />
      <MenuRow label={WB.quickCreateLinkObject.text} icon={<Icon name="ph-link-simple" size={14} />} onSelect={() => onPick({ kind: 'linkObject' })} />
      {sorted.map((t) => (
        <MenuRow
          key={t.id}
          label={quickCreateLinkTyped(t.name)}
          icon={<IconOrEmoji icon={t.icon} fallback="ph-cube" size={14} />}
          onSelect={() => onPick({ kind: 'linkObject', typeId: t.id })}
        />
      ))}
      <MenuSeparator />
      <MenuHeading>{WB.quickCreateShapes.text}</MenuHeading>
      <div className="grid grid-cols-5 gap-0.5 px-1 pb-1">
        {PICKER_SHAPES.map((shape) => (
          <button
            key={shape}
            type="button"
            role="menuitem"
            aria-label={toolLabel(shape)}
            title={toolLabel(shape)}
            className="flex h-8 items-center justify-center rounded-md text-fg hover:bg-hover"
            onClick={() => onPick({ kind: 'shape', shape })}
          >
            <ShapeIcon tool={shape} size={18} />
          </button>
        ))}
      </div>
      <MenuSeparator />
      <MenuRow label={WB.quickCreateNone.text} icon={<Icon name="ph-circle" size={14} />} onSelect={() => onPick({ kind: 'none' })} />
      <MenuRow label={WB.quickCreateDiscard.text} icon={<Icon name="ph-trash" size={14} />} onSelect={() => onPick({ kind: 'remove' })} />
    </div>
  )
}
