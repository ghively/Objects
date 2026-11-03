// Pin menu items for a `…` menu: "Pin to Sidebar" / "Unpin from space", and the "Pin to..."
// submenu listing "Pinned" and every custom section, each checked when the item is in it.
import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import type { PinRef } from '@/api/types'
import { PINNED_TEXT } from './pinText'
import { usePinned, type PinTarget } from './usePinned'

export const PIN_MENU_TEXT = {
  pinToSidebar: 'Pin to Sidebar',
  unpinFromSpace: PINNED_TEXT.unpinFromSpace,
  pinTo: 'Pin to...',
}

const refOf = (t: PinTarget): PinRef | null => {
  if ('path' in t) return t.id ? { kind: 'object', id: t.id } : null
  return t
}

/** "Pin to..." (`ObjectMenu.pinToWorkspaceSection`): picking toggles membership of that section. */
export function PinToMenu({ pin }: { pin: PinTarget }) {
  const { sections, isPinned, pin: doPin, unpin } = usePinned()
  const ref = refOf(pin)
  const toggle = (sectionId: string | null, on: boolean) => {
    if (on) void doPin(pin, sectionId)
    else if (ref) void unpin(ref, sectionId)
  }
  const has = (sectionId: string | null) => !!ref && isPinned(ref, sectionId)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name="ph-push-pin" size={14} />
        {PIN_MENU_TEXT.pinTo}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[360px] overflow-auto border-line bg-raised">
        <DropdownMenuCheckboxItem
          checked={has(null)}
          onSelect={(e) => e.preventDefault()}
          onCheckedChange={(on) => toggle(null, on)}
        >
          {PINNED_TEXT.heading}
        </DropdownMenuCheckboxItem>
        {sections.map((s) => (
          <DropdownMenuCheckboxItem
            key={s.id}
            checked={has(s.id)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => toggle(s.id, on)}
          >
            {s.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** "Pin to Sidebar" / "Unpin from space" (with an optional key hint) followed by "Pin to...". */
export function PinMenuItems({ pin, shortcut }: { pin: PinTarget; shortcut?: ReactNode }) {
  const { isPinned, pin: doPin, unpin } = usePinned()
  const ref = refOf(pin)
  const pinned = !!ref && isPinned(ref)
  return (
    <>
      <DropdownMenuItem onSelect={() => (pinned && ref ? void unpin(ref) : void doPin(pin))}>
        <Icon name={pinned ? 'ph-push-pin-slash' : 'ph-push-pin'} size={14} />
        {pinned ? PIN_MENU_TEXT.unpinFromSpace : PIN_MENU_TEXT.pinToSidebar}
        {shortcut}
      </DropdownMenuItem>
      <PinToMenu pin={pin} />
    </>
  )
}
