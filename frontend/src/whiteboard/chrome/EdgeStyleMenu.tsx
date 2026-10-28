/**
 * Connector controls in the selection toolbar: "Start tip" / "End tip" (None, Arrow, Dot,
 * Double arrow), "Connection" (Straight, Cornered, Curved), "Line" (Solid, Dashed, Dotted),
 * "Color", "Add arrow label" / "Remove arrow label" and "Delete". A connection or line change
 * is also remembered for the board's next connector (`rememberedWhiteboardEdgeStyle`).
 */
import type {
  WhiteboardBlock,
  WhiteboardEdge,
  WhiteboardEdgeConnection,
  WhiteboardEdgeLine,
  WhiteboardPickerMarker,
  WhiteboardThemeColor,
} from '@/api/whiteboardTypes'
import { ColorPicker } from '@/components/ColorPicker'
import { Icon } from '@/components/Icon'
import * as A from '../actions'
import type { BoardActions } from '../canvasTypes'
import { CONNECTIONS, LINES, normalizeConnection, normalizeLine, normalizeMarker, PICKER_MARKERS } from '../model'
import { WB } from '../strings'
import { ChromeButton, hint, KEY_HINT, MenuRow, PopoverMenu } from './controls'

export const MARKER_LABEL: Record<WhiteboardPickerMarker, string> = {
  none: WB.edgeTipNone.text,
  arrow: WB.edgeTipArrow.text,
  dot: WB.edgeTipDot.text,
  double: WB.edgeTipDouble.text,
}
export const CONNECTION_LABEL: Record<WhiteboardEdgeConnection, string> = {
  straight: WB.edgeConnectionStraight.text,
  cornered: WB.edgeConnectionCornered.text,
  curved: WB.edgeConnectionCurved.text,
}
export const LINE_LABEL: Record<WhiteboardEdgeLine, string> = {
  solid: WB.edgeLineSolid.text,
  dashed: WB.edgeLineDashed.text,
  dotted: WB.edgeLineDotted.text,
}

const CONNECTION_ICON: Record<WhiteboardEdgeConnection, string> = {
  straight: 'ph-line-segment',
  cornered: 'ph-path',
  curved: 'ph-bezier-curve',
}

/** The value all `items` share, or undefined when they differ. */
function shared<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  const first = items[0]
  return items.every((v) => v === first) ? first : undefined
}

export interface EdgeStyleMenuProps {
  edges: WhiteboardEdge[]
  blocks: Record<string, WhiteboardBlock>
  actions: BoardActions
}

export function EdgeStyleMenu({ edges, blocks, actions }: EdgeStyleMenuProps) {
  const ids = edges.map((e) => e.id)
  const patchAll = (label: string, patch: Partial<WhiteboardEdge>) =>
    actions.apply(label, (b) => ids.reduce((acc, id) => A.updateEdge(acc, id, patch), b))

  const start = shared(edges.map((e) => normalizeMarker(e.markerStart)))
  const end = shared(edges.map((e) => normalizeMarker(e.markerEnd)))
  const connection = shared(edges.map((e) => normalizeConnection(e.connection)))
  const line = shared(edges.map((e) => normalizeLine(e.line)))
  const color = shared(edges.map((e) => e.color))
  const hasLabel = (e: WhiteboardEdge) => (e.blockId !== undefined && !!blocks[e.blockId]) || typeof e.label === 'string'
  const allLabelled = edges.length > 0 && edges.every(hasLabel)

  const markerMenu = (which: 'markerStart' | 'markerEnd', title: string, value: WhiteboardPickerMarker | undefined) => (
    <PopoverMenu
      label={title}
      trigger={<Icon name={which === 'markerStart' ? 'ph-arrow-line-left' : 'ph-arrow-line-right'} size={16} />}
    >
      {(close) => (
        <div role="menu" aria-label={title} className="flex flex-col">
          {PICKER_MARKERS.map((m) => (
            <MenuRow
              key={m}
              label={MARKER_LABEL[m]}
              selected={value === m}
              onSelect={() => {
                patchAll('style', { [which]: m })
                close()
              }}
            />
          ))}
        </div>
      )}
    </PopoverMenu>
  )

  return (
    <>
      {markerMenu('markerStart', WB.edgeTipStart.text, start)}
      {markerMenu('markerEnd', WB.edgeTipEnd.text, end)}
      <PopoverMenu label={WB.edgeConnection.text} trigger={<Icon name={CONNECTION_ICON[connection ?? 'cornered']} size={16} />}>
        {(close) => (
          <div role="menu" aria-label={WB.edgeConnection.text} className="flex flex-col">
            {CONNECTIONS.map((c) => (
              <MenuRow
                key={c}
                label={CONNECTION_LABEL[c]}
                icon={<Icon name={CONNECTION_ICON[c]} size={14} />}
                selected={connection === c}
                onSelect={() => {
                  patchAll('style', { connection: c })
                  actions.remember({ lastEdgeConnection: c })
                  close()
                }}
              />
            ))}
          </div>
        )}
      </PopoverMenu>
      <PopoverMenu label={WB.edgeLine.text} trigger={<Icon name="ph-line-segments" size={16} />}>
        {(close) => (
          <div role="menu" aria-label={WB.edgeLine.text} className="flex flex-col">
            {LINES.map((l) => (
              <MenuRow
                key={l}
                label={LINE_LABEL[l]}
                selected={line === l}
                onSelect={() => {
                  patchAll('style', { line: l })
                  actions.remember({ lastEdgeLine: l })
                  close()
                }}
              />
            ))}
          </div>
        )}
      </PopoverMenu>
      <PopoverMenu label={WB.controlColor.text} trigger={<Icon name="ph-palette" size={16} />} className="p-2">
        {(close) => (
          <ColorPicker
            value={color ?? null}
            onChange={(c) => {
              patchAll('color', { color: c as WhiteboardThemeColor })
              close()
            }}
          />
        )}
      </PopoverMenu>
      {allLabelled ? (
        <ChromeButton
          label={WB.controlRemoveLabel.text}
          onClick={() => actions.apply('label', (b) => ids.reduce((acc, id) => A.removeEdgeLabel(acc, id), b))}
        >
          <Icon name="ph-text-t-slash" size={16} />
        </ChromeButton>
      ) : (
        <ChromeButton
          label={WB.controlAddLabel.text}
          onClick={() => {
            actions.apply('label', (b) => ids.reduce((acc, id) => A.addEdgeLabel(acc, id), b))
            if (ids.length === 1) actions.beginEdit(ids[0])
          }}
        >
          <Icon name="ph-text-t" size={16} />
        </ChromeButton>
      )}
      <ChromeButton
        label={WB.controlDelete.text}
        tip={hint(WB.controlDelete.text, KEY_HINT.delete)}
        onClick={() => actions.removeSelection(ids)}
      >
        <Icon name="ph-trash" size={16} />
      </ChromeButton>
    </>
  )
}
