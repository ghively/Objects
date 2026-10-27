/**
 * The Version History dialog (M8 Task 5 fills it). Mounted once in `shell/GlobalOverlays.tsx`; it
 * reads `useVersionHistory`. Task 3's stub renders nothing.
 */
import { useVersionHistory } from './useVersionHistory'

export function VersionHistoryDialog() {
  useVersionHistory((s) => s.path)
  return null
}

export default VersionHistoryDialog
