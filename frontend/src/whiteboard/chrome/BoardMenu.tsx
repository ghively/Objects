/**
 * The board's "…" menu beside its title: "Open as page" (in the peek; our string, as the page's
 * own button), "Export as PNG" and, with a selection, "Export selection as PNG" (M8; our labels,
 * adapted from `entity.settings.export.errors.whiteboardClosed`), "Clear Whiteboard" (confirmed
 * by `ClearBoardDialog`) and "Delete" (the page wires it to `host.requestDelete`, which opens
 * M1's delete dialog). Export works on a locked or read-only board too.
 */
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import type { BoardMenuProps } from '../canvasTypes'
import { WB } from '../strings'
import { ClearBoardDialog } from './ClearBoardDialog'
import { MenuRow, MenuSeparator, PopoverMenu } from './controls'

/** Our string (the same text as the page's expand button). */
export const OPEN_AS_PAGE = 'Open as page'
/** Our label (Object: "Open the whiteboard to export it as a PNG."). */
export const EXPORT_AS_PNG = 'Export as PNG'
/** Our label. */
export const EXPORT_SELECTION_AS_PNG = 'Export selection as PNG'

export function BoardMenu({ onClear, onDelete, onOpenAsPage, onExportPng, onExportSelectionPng, disabled = false }: BoardMenuProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <PopoverMenu
        label={WB.toolMore.text}
        trigger={<Icon name="ph-dots-three" size={18} />}
        side="bottom"
        align="start"
        triggerClassName="bg-raised"
      >
        {(close) => (
          <div role="menu" aria-label={WB.toolMore.text} data-whiteboard-board-menu="" className="flex flex-col">
            {onOpenAsPage && (
              <MenuRow
                label={OPEN_AS_PAGE}
                icon={<Icon name="ph-arrows-out-simple" size={14} />}
                onSelect={() => {
                  close()
                  onOpenAsPage()
                }}
              />
            )}
            {onExportPng && (
              <MenuRow
                label={EXPORT_AS_PNG}
                icon={<Icon name="ph-image" size={14} />}
                onSelect={() => {
                  close()
                  onExportPng()
                }}
              />
            )}
            {onExportSelectionPng && (
              <MenuRow
                label={EXPORT_SELECTION_AS_PNG}
                icon={<Icon name="ph-selection" size={14} />}
                onSelect={() => {
                  close()
                  onExportSelectionPng()
                }}
              />
            )}
            <MenuRow
              label={WB.clearWhiteboard.text}
              icon={<Icon name="ph-eraser" size={14} />}
              disabled={disabled}
              onSelect={() => {
                close()
                setConfirming(true)
              }}
            />
            <MenuSeparator />
            <MenuRow
              label={WB.deleteObject.text}
              icon={<Icon name="ph-trash" size={14} />}
              onSelect={() => {
                close()
                onDelete()
              }}
            />
          </div>
        )}
      </PopoverMenu>
      <ClearBoardDialog open={confirming} onOpenChange={setConfirming} onConfirm={onClear} />
    </>
  )
}
