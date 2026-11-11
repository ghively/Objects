// M32, tests only: put the Work switch where a test needs it without a fetch. `useWorkOn()` reads
// `useSpaceInfo`'s space, which is null until `GET /api/space` answers, so a component rendered on
// its own sees Work off. The shared mock's `space()` (test/mockApi.ts) answers with Work on; a
// test that mocks `space` itself adds `workOn: true` to its answer, or calls this after the load.
import type { SpaceInfo } from '@/api/types'
import { useSpaceInfo } from '@/settings/useSpaceInfo'

const BLANK: SpaceInfo = { name: 'space', root: '/space', types: [] }

/** Work on (the default) or off for the loaded space; a space is made up when none is loaded. */
export function setWorkOn(on = true): void {
  const cur = useSpaceInfo.getState().space ?? BLANK
  useSpaceInfo.setState({ space: { ...cur, workEnabled: on, workOn: on }, loaded: true })
}
