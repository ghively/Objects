/**
 * Focus mode's effects on the shell and its timer (M8 Task 9 fills it). Mounted once in
 * `shell/GlobalOverlays.tsx`; it reads `useFocusMode`. Task 3's stub renders nothing.
 */
import { useFocusMode } from './useFocusMode'

export function FocusMode() {
  useFocusMode((s) => s.on)
  return null
}

export default FocusMode
