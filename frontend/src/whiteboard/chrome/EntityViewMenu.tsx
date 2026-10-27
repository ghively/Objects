/**
 * The entity node "View" menu (M8, `Whiteboard.control.view`): switches an embedded object
 * between M7's four views, "Link block", "Small card", "Wide card" and "Embed"
 * (`structureViewTypes.*.name`). The choice is the entity block's optional `view` key (our key);
 * a block without one shows the small card, as before M8.
 */
import type { WhiteboardBlock, WhiteboardEntityView, WhiteboardNode } from '@/api/whiteboardTypes'
import { Icon } from '@/components/Icon'
import * as A from '../actions'
import type { BoardActions } from '../canvasTypes'
import { WB } from '../strings'
import { MenuRow, PopoverMenu } from './controls'

/** The four views in Object's order, with their names and icons (icons our choice). */
export const ENTITY_VIEWS: { view: WhiteboardEntityView; label: string; icon: string }[] = [
  { view: 'inline', label: WB.viewInline.text, icon: 'ph-link-simple' },
  { view: 'smallCard', label: WB.viewSmallCard.text, icon: 'ph-cards' },
  { view: 'wideCard', label: WB.viewWideCard.text, icon: 'ph-rectangle' },
  { view: 'embed', label: WB.viewEmbed.text, icon: 'ph-article' },
]

/** The view an entity block shows: its `view`, else the small card. */
export function entityViewOf(block: WhiteboardBlock | undefined): WhiteboardEntityView {
  const v = block?.type === 'entity' ? block.view : undefined
  return v && ENTITY_VIEWS.some((e) => e.view === v) ? v : 'smallCard'
}

export interface EntityViewMenuProps {
  /** The selected entity nodes (unlocked). */
  nodes: WhiteboardNode[]
  blocks: Record<string, WhiteboardBlock>
  actions: BoardActions
}

export function EntityViewMenu({ nodes, blocks, actions }: EntityViewMenuProps) {
  if (nodes.length === 0) return null
  const views = nodes.map((n) => entityViewOf(n.blockId !== undefined ? blocks[n.blockId] : undefined))
  const current = views.every((v) => v === views[0]) ? views[0] : undefined
  const icon = ENTITY_VIEWS.find((v) => v.view === (current ?? 'smallCard'))!.icon
  return (
    <PopoverMenu label={WB.controlView.text} trigger={<Icon name={icon} size={16} />}>
      {(close) => (
        <div role="menu" aria-label={WB.controlView.text} className="flex flex-col" data-whiteboard-view-menu="">
          {ENTITY_VIEWS.map((v) => (
            <MenuRow
              key={v.view}
              label={v.label}
              icon={<Icon name={v.icon} size={14} />}
              selected={current === v.view}
              onSelect={() => {
                actions.apply('view', (b) => nodes.reduce((acc, n) => A.setEntityView(acc, n.id, v.view), b))
                close()
              }}
            />
          ))}
        </div>
      )}
    </PopoverMenu>
  )
}
