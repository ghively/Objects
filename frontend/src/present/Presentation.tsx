/**
 * The full-screen presentation (M8 Task 9 fills it). Mounted once in `shell/GlobalOverlays.tsx`; it
 * reads `usePresentation`. Task 3's stub renders nothing.
 */
import { usePresentation } from './usePresentation'

export function Presentation() {
  usePresentation((s) => s.path)
  return null
}

export default Presentation
