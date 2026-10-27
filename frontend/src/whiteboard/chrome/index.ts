/**
 * STUB (Task 9): replaced in full by Task 12. The export names and prop types are final
 * (`canvasTypes.ts`): `Toolbox`, `SelectionToolbar`, `ZoomMenu`, `BoardMenu`, `ObjectPicker`.
 */
import { createElement } from 'react'
import type {
  BoardMenuProps,
  ObjectPickerProps,
  SelectionToolbarProps,
  ToolboxProps,
  ZoomMenuProps,
} from '../canvasTypes'

export function Toolbox({ inkSlot }: ToolboxProps) {
  return createElement('div', { 'data-whiteboard-toolbox': '' }, inkSlot)
}

export function SelectionToolbar(_props: SelectionToolbarProps) {
  return createElement('div', { 'data-whiteboard-selection-toolbar': '' })
}

export function ZoomMenu({ zoom }: ZoomMenuProps) {
  return createElement('div', { 'data-whiteboard-zoom': '' }, `${Math.round(zoom * 100)}%`)
}

export function BoardMenu(_props: BoardMenuProps) {
  return createElement('div', { 'data-whiteboard-board-menu': '' })
}

export function ObjectPicker({ onClose }: ObjectPickerProps) {
  return createElement('div', { 'data-whiteboard-object-picker': '', onKeyDown: (e: { key: string }) => e.key === 'Escape' && onClose() })
}
