/**
 * The block reference's node view (M8): `![[<Title>#^<id>]]` drawn as the referenced block, live
 * and read-only, under its source object's title.
 *
 * - The target resolves through the link index from the object holding the editor, then
 *   `GET /api/block` gives the block's Markdown, shown in a read-only editor (its trailing
 *   ` ^id` left out). A change to the source file (the SSE change stream) fetches it again.
 * - A click opens the source (as a link) and scrolls to the block (`scrollToBlock`).
 * - A reference that sits inside its own rendering (directly, or through another embedded block
 *   or object) shows a "referencing itself" note instead.
 * - A block or object that can't be found shows "Block not found." (our string).
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { api } from '@/api/client'
import { openObject } from '@/create/createAndOpen'
import { ensureLinkIndex, resolveLink, stemOf, summaryOf, useLinkIndex } from '@/links/linkIndex'
import { Editor } from '../Editor'
import { blockClient, type BlockInfo } from './blockClient'
import './blockref.css'

export const BLOCK_REF_TEXT = {
  recursive: 'This block reference seems to be referencing itself either directly or through another embedded object.',
  notFound: 'Block not found.', // our string
}

const noop = () => {}

/** The key a rendered reference marks its DOM with, for the self-reference check. */
export const blockRefKey = (path: string, id: string) => `${path}#^${id}`

/** `markdown` without the ` ^id` that ends the block. */
export function withoutBlockId(markdown: string, id: string): string {
  return markdown.replace(new RegExp(` \\^${id}[ \\t]*(?=\\r?\\n|$)`), '')
}

/** True when `el` sits inside the rendering of the reference `key` (a reference chain that loops). */
export function insideRendering(el: Element | null, key: string): boolean {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    if (n.getAttribute('data-block-ref-key') === key) return true
  }
  return false
}

/**
 * Scroll the open object's editor to the block with `id` (polls briefly while the tab opens).
 * Resolves true when it found the block.
 */
export function scrollToBlock(path: string, id: string, tries = 40): Promise<boolean> {
  return new Promise((resolve) => {
    let n = 0
    const step = () => {
      // The poll can outlive its page (a test's teardown, a closed window): stop quietly.
      if (typeof document === 'undefined') return resolve(false)
      const roots = document.querySelectorAll(`[data-object-path="${CSS.escape(path)}"]`)
      for (const root of Array.from(roots)) {
        if (root.closest('[data-block-ref-key]')) continue
        const mark = root.querySelector(`.block-id[data-block-id="${CSS.escape(id)}"]`)
        if (mark) {
          const block = mark.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote') ?? mark
          block.scrollIntoView?.({ block: 'center' })
          block.classList.add('block-ref-flash')
          setTimeout(() => block.classList.remove('block-ref-flash'), 1200)
          return resolve(true)
        }
      }
      if (++n >= tries) return resolve(false)
      setTimeout(step, 50)
    }
    step()
  })
}

type Loaded =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'recursive'; path: string }
  | { status: 'ok'; path: string; block: BlockInfo }

export function BlockRefView({ node, editor, selected }: NodeViewProps) {
  const target = String(node.attrs.target ?? '')
  const id = String(node.attrs.id ?? '')
  const label = (node.attrs.label as string | null) ?? null
  const revision = useLinkIndex((s) => s.revision)
  const ref = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const sourcePath = loaded.status === 'ok' || loaded.status === 'recursive' ? loaded.path : null

  useEffect(() => {
    let alive = true
    const from =
      (editor.view.dom as HTMLElement).closest?.('[data-object-path]')?.getAttribute('data-object-path') ?? undefined
    void (async () => {
      await ensureLinkIndex()
      const path = await resolveLink(target, from)
      if (!alive) return
      if (!path || !id) return setLoaded({ status: 'missing' })
      if (insideRendering(ref.current, blockRefKey(path, id))) return setLoaded({ status: 'recursive', path })
      try {
        const block = await blockClient.block(path, id)
        if (alive) setLoaded({ status: 'ok', path, block })
      } catch {
        if (alive) setLoaded({ status: 'missing' })
      }
    })()
    return () => {
      alive = false
    }
  }, [editor, target, id, revision, tick])

  // Live: the source changed on disk (or through another window, or our own save).
  useEffect(() => {
    if (!sourcePath) return
    return api.onChange((ev) => {
      if (ev.path === sourcePath || ev.oldPath === sourcePath) setTick((t) => t + 1)
    })
  }, [sourcePath])

  const open = (e: MouseEvent) => {
    if (!sourcePath) return
    e.preventDefault()
    e.stopPropagation()
    openObject(sourcePath, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, via: 'link' }, summaryOf(sourcePath)?.type)
    void scrollToBlock(sourcePath, id)
  }

  const title = sourcePath ? summaryOf(sourcePath)?.title || stemOf(sourcePath) : target
  let body
  if (loaded.status === 'loading') body = <div className="block-ref-loading" aria-busy="true" />
  else if (loaded.status === 'missing') body = <p className="block-ref-message" data-testid="block-ref-missing">{BLOCK_REF_TEXT.notFound}</p>
  else if (loaded.status === 'recursive') body = <p className="block-ref-message" data-testid="block-ref-recursive">{BLOCK_REF_TEXT.recursive}</p>
  else
    body = (
      <div className="block-ref-content" onClick={open} data-testid="block-ref-content">
        <Editor
          path={loaded.path}
          body={withoutBlockId(loaded.block.markdown, id)}
          version={loaded.block.version}
          readOnly
          onSaved={noop}
          onConflict={noop}
        />
      </div>
    )

  return (
    <NodeViewWrapper
      className={`block-ref${selected ? ' is-selected' : ''}`}
      data-block-ref={id}
      data-target={target}
      data-testid="block-ref"
    >
      <div
        ref={ref}
        className="block-ref-frame"
        contentEditable={false}
        data-block-ref-key={sourcePath ? blockRefKey(sourcePath, id) : undefined}
      >
        {body}
        <button type="button" className="block-ref-source" onClick={open} data-testid="block-ref-source">
          {label || title}
        </button>
      </div>
    </NodeViewWrapper>
  )
}
