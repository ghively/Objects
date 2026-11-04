// The right-click menu of a row in a data view (type page, its sections, a query, a collection):
// the data view's context menu. The actions that need a dialog
// (change type, delete) or the view's selection are handed in by the view (`RowMenuCtx`).
import { api } from '@/api/client'
import type { Row, TypeDef } from '@/api/types'
import { showToast } from '@/editor/media/upload'
import { wikilinkMarkdown } from '@/editor/extensions/wikilink'
import { usePeek, useTabs } from '@/nav/tabs'
import { isDailyNoteType } from '@/object/ObjectHeader'
import { isWhiteboardType } from '@/whiteboard/isWhiteboard'

export interface RowMenuItem {
  key: string
  label: string
  icon: string
  destructive?: boolean
  /** Shown as the type's chip instead of `icon` (the "Change type" targets). */
  chip?: TypeDef
  /** A submenu ("Change type" ▸ the types); `onSelect` is not called for such an item. */
  children?: RowMenuItem[]
  onSelect(): void
}

export const ROW_MENU_TEXT = {
  selectMultiple: 'Select multiple',
  openInSidepanel: 'Open in side panel',
  openInTab: 'Open in new tab',
  changeType: 'Change type',
  copyReference: 'Copy object reference',
  copied: 'Link to object copied',
  duplicate: 'Duplicate',
  delete: 'Delete Object',
}

/** What a row's menu needs from its view. */
export interface RowMenuCtx {
  /** Every type (the "Change type" targets and the row's own type). */
  types: TypeDef[]
  /** Start selecting, with `row` selected. */
  selectMultiple(row: Row): void
  /** Open the change-type dialog for `row` and `to`. */
  changeType(row: Row, to: TypeDef): void
  /** Open the delete dialog for `row`. */
  requestDelete(row: Row): void
}

/** Whether an object can be duplicated: not a daily note, template, whiteboard or read-only file (Task 8's rule). */
export function canDuplicate(row: Row, type: TypeDef | undefined): boolean {
  const s = row.summary
  return !s.readOnly && s.template == null && !isDailyNoteType(type, s.type) && !isWhiteboardType(type)
}

/** Duplicate the row's object, then show the copy in the peek (our choice: the view stays put). */
export async function duplicateRow(row: Row): Promise<void> {
  const res = await api.duplicateObject(row.summary.path)
  usePeek.getState().peek(res.path)
}

/** Copy `[[Title]]`, the object's wikilink (Object's object reference), and toast. */
export async function copyReference(row: Row): Promise<void> {
  await navigator.clipboard?.writeText(wikilinkMarkdown(row.summary.title, null))
  showToast(ROW_MENU_TEXT.copied)
}

const byPluralName = (a: TypeDef, b: TypeDef) => a.pluralName.localeCompare(b.pluralName)

/** The common items, in menu order. A view appends its own (a collection's) after these. */
export function commonRowMenu(row: Row, ctx: RowMenuCtx): RowMenuItem[] {
  const s = row.summary
  const type = ctx.types.find((t) => t.id === s.type)
  const editable = !s.readOnly
  const others = ctx.types.filter((t) => t.id !== s.type).sort(byPluralName)
  const warn = (what: string) => (e: unknown) => console.warn(`Could not ${what}:`, e)
  const items: RowMenuItem[] = [
    { key: 'selectMultiple', label: ROW_MENU_TEXT.selectMultiple, icon: 'ph-check-square', onSelect: () => ctx.selectMultiple(row) },
    {
      key: 'openInSidepanel',
      label: ROW_MENU_TEXT.openInSidepanel,
      icon: 'ph-square-split-horizontal',
      onSelect: () => useTabs.getState().openInSidepanel({ kind: 'object', path: s.path }),
    },
    {
      key: 'openInTab',
      label: ROW_MENU_TEXT.openInTab,
      icon: 'ph-arrow-square-out',
      onSelect: () => useTabs.getState().open({ kind: 'object', path: s.path }, { newTab: true }),
    },
  ]
  if (editable && s.template == null && others.length > 0) {
    items.push({
      key: 'changeType',
      label: ROW_MENU_TEXT.changeType,
      icon: 'ph-swap',
      onSelect: () => undefined,
      children: others.map((t) => ({ key: `type:${t.id}`, label: t.name, icon: 'ph-cube', chip: t, onSelect: () => ctx.changeType(row, t) })),
    })
  }
  items.push({
    key: 'copyReference',
    label: ROW_MENU_TEXT.copyReference,
    icon: 'ph-link',
    onSelect: () => void copyReference(row).catch(warn('copy the reference')),
  })
  if (canDuplicate(row, type)) {
    items.push({ key: 'duplicate', label: ROW_MENU_TEXT.duplicate, icon: 'ph-copy', onSelect: () => void duplicateRow(row).catch(warn('duplicate')) })
  }
  if (editable) {
    items.push({ key: 'delete', label: ROW_MENU_TEXT.delete, icon: 'ph-trash', destructive: true, onSelect: () => ctx.requestDelete(row) })
  }
  return items
}
