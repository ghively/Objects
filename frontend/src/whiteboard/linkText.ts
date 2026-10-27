/**
 * The wikilink text a board (or a drag) writes for an object, the same rule as the back end's
 * `Space._link_text`: the title when a wikilink can hold it and it names only this object,
 * otherwise the space path without `.md` (`[[Pages/Plan draft]]`), which always resolves.
 */
import type { ObjectSummary } from '@/api/types'
import { stemOf, useLinkIndex } from '@/links/linkIndex'

/** `[`, `]`, `|`, `#` or a line break end a wikilink's target (backend `_LINK_BREAKING_RE`). */
const LINK_BREAKING = /[[\]|#\n\r]/

function pathForm(path: string): string {
  return path.replace(/\.md$/i, '')
}

/** The link target for `path`; `title` is used when its summary isn't loaded. */
export function linkTargetFor(
  path: string,
  title?: string,
  objects: ObjectSummary[] = useLinkIndex.getState().objects,
): string {
  const own = objects.find((o) => o.path === path)
  const name = own?.title ?? title ?? stemOf(path)
  if (!name.trim() || name !== name.trim() || LINK_BREAKING.test(name)) return pathForm(path)
  // Not in the index (not loaded yet): the caller's title, as long as a wikilink can hold it.
  if (!own) return name
  const clash = objects.some(
    (o) => o.path !== path && (o.title === name || pathForm(o.path) === name),
  )
  return clash ? pathForm(path) : name
}

/** `[[target]]` for `path` (see `linkTargetFor`). */
export function wikilinkFor(path: string, title?: string, objects?: ObjectSummary[]): string {
  return `[[${linkTargetFor(path, title, objects)}]]`
}
