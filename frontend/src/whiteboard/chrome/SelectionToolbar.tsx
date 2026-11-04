/**
 * The selection toolbar, shown over the selection. With
 * nodes selected it offers what applies to them: "Color" (border; any node but a point), "Fill"
 * (shapes and frames), "Text alignment" (text blocks and shapes), "Flip" (shapes), "Align"
 * (two or more), the order controls, "Duplicate", "Wrap in new frame", "Add frame title" /
 * "Remove frame title" (one frame) and "Delete". Locked nodes are left out of every edit (they
 * can still be duplicated). With only connectors selected it shows `EdgeStyleMenu`.
 * Every control is one undo step over the whole selection.
 * M8: "View" for embedded objects (`EntityViewMenu`) and "Lock" / "Unlock" (our strings) for
 * the per-node lock: a locked node can't be moved, resized or deleted until it is unlocked.
 */
import type { WhiteboardNode, WhiteboardTextBlock, WhiteboardThemeColor } from '@/api/whiteboardTypes'
import { ColorPicker } from '@/components/ColorPicker'
import { Icon } from '@/components/Icon'
import * as A from '../actions'
import type { SelectionToolbarProps } from '../canvasTypes'
import { isCircuitNode } from '../model'
import { WB } from '../strings'
import { ChromeButton, hint, KEY_HINT, MenuRow, MenuSeparator, PopoverMenu } from './controls'
import { EdgeStyleMenu } from './EdgeStyleMenu'
import { EntityViewMenu } from './EntityViewMenu'

/** Our string: the order controls' menu. */
export const ORDER_LABEL = 'Order'

type Align = NonNullable<WhiteboardTextBlock['align']>
const TEXT_ALIGN: { value: Align; label: string; icon: string }[] = [
  { value: 'left', label: WB.controlTextAlignLeft.text, icon: 'ph-text-align-left' },
  { value: 'center', label: WB.controlTextAlignCenter.text, icon: 'ph-text-align-center' },
  { value: 'right', label: WB.controlTextAlignRight.text, icon: 'ph-text-align-right' },
]

const PLACE: { mode: A.PlaceMode; label: string; icon: string }[] = [
  { mode: 'left', label: WB.placeLeft.text, icon: 'ph-align-left' },
  { mode: 'center', label: WB.placeCenter.text, icon: 'ph-align-center-horizontal' },
  { mode: 'right', label: WB.placeRight.text, icon: 'ph-align-right' },
  { mode: 'top', label: WB.placeTop.text, icon: 'ph-align-top' },
  { mode: 'middle', label: WB.placeMiddle.text, icon: 'ph-align-center-vertical' },
  { mode: 'bottom', label: WB.placeBottom.text, icon: 'ph-align-bottom' },
  { mode: 'row', label: WB.placeRow.text, icon: 'ph-columns' },
  { mode: 'column', label: WB.placeColumn.text, icon: 'ph-rows' },
  { mode: 'grid', label: WB.placeGrid.text, icon: 'ph-grid-four' },
]

const ORDER: { mode: A.OrderMode; label: string; key: string; icon: string }[] = [
  { mode: 'front', label: WB.controlFront.text, key: KEY_HINT.front, icon: 'ph-arrow-line-up' },
  { mode: 'forward', label: WB.controlForward.text, key: KEY_HINT.forward, icon: 'ph-arrow-up' },
  { mode: 'backward', label: WB.controlBackward.text, key: KEY_HINT.backward, icon: 'ph-arrow-down' },
  { mode: 'back', label: WB.controlBack.text, key: KEY_HINT.back, icon: 'ph-arrow-line-down' },
]

function shared<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  const first = items[0]
  return items.every((v) => v === first) ? first : undefined
}

function Divider() {
  return <div aria-hidden className="mx-0.5 h-5 w-px bg-line" />
}

