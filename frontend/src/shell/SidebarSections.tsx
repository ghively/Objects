// Custom sidebar sections (such as "In Progress"): rendered above Pinned, each with its icon and
// name as heading, the same items as Pinned, "Edit Section" / "Delete Section" on the heading and
// an "Add Section" control.
import { useEffect, useState } from 'react'
import type { Icon as IconValue, SidebarSection } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PinList, type OpenTarget } from './PinnedSection'
import { PINNED_TEXT } from './pinText'
import { usePinned } from './usePinned'

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
            className="flex items-center gap-1.5 px-2 pt-5 pb-2 text-[14px] font-semibold text-[#a7a2a1]"
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
