/**
 * An embedded object (a block node whose block is `{type: 'entity', link: '[[Title]]'}`): the
 * 30 px caption bar (icon and title) 6 px above the node box
 * (`--whiteboard-embed-caption-height`/`-gap`), and the object as M3's small card. At least 360
 * wide. Double-click opens the object in the peek; Ctrl/Cmd+double-click in a new tab (our
 * choice, through the host). A link that resolves to nothing shows its text in the dangling style.
 * M8: the block's optional `view` (the selection toolbar's "View" menu) draws the object as M7's
 * "Link block", "Small card" (the default), "Wide card" or "Embed" through M3's `ObjectCard`.
 */
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Row } from '@/api/types'
import type { WhiteboardEntityBlock } from '@/api/whiteboardTypes'
import { IconOrEmoji } from '@/components/Icon'
import { typeOf } from '@/links/linkIndex'
import { cardProperties, type CardProperty } from '@/views/cards/cardConfig'
import { ObjectCard } from '@/views/cards/ObjectCard'
import { SmallCard } from '@/views/cards/SmallCard'
import type { WhiteboardNodeProps } from '../canvasTypes'
import { entityViewOf } from '../chrome/EntityViewMenu'
import { borderStyle } from '../colors'
import { useWhiteboardHost, type WhiteboardHost } from '../host'
import { LINK_BLOCK_MIN_WIDTH } from '../model'
import { blockFrameStyle, NodeChrome } from './NodeChrome'
import { wikilinkText } from './TextBlockEditor'

// ---- rows, batched: every embed rendered in the same tick shares one `host.rows` call ----

interface Batch {
  paths: Set<string>
  promise: Promise<Map<string, Row>>
}

const batches = new WeakMap<WhiteboardHost, Batch>()

/** The row of `path`, fetched together with every other row asked for in the same tick. */
export function loadRow(host: WhiteboardHost, path: string): Promise<Row | null> {
  let batch = batches.get(host)
  if (!batch) {
    const paths = new Set<string>()
    const promise = Promise.resolve().then(async () => {
      batches.delete(host)
      const rows = await host.rows([...paths])
      return new Map(rows.map((r) => [r.summary.path, r]))
    })
    batch = { paths, promise }
    batches.set(host, batch)
  }
  batch.paths.add(path)
  return batch.promise.then((m) => m.get(path) ?? null).catch(() => null)
}

type Resolved = { state: 'loading' } | { state: 'dangling' } | { state: 'ok'; path: string; row: Row | null }

function useEmbedded(host: WhiteboardHost, link: string): Resolved {
  const [resolved, setResolved] = useState<{ link: string; value: Resolved }>({ link, value: { state: 'loading' } })
  useEffect(() => {
    let live = true
    void (async () => {
      let path: string | null = null
      try {
        path = await host.resolve(link)
      } catch {
        path = null
      }
      if (!live) return
      if (!path) {
        setResolved({ link, value: { state: 'dangling' } })
        return
      }
      const row = await loadRow(host, path)
      if (live) setResolved({ link, value: { state: 'ok', path, row } })
    })()
    return () => {
      live = false
    }
  }, [host, link])
  return resolved.link === link ? resolved.value : { state: 'loading' }
}

const TITLE_ONLY: CardProperty[] = [{ propertyType: 'entity_title', propertyId: 'title' } as CardProperty]

export function EntityNode({ data, selected }: WhiteboardNodeProps) {
  const node = data.node
  const block = data.block as WhiteboardEntityBlock
  const host = useWhiteboardHost()
  const embedded = useEmbedded(host, block.link)
  const text = wikilinkText(block.link)
  const view = entityViewOf(block)

  const path = embedded.state === 'ok' ? embedded.path : null
  const row = embedded.state === 'ok' ? embedded.row : null
  const type = row ? typeOf(row.summary.type) : undefined
  const title = row?.summary.title || text

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!path) return
    e.stopPropagation()
    host.openObject(path, { ctrlKey: e.ctrlKey, metaKey: e.metaKey })
  }

  return (
    <NodeChrome node={node} selected={!!selected} entity>
      <div
        className="relative box-border h-full"
        style={{ ...blockFrameStyle(node), minWidth: LINK_BLOCK_MIN_WIDTH, maxHeight: undefined }}
        data-testid="whiteboard-entity-node"
        data-path={path ?? undefined}
        data-dangling={embedded.state === 'dangling' ? '' : undefined}
        data-view={view}
        onDoubleClick={onDoubleClick}
      >
        <div className="whiteboard-embed-caption flex items-center gap-1.5 truncate px-1 text-[14px] text-fg-muted" data-testid="whiteboard-embed-caption">
          <IconOrEmoji icon={row?.summary.icon ?? type?.icon} fallback="ph-file-text" size={16} />
          {embedded.state === 'dangling' ? (
            <span className="wikilink wikilink-unresolved truncate opacity-50 underline decoration-dotted underline-offset-2">{text}</span>
          ) : (
            <span className="truncate">{title}</span>
          )}
        </div>
        <div
          className="whiteboard-node-frame box-border h-full w-full overflow-hidden"
          style={{ background: 'var(--color-bg-base)', ...borderStyle(node.borderColor) }}
        >
          {row && view !== 'smallCard' ? (
            <div className="pointer-events-none h-full w-full overflow-hidden" data-testid="whiteboard-entity-view">
              <ObjectCard row={row} type={type} view={view} props={type ? cardProperties(type) : TITLE_ONLY} />
            </div>
          ) : row ? (
            <SmallCard
              row={row}
              type={type}
              props={type ? cardProperties(type) : TITLE_ONLY}
              className="pointer-events-none h-full w-full rounded-none border-0 shadow-none"
            />
          ) : (
            <div className="whiteboard-node-surface box-border text-[15px]">
              {embedded.state === 'dangling' ? (
                <span
                  className="wikilink wikilink-unresolved opacity-50 underline decoration-dotted underline-offset-2"
                  data-testid="whiteboard-dangling-link"
                >
                  {text}
                </span>
              ) : (
                <span className="text-fg-muted">{embedded.state === 'loading' ? '' : title}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </NodeChrome>
  )
}