export function SelectionToolbar({ nodes, edges, blocks, actions }: SelectionToolbarProps) {
  if (nodes.length === 0 && edges.length === 0) return null

  if (nodes.length === 0) {
    return (
      <div
        role="toolbar"
        aria-label="Selection"
        data-whiteboard-selection-toolbar=""
        className="flex items-center gap-0.5 rounded-xl border border-line bg-raised p-1 text-fg shadow-lg"
      >
        <EdgeStyleMenu edges={edges} blocks={blocks} actions={actions} />
      </div>
    )
  }

  const editable = nodes.filter((n) => !n.locked)
  const ids = editable.map((n) => n.id)
  const colorTargets = editable.filter((n) => n.kind !== 'point')
  const fillTargets = editable.filter((n) => n.kind === 'shape' || n.kind === 'frame')
  const textTargets = editable.filter(
    (n) =>
      (n.kind === 'shape' && !isCircuitNode(n, blocks)) ||
      (n.kind === 'block' && n.blockId !== undefined && blocks[n.blockId]?.type === 'text'),
  )
  const flipTargets = editable.filter((n) => n.kind === 'shape')
  const entityTargets = editable.filter(
    (n) => n.kind === 'block' && n.blockId !== undefined && blocks[n.blockId]?.type === 'entity',
  )
  const lockable = nodes.filter((n) => n.kind !== 'point')
  const allLocked = lockable.length > 0 && lockable.every((n) => n.locked === true)
  const oneFrame = nodes.length === 1 && editable.length === 1 && editable[0].kind === 'frame' ? editable[0] : null

  const patchNodes = (label: string, targets: WhiteboardNode[], patch: Partial<WhiteboardNode>) =>
    actions.apply(label, (b) => targets.reduce((acc, n) => A.updateNode(acc, n.id, patch), b))

  const textAlignOf = (n: WhiteboardNode): Align => {
    const block = n.blockId !== undefined ? blocks[n.blockId] : undefined
    return block?.type === 'text' && block.align ? block.align : n.kind === 'shape' ? 'center' : 'left'
  }
  const setTextAlign = (align: Align) =>
    actions.apply('align', (b) =>
      textTargets.reduce((acc, n) => {
        const cur = acc.nodes[n.id]
        const block = cur?.blockId !== undefined ? acc.blocks[cur.blockId] : undefined
        const text: WhiteboardTextBlock = block?.type === 'text' ? { ...block, align } : { type: 'text', markdown: '', align }
        return A.setBlock(acc, n.id, text)
      }, b),
    )

  const border = shared(colorTargets.map((n) => n.borderColor))
  const fill = shared(fillTargets.map((n) => n.fillColor))
  const textAlign = shared(textTargets.map(textAlignOf))
  const hasTitle = !!oneFrame && typeof oneFrame.title === 'string' && oneFrame.title !== ''

  return (
    <div
      role="toolbar"
      aria-label="Selection"
      data-whiteboard-selection-toolbar=""
      className="flex items-center gap-0.5 rounded-xl border border-line bg-raised p-1 text-fg shadow-lg"
    >
      {colorTargets.length > 0 && (
        <PopoverMenu
          label={WB.controlColor.text}
          trigger={<Icon name="ph-palette" size={16} />}
          className="p-2"
        >
          {(close) => (
            <ColorPicker
              value={border ?? null}
              onChange={(c) => {
                patchNodes('color', colorTargets, { borderColor: c as WhiteboardThemeColor })
                actions.remember({ lastBorderColor: c as WhiteboardThemeColor })
                close()
              }}
            />
          )}
        </PopoverMenu>
      )}
      {fillTargets.length > 0 && (
        <PopoverMenu label={WB.controlFill.text} trigger={<Icon name="ph-paint-bucket" size={16} />} className="p-2">
          {(close) => (
            <ColorPicker
              value={fill ?? null}
              onChange={(c) => {
                const bg = `bg-${c}` as WhiteboardNode['fillColor']
                patchNodes('fill', fillTargets, { fillColor: bg })
                actions.remember({ lastFillColor: bg })
                close()
              }}
            />
          )}
        </PopoverMenu>
      )}
      {textTargets.length > 0 && (
        <PopoverMenu
          label={WB.controlTextAlign.text}
          trigger={<Icon name={TEXT_ALIGN.find((a) => a.value === (textAlign ?? 'left'))!.icon} size={16} />}
        >
          {(close) => (
            <div role="menu" aria-label={WB.controlTextAlign.text} className="flex flex-col">
              {TEXT_ALIGN.map((a) => (
                <MenuRow
                  key={a.value}
                  label={a.label}
                  icon={<Icon name={a.icon} size={14} />}
                  selected={textAlign === a.value}
                  onSelect={() => {
                    setTextAlign(a.value)
                    close()
                  }}
                />
              ))}
            </div>
          )}
        </PopoverMenu>
      )}
      {entityTargets.length > 0 && <EntityViewMenu nodes={entityTargets} blocks={blocks} actions={actions} />}
      {flipTargets.length > 0 && (
        <PopoverMenu label={WB.controlFlip.text} trigger={<Icon name="ph-flip-horizontal" size={16} />}>
          {(close) => (
            <div role="menu" aria-label={WB.controlFlip.text} className="flex flex-col">
              <MenuRow
                label={WB.controlFlipHorizontal.text}
                tip={hint(WB.shortcutFlipHorizontal.text, KEY_HINT.flipX)}
                icon={<Icon name="ph-flip-horizontal" size={14} />}
                onSelect={() => {
                  actions.flip('x', flipTargets.map((n) => n.id))
                  close()
                }}
              />
              <MenuRow
                label={WB.controlFlipVertical.text}
                tip={hint(WB.shortcutFlipVertical.text, KEY_HINT.flipY)}
                icon={<Icon name="ph-flip-vertical" size={14} />}
                onSelect={() => {
                  actions.flip('y', flipTargets.map((n) => n.id))
                  close()
                }}
              />
            </div>
          )}
        </PopoverMenu>
      )}
      {editable.length >= 2 && (
        <PopoverMenu label={WB.controlAlign.text} trigger={<Icon name="ph-align-left" size={16} />}>
          {(close) => (
            <div role="menu" aria-label={WB.controlAlign.text} className="flex flex-col">
              {PLACE.map((p, i) => (
                <div key={p.mode}>
                  {(i === 3 || i === 6) && <MenuSeparator />}
                  <MenuRow
                    label={p.label}
                    icon={<Icon name={p.icon} size={14} />}
                    onSelect={() => {
                      actions.place(p.mode, ids)
                      close()
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </PopoverMenu>
      )}
      {editable.length > 0 && (
        <PopoverMenu label={ORDER_LABEL} trigger={<Icon name="ph-stack" size={16} />}>
          {(close) => (
            <div role="menu" aria-label={ORDER_LABEL} className="flex flex-col">
              {ORDER.map((o) => (
                <MenuRow
                  key={o.mode}
                  label={o.label}
                  tip={hint(o.label, o.key)}
                  icon={<Icon name={o.icon} size={14} />}
                  onSelect={() => {
                    actions.order(o.mode, ids)
                    close()
                  }}
                />
              ))}
            </div>
          )}
        </PopoverMenu>
      )}
      <Divider />
      <ChromeButton
        label={WB.controlDuplicate.text}
        tip={hint(WB.shortcutDuplicate.text, KEY_HINT.duplicate)}
        onClick={() => actions.duplicate(nodes.map((n) => n.id))}
      >
        <Icon name="ph-copy" size={16} />
      </ChromeButton>
      {editable.length > 0 && (
        <ChromeButton
          label={WB.controlWrapInFrame.text}
          tip={hint(WB.shortcutWrapInFrame.text, KEY_HINT.wrap)}
          onClick={() => actions.wrapInFrame(ids)}
        >
          <Icon name="ph-frame-corners" size={16} />
        </ChromeButton>
      )}
      {oneFrame &&
        (hasTitle ? (
          <ChromeButton label={WB.controlRemoveTitle.text} onClick={() => actions.removeFrameTitle(oneFrame.id)}>
            <Icon name="ph-text-t-slash" size={16} />
          </ChromeButton>
        ) : (
          <ChromeButton label={WB.controlAddTitle.text} onClick={() => actions.addFrameTitle(oneFrame.id)}>
            <Icon name="ph-text-t" size={16} />
          </ChromeButton>
        ))}
      {lockable.length > 0 && (
        <ChromeButton
          label={allLocked ? WB.nodeUnlock.text : WB.nodeLock.text}
          pressed={allLocked}
          data-whiteboard-node-lock=""
          onClick={() => actions.apply(allLocked ? 'unlock' : 'lock', (b) => A.setNodesLocked(b, lockable.map((n) => n.id), !allLocked))}
        >
          <Icon name={allLocked ? 'ph-lock-simple' : 'ph-lock-simple-open'} size={16} />
        </ChromeButton>
      )}
      {editable.length > 0 && (
        <ChromeButton
          label={WB.controlDelete.text}
          tip={hint(WB.controlDelete.text, KEY_HINT.delete)}
          onClick={() => actions.removeSelection(ids)}
        >
          <Icon name="ph-trash" size={16} />
        </ChromeButton>
      )}
    </div>
  )
}
