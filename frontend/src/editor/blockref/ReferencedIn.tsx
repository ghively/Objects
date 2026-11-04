/**
 * "Referenced in" (M8): a block with an id that other objects
 * reference shows, after its text, the objects holding `![[<Title>#^<id>]]` or `[[<Title>#^<id>]]`
 * (`GET /api/block/references`). Nothing shows while there are none. Clicking one opens it.
 *
 * `blockRef.ts` mounts one per block id as a widget at the end of the block (`mountReferencedIn`).
 */
import { useEffect, useState, type MouseEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { api } from '@/api/client'
import { openObject } from '@/create/createAndOpen'
import { stemOf, summaryOf, useLinkIndex } from '@/links/linkIndex'
import { blockClient } from './blockClient'
import './blockref.css'

export const REFERENCED_IN = 'Referenced in'

export function ReferencedIn({ path, id }: { path: string; id: string }) {
  const [paths, setPaths] = useState<string[]>([])
  const [tick, setTick] = useState(0)
  useLinkIndex((s) => s.revision) // re-render titles when the index loads

  useEffect(() => {
    let alive = true
    blockClient
      .blockReferences(path, id)
      .then((r) => alive && setPaths(r.paths ?? []))
      .catch(() => alive && setPaths([]))
    return () => {
      alive = false
    }
  }, [path, id, tick])

  // A referrer may be added or removed anywhere: re-ask on any object change but this one's own.
  useEffect(
    () =>
      api.onChange((ev) => {
        if (ev.kind !== 'types' && ev.path !== path) setTick((t) => t + 1)
      }),
    [path],
  )

  if (paths.length === 0) return null
  const open = (p: string, e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openObject(p, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, via: 'link' }, summaryOf(p)?.type)
  }
  return (
    <span className="block-referenced-in" data-testid="referenced-in" contentEditable={false}>
      <span className="block-referenced-in-label">{REFERENCED_IN}</span>
      {paths.map((p) => (
        <button key={p} type="button" className="block-referenced-in-link" onMouseDown={(e) => e.preventDefault()} onClick={(e) => open(p, e)}>
          {summaryOf(p)?.title || stemOf(p)}
        </button>
      ))}
    </span>
  )
}

/** Mount `ReferencedIn` into `el` (a widget's DOM); returns the unmount function. */
export function mountReferencedIn(el: HTMLElement, path: string, id: string): () => void {
  const root: Root = createRoot(el)
  root.render(<ReferencedIn path={path} id={id} />)
  return () => {
    // Unmount after the current render pass (a widget may be destroyed during one).
    setTimeout(() => root.unmount(), 0)
  }
}
