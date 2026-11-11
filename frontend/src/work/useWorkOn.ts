// M32: the Work switch. Whether the Work page (the dashboard: Now, Energy, Brain dump, queues,
// agent views, alerts, tickets) is on for the open space. The server answers it in
// `GET /api/space` (`workOn`, the effective value; `workEnabled` is what `space.json` stores:
// true, false or null) and the app reads it from the same store as the rest of the space's
// config (`useSpaceInfo`). Off until the space's info has loaded.
import { useSpaceInfo } from '@/settings/useSpaceInfo'

/** Whether Work is on for the open space (re-renders when it changes). */
export function useWorkOn(): boolean {
  return useSpaceInfo((s) => s.space?.workOn ?? false)
}

/** The same answer outside a component (a key handler, a command list). */
export function isWorkOn(): boolean {
  return useSpaceInfo.getState().space?.workOn ?? false
}

/**
 * Turn the Work page on or off for the open space ("Use the Work page in this space"): writes
 * `workEnabled` to `space.json` through `PUT /api/space` and nothing else. Shown at once; a
 * refused write puts the stored value back (the store reloads) and rejects.
 */
export function setWorkEnabled(on: boolean): Promise<void> {
  const done = useSpaceInfo.getState().patch({ workEnabled: on })
  // The patch is shown at once; the effective value follows it until the server answers.
  const cur = useSpaceInfo.getState().space
  if (cur) useSpaceInfo.setState({ space: { ...cur, workOn: on } })
  return done
}
