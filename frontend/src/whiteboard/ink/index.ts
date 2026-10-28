import type { MdStamp } from '@/api/whiteboardTypes'
import { inkClient } from './inkClient'
import { InkLayer } from './InkLayer'
import { InkToolbar } from './InkToolbar'
import { useInkDoc } from './useInkDoc'
import type { InkPlugin } from './types'

/** The plugin's hook: the board's ink file through the real client. */
function usePluginInkDoc(path: string, onMdStamp?: (stamp: MdStamp) => void) {
  return useInkDoc(path, inkClient, onMdStamp)
}

/** Lane B's ink plugin; Task 13 passes it to `WhiteboardPage`. */
export const inkPlugin: InkPlugin = {
  Layer: InkLayer,
  Toolbar: InkToolbar,
  useInkDoc: usePluginInkDoc,
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
