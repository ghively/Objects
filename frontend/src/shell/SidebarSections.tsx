// Custom sidebar sections (such as "In Progress"): rendered above Pinned, each with its icon and
// name as heading, the same items as Pinned, "Edit Section" / "Delete Section" on the heading and
// an "Add Section" control. M9: the top-level blocks (these sections, Pinned, the object types)
// follow `ui.workspaceOrder` and are reordered by dragging.
import { useEffect, useState, type ReactNode } from 'react'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { api, ConflictError } from '@/api/client'
import type { Icon as IconValue, SidebarSection } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { PinList, PinnedSection, type OpenTarget } from './PinnedSection'
import { PINNED_TEXT } from './pinText'
import { enqueueUiSave, pendingUiSaves, usePinned, useUiStore } from './usePinned'

export const SECTION_TEXT = {
  add: 'Add Section',
  addHint: 'Group pages and collections under a named heading in your space overview.',
  edit: 'Edit Section',
  delete: 'Delete Section',
  name: 'Section Name',
  save: 'Save',
  cancel: 'Cancel',
}

function SectionDialog({
  open,
  onOpenChange,
  section,
  onSubmit,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  /** The section being edited; none when adding. */
  section?: SidebarSection
  onSubmit(name: string, icon: IconValue | null): void
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<IconValue | null>(null)
  useEffect(() => {
    if (open) {
      setName(section?.name ?? '')
      setIcon(section?.icon ?? null)
    }
  }, [open, section])
  const title = section ? SECTION_TEXT.edit : SECTION_TEXT.add
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{title}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{SECTION_TEXT.addHint}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            onSubmit(name.trim(), icon)
            onOpenChange(false)
          }}
          className="flex flex-col gap-3"
        >
          <input
            autoFocus
            aria-label={SECTION_TEXT.name}
            placeholder={SECTION_TEXT.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 rounded-md border border-line bg-transparent px-2 text-[15px] outline-none focus:border-fg-muted"
          />
          {section && <IconPicker value={icon} onChange={setIcon} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {SECTION_TEXT.cancel}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {SECTION_TEXT.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Section({ section, onOpenTarget }: { section: SidebarSection; onOpenTarget?: OpenTarget }) {
  const { updateSection, deleteSection } = usePinned()
  const [editing, setEditing] = useState(false)
  const headingId = `sb-section-${section.id}`
  return (
    <section aria-labelledby={headingId} data-sidebar-section={section.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <h2
            id={headingId}
            className="flex items-center gap-1.5 px-2 pt-5 pb-2 text-[14px] font-semibold text-[var(--text-section)]"
          >
            <IconOrEmoji icon={section.icon} fallback="ph-star" size={14} />
            {section.name}
          </h2>
        </ContextMenuTrigger>
        <ContextMenuContent className="border-line bg-raised text-fg">
          <ContextMenuItem onSelect={() => setEditing(true)}>
            <Icon name="ph-pencil-simple" size={14} />
            {SECTION_TEXT.edit}
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => void deleteSection(section.id)}>
            <Icon name="ph-trash" size={14} />
            {SECTION_TEXT.delete}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PinList
        items={section.items}
        sectionId={section.id}
        unpinLabel={PINNED_TEXT.unpinFrom(section.name)}
        onOpenTarget={onOpenTarget}
      />
      <SectionDialog
        open={editing}
        onOpenChange={setEditing}
        section={section}
        onSubmit={(name, icon) => void updateSection(section.id, { name, icon })}
      />
    </section>
  )
}

/** The custom sections in their saved order (rendered above Pinned). */
export function SidebarSections({ onOpenTarget }: { onOpenTarget?: OpenTarget }) {
  const { sections } = usePinned()
  return (
    <>
      {sections.map((s) => (
        <Section key={s.id} section={s} onOpenTarget={onOpenTarget} />
      ))}
    </>
  )
}

// ---- workspaceOrder (M9) ----

/** `RootSpace.workspaceOrder`'s ids of the two fixed blocks; the others are custom section ids. */
export const WORKSPACE_OBJECTS = 'objects'
export const WORKSPACE_PINNED = 'pinned'

/** Our string: the drag handle's name (Object drags the heading itself). */
export const REORDER_HANDLE = (name: string) => `Reorder ${name}`

/**
 * The sidebar's top-level blocks in order: the ids `workspaceOrder` lists (unknown ids ignored),
 * with the missing ones in their default place: a custom section just above Pinned (so one added
 * after the order was saved shows where "Add Section" puts it), Pinned and the object types last.
 */
export function workspaceBlocks(order: unknown, sectionIds: string[]): string[] {
  const known = [...sectionIds, WORKSPACE_PINNED, WORKSPACE_OBJECTS]
  const listed = Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string' && known.includes(id)) : []
  const out = [...new Set(listed)]
  if (!out.includes(WORKSPACE_PINNED)) out.push(WORKSPACE_PINNED)
  for (const id of sectionIds) if (!out.includes(id)) out.splice(out.indexOf(WORKSPACE_PINNED), 0, id)
  if (!out.includes(WORKSPACE_OBJECTS)) out.push(WORKSPACE_OBJECTS)
  return out
}

/** Save `workspaceOrder` (optimistic, after the `ui.json` saves before it; a 409 re-applies it once to the fresh state). */
export function saveWorkspaceOrder(order: string[]): Promise<void> {
  const cur = useUiStore.getState().ui
  useUiStore.setState({ ui: { ...cur, workspaceOrder: order } })
  return enqueueUiSave(async () => {
    try {
      const base = useUiStore.getState()
      try {
        const res = await api.patchUi({ workspaceOrder: order }, { baseRevision: base.revision })
        useUiStore.setState({ revision: res?.revision ?? useUiStore.getState().revision })
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e
        const fresh = await api.ui()
        const res = await api.patchUi({ workspaceOrder: order }, { baseRevision: fresh?.revision ?? '' })
        // Another writer's unsaved edits are in the local ui, not in `fresh`: keep them.
        const rest = pendingUiSaves() === 1 && fresh?.ui ? fresh.ui : useUiStore.getState().ui
        useUiStore.setState({ ui: { ...rest, workspaceOrder: order }, revision: res?.revision ?? fresh?.revision ?? '' })
      }
    } catch (e) {
      console.warn('Could not save the sidebar order:', e)
    }
  })
}

/** One block with a drag handle that shows on hover, at its heading's left. */
function SortableBlock({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const s = useSortable({ id })
  return (
    <div
      ref={s.setNodeRef}
      data-workspace-block={id}
      style={{ transform: s.transform ? `translate3d(0, ${Math.round(s.transform.y)}px, 0)` : undefined, transition: s.transition }}
      className={cn('group/wb relative', s.isDragging && 'z-10 opacity-80')}
    >
      <button
        type="button"
        {...s.attributes}
        {...s.listeners}
        aria-label={REORDER_HANDLE(label)}
        title={REORDER_HANDLE(label)}
        className="absolute top-5 -left-2.5 flex h-5 w-3 cursor-grab items-center justify-center rounded text-fg-muted opacity-0 group-hover/wb:opacity-100 focus-visible:opacity-100"
      >
        <Icon name="ph-dots-six-vertical" size={12} />
      </button>
      {children}
    </div>
  )
}

/**
 * The sidebar's top-level blocks (custom sections, Pinned with "Add Section", the object types)
 * in `ui.workspaceOrder`, each draggable by its handle; a drop saves the new order.
 */
export function WorkspaceSections({ onOpenTarget, objects }: { onOpenTarget?: OpenTarget; objects: ReactNode }) {
  const { sections } = usePinned()
  const order = useUiStore((st) => st.ui.workspaceOrder)
  const blocks = workspaceBlocks(order, sections.map((x) => x.id))
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    const from = blocks.indexOf(String(e.active.id))
    const to = e.over ? blocks.indexOf(String(e.over.id)) : -1
    if (from < 0 || to < 0 || from === to) return
    void saveWorkspaceOrder(arrayMove(blocks, from, to))
  }
  const render = (id: string) => {
    if (id === WORKSPACE_OBJECTS) return objects
    if (id === WORKSPACE_PINNED) {
      return (
        <>
          <PinnedSection onOpenTarget={onOpenTarget} />
          <AddSection />
        </>
      )
    }
    const section = sections.find((x) => x.id === id)
    return section ? <Section section={section} onOpenTarget={onOpenTarget} /> : null
  }
  const label = (id: string) =>
    id === WORKSPACE_OBJECTS ? 'Object Types' : id === WORKSPACE_PINNED ? PINNED_TEXT.heading : (sections.find((x) => x.id === id)?.name ?? id)
  return (
    <DndContext id="workspace-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={blocks} strategy={verticalListSortingStrategy}>
        {blocks.map((id) => (
          <SortableBlock key={id} id={id} label={label(id)}>
            {render(id)}
          </SortableBlock>
        ))}
      </SortableContext>
    </DndContext>
  )
}

/** "Add Section": a name, then the empty section appears above Pinned. */
export function AddSection() {
  const { addSection } = usePinned()
  const [open, setOpen] = useState(false)
  return (
    <div className="pb-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[32px] w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] font-medium text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="ph-plus" size={14} />
        {SECTION_TEXT.add}
      </button>
      <SectionDialog open={open} onOpenChange={setOpen} onSubmit={(name) => void addSection(name)} />
    </div>
  )
}
