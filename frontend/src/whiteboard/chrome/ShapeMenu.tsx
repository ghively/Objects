/**
 * The toolbox's shape menu: Object's `whiteboardShapeMenuTools` in order (Line, Arrow, then
 * the nine picker shapes). Rounded rectangle, Triangle down and the left block arrow stay
 * renderable for existing boards but are not offered, as in Object.
 */
import type { WhiteboardShapeMenuTool, WhiteboardTool } from '@/api/whiteboardTypes'
import { SHAPE_MENU_TOOLS } from '../model'
import { WB } from '../strings'
import { KEY_HINT, MenuRow, ShapeIcon, hint, toolLabel } from './controls'

export interface ShapeMenuProps {
  /** The current tool (its row is marked). */
  value?: WhiteboardTool
  onPick(tool: WhiteboardShapeMenuTool): void
  disabled?: boolean
}

const KEYS: Partial<Record<WhiteboardShapeMenuTool, string>> = {
  line: KEY_HINT.line,
  arrow: KEY_HINT.arrow,
  rectangle: KEY_HINT.rectangle,
  ellipse: KEY_HINT.ellipse,
  triangle: KEY_HINT.triangle,
}

export function ShapeMenu({ value, onPick, disabled }: ShapeMenuProps) {
  return (
    <div role="menu" aria-label={WB.toolShapes.text} data-whiteboard-shape-menu="" className="flex flex-col">
      {SHAPE_MENU_TOOLS.map((tool) => (
        <MenuRow
          key={tool}
          label={toolLabel(tool)}
          tip={hint(toolLabel(tool), KEYS[tool])}
          icon={<ShapeIcon tool={tool} />}
          selected={value === tool}
          disabled={disabled}
          onSelect={() => onPick(tool)}
        />
      ))}
    </div>
  )
}
