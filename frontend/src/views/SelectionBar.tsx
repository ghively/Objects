// The bar a data view shows while rows are selected ("Select multiple"): the count and the bulk
// actions (change type, open in side panel, delete), plus the
// bulk delete's confirmation. Change type runs the one-object dialog once per row (in the view).
import { useState } from 'react'
import type { Row, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TypeChip } from '@/shell/Sidebar'

export const SELECTION_TEXT = {
  /** After the count. */
  selected: 'selected',
  changeType: 'Change type of selected objects',
  openInSidepanel: 'Open selected objects in side panel',
  delete: 'Delete objects',
  deleteHeading: 'Delete?',
  deleteDescription: 'Review the items below, then confirm.',
  /** Our string. */
  clear: 'Clear selection',
}

/** "Delete {count} object | Delete {count} objects". */
export function deleteCountLabel(count: number): string {
  return count === 1 ? 'Delete 1 object' : `Delete ${count} objects`
}

export interface SelectionBarProps {
  /** The selected rows, in view order. */
  rows: Row[]
  types: TypeDef[]
  onChangeType(to: TypeDef): void
  onOpenInSidepanel(): void
  /** Delete every selected row; reject to show the error. */
  onDelete(): Promise<void>
  onClear(): void
}

export function SelectionBar({ rows, types, onChangeType, onOpenInSidepanel, onDelete, onClear }: SelectionBarProps) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable = rows.filter((r) => !r.summary.readOnly && r.summary.template == null)
  const targets = [...types].sort((a, b) => a.pluralName.localeCompare(b.pluralName))

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onDelete()
      setConfirming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const button = 'flex size-8 items-center justify-center rounded-md text-fg hover:bg-hover disabled:opacity-50'
  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label={`${rows.length} ${SELECTION_TEXT.selected}`}
      className="flex h-10 items-center gap-1 rounded-lg border border-line bg-raised px-2 text-[14px]"
    >
      <span className="px-1 font-medium">{`${rows.length} ${SELECTION_TEXT.selected}`}</span>
      <span className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={SELECTION_TEXT.changeType} title={SELECTION_TEXT.changeType} disabled={editable.length === 0} className={button}>
            <Icon name="ph-swap" size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[360px] overflow-auto border-line bg-raised">
          {targets.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => onChangeType(t)}>
              <TypeChip type={t} size={18} />
              {t.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" aria-label={SELECTION_TEXT.openInSidepanel} title={SELECTION_TEXT.openInSidepanel} onClick={onOpenInSidepanel} className={button}>
        <Icon name="ph-square-split-horizontal" size={16} />
      </button>
      <button
        type="button"
        aria-label={SELECTION_TEXT.delete}
        title={SELECTION_TEXT.delete}
        disabled={rows.every((r) => r.summary.readOnly)}
        onClick={() => setConfirming(true)}
        className={`${button} text-red-400`}
      >
        <Icon name="ph-trash" size={16} />
      </button>
      <button type="button" aria-label={SELECTION_TEXT.clear} title={SELECTION_TEXT.clear} onClick={onClear} className={button}>
        <Icon name="ph-x" size={14} />
      </button>
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o) setError(null)
          setConfirming(o)
        }}
      >
        <AlertDialogContent className="border-line bg-raised-2 text-fg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px]">{SELECTION_TEXT.deleteHeading}</AlertDialogTitle>
            <AlertDialogDescription className="text-[14px] text-fg-muted">{SELECTION_TEXT.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          {/* "The items below": the selected objects, which go to the Trash. */}
          <ul aria-label="Items" className="max-h-48 overflow-y-auto rounded-md border border-line px-3 py-1.5 text-[14px]">
            {rows.map((r) => (
              <li key={r.summary.path} className="truncate py-0.5">
                {r.summary.title || 'Untitled'}
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-[13px] text-red-400">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
              {deleteCountLabel(rows.filter((r) => !r.summary.readOnly).length)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
