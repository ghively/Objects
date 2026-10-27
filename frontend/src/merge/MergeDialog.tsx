/**
 * The "Merge into" dialog (M8 Task 6 fills it). Mounted once in `shell/GlobalOverlays.tsx`; it reads
 * `useMerge`. Task 3's stub renders nothing.
 */
import { useMerge } from './useMerge'

export function MergeDialog() {
  useMerge((s) => s.source)
  return null
}

export default MergeDialog
