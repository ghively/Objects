/**
 * The board's "…" menu beside its title: "Open as page" (in the peek; our string, as the page's
 * own button), "Clear Whiteboard" (confirmed by `ClearBoardDialog`) and "Delete" (the page wires
 * it to `host.requestDelete`, which opens M1's delete dialog).
 */
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import type { BoardMenuProps } from '../canvasTypes'
import { WB } from '../strings'
import { ClearBoardDialog } from './ClearBoardDialog'
import { MenuRow, MenuSeparator, PopoverMenu } from './controls'

/** Our string (the same text as the page's expand button). */
export const OPEN_AS_PAGE = 'Open as page'

export function BoardMenu({ onClear, onDelete, onOpenAsPage, disabled = false }: BoardMenuProps) {
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
