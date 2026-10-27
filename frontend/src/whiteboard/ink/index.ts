import { InkLayer } from './InkLayer'
import { InkToolbar } from './InkToolbar'
import { useInkDoc } from './useInkDoc'
import type { InkPlugin } from './types'

/** Lane B's ink plugin; Task 13 passes it to `WhiteboardPage`. */
export const inkPlugin: InkPlugin = {
  Layer: InkLayer,
  Toolbar: InkToolbar,
  useInkDoc,
}

export { InkLayer, InkToolbar, useInkDoc }
export type {
  InkDoc,
  InkEraseMode,
  InkLayerProps,
  InkPlugin,
  InkResponse,
  InkStroke,
  InkStrokeTool,
  InkTool,
  InkToolbarProps,
  InkToolState,
} from './types'
