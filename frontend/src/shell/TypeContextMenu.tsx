// A type row's context menu in the sidebar, as in Object: Open ›, Create <Type>,
// New from Template ›, New Collection, Object Type Settings, Import, Delete object type.
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import { createAndOpen } from '@/create/createAndOpen'
import { COLLECTION_ICON } from '@/lib/defIcons'
import { PIN_MENU_TEXT } from './PinToMenu'
import { usePinned } from './usePinned'
import { useTabs, type Target } from '@/nav/tabs'
import { isDailyNoteType } from '@/object/ObjectHeader'
import { IMPORT_CSV_TEXT } from '@/types/ImportCsvDialog'
import { isWhiteboardType } from '@/whiteboard/isWhiteboard'

export const TYPE_MENU_TEXT = {
  open: 'Open',
  openInNewTab: 'Open in new tab',
  openInSidePanel: 'Open in side panel',
  create: (name: string) => `Create ${name}`,
  fromTemplate: 'New from Template',
  noTemplates: 'No templates',
  newCollection: 'New Collection',
  settings: 'Object Type Settings',
  deleteType: 'Delete object type',
}

/** Daily notes and whiteboards are made by their own flows, not from the type's menu. */
export function canCreateFromMenu(type: TypeDef): boolean {
  return !type.readOnlyReason && !isDailyNoteType(type) && !isWhiteboardType(type)
}

/** The type's templates, fetched when the submenu opens (its content mounts then). */
function TemplateItems({ type }: { type: TypeDef }) {
  const [templates, setTemplates] = useState<ObjectSummary[] | null>(null)
  useEffect(() => {
    let live = true
    api
      .templates(type.id)
      .then((t) => live && setTemplates(t))
      .catch(() => live && setTemplates([]))
    return () => {
      live = false
    }
  }, [type.id])
  if (templates === null) return <ContextMenuItem disabled>…</ContextMenuItem>
  if (templates.length === 0) return <ContextMenuItem disabled>{TYPE_MENU_TEXT.noTemplates}</ContextMenuItem>
  return (
    <>
      {templates.map((t) => (
        <ContextMenuItem
          key={t.path}
          onSelect={() => void createAndOpen(type.id, { templateId: t.id ?? undefined }).catch((e: unknown) => console.warn('Could not create from the template:', e))}
        >
          <Icon name="ph-file-dashed" size={14} />
          {t.title}
        </ContextMenuItem>
      ))}
    </>
  )
}

export interface TypeContextMenuProps {
  type: TypeDef
  onOpenTarget?: (target: Target, opts: { newTab?: boolean }) => void
  onOpenTypeSettings?: (type: TypeDef) => void
  onDeleteType?: (type: TypeDef) => void
  onNewCollection?: (type: TypeDef) => void
  onImport?: (type: TypeDef) => void
}

/** "Pin to Sidebar" / "Unpin from space" for the type itself (the live menu has it after New Collection). */
export function PinTypeItem({ type }: { type: TypeDef }) {
  const { isPinned, pin, unpin } = usePinned()
  const ref = { kind: 'type' as const, id: type.id }
  const pinned = isPinned(ref)
  return (
    <ContextMenuItem onSelect={() => void (pinned ? unpin(ref) : pin(ref))}>
      <Icon name={pinned ? 'ph-push-pin-slash' : 'ph-push-pin'} size={14} />
      {pinned ? PIN_MENU_TEXT.unpinFromSpace : PIN_MENU_TEXT.pinToSidebar}
    </ContextMenuItem>
  )
}

export function TypeContextMenu({ type, onOpenTarget, onOpenTypeSettings, onDeleteType, onNewCollection, onImport }: TypeContextMenuProps) {
  const creatable = canCreateFromMenu(type)
  return (
    <ContextMenuContent className="w-64 border-line bg-raised text-fg">
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Icon name="ph-arrow-square-out" size={14} />
          {TYPE_MENU_TEXT.open}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="border-line bg-raised">
          <ContextMenuItem onSelect={() => onOpenTarget?.({ kind: 'type', typeId: type.id }, { newTab: true })}>
            <Icon name="ph-arrow-square-out" size={14} />
            {TYPE_MENU_TEXT.openInNewTab}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => useTabs.getState().openInSidepanel({ kind: 'type', typeId: type.id })}>
            <Icon name="ph-square-split-horizontal" size={14} />
            {TYPE_MENU_TEXT.openInSidePanel}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {creatable && (
        <>
          <ContextMenuItem onSelect={() => void createAndOpen(type.id).catch((e: unknown) => console.warn('Could not create the object:', e))}>
            <Icon name="ph-plus" size={14} />
            {TYPE_MENU_TEXT.create(type.name)}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icon name="ph-file-dashed" size={14} />
              {TYPE_MENU_TEXT.fromTemplate}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-72 overflow-auto border-line bg-raised">
              <TemplateItems type={type} />
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}
      <ContextMenuItem onSelect={() => onNewCollection?.(type)}>
        <Icon name={COLLECTION_ICON} size={14} />
        {TYPE_MENU_TEXT.newCollection}
      </ContextMenuItem>
      <PinTypeItem type={type} />
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onOpenTypeSettings?.(type)}>
        <Icon name="ph-gear" size={14} />
        {TYPE_MENU_TEXT.settings}
      </ContextMenuItem>
      {creatable && (
        <ContextMenuItem onSelect={() => onImport?.(type)}>
          <Icon name="ph-file-csv" size={14} />
          {IMPORT_CSV_TEXT.menu}
        </ContextMenuItem>
      )}
      {!type.basic && (
        <ContextMenuItem variant="destructive" onSelect={() => onDeleteType?.(type)}>
          <Icon name="ph-trash" size={14} />
          {TYPE_MENU_TEXT.deleteType}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  )
}
