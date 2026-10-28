/**
 * A web-link node (M8): a block node whose block is `{type: 'weblink', url, title?}`. A card with a
 * globe icon, the title (else the URL), the host without `www.` and the URL, as M7's bookmark block.
 * Nothing is fetched: no favicon, no preview image, no page title, no iframe; the card shows only
 * what the user typed. Double-click opens the URL in the system browser (a user-started
 * navigation, not a fetch by the app).
 */
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { WhiteboardWeblinkBlock } from '@/api/whiteboardTypes'
import { Icon } from '@/components/Icon'
import type { WhiteboardNodeProps } from '../canvasTypes'
import { borderStyle, fillStyle } from '../colors'
import { normalizeWeblinkUrl, weblinkHost } from '../model'
import { NodeChrome } from './NodeChrome'

/** Opens `url` in a new browser window when it is a valid web link (only http/https). */
export function openWeblink(url: string): void {
  const safe = normalizeWeblinkUrl(url)
  if (!safe || safe !== url.trim()) return
  window.open(safe, '_blank', 'noopener,noreferrer')
}

export function WeblinkNode({ data, selected }: WhiteboardNodeProps) {
  const node = data.node
  const block = data.block as WhiteboardWeblinkBlock
  const url = block.url
  const title = block.title?.trim() || url
  const host = weblinkHost(url)

  const onDoubleClick = (e: ReactMouseEvent) => {
    e.stopPropagation()
    openWeblink(url)
  }

  return (
    <NodeChrome node={node} selected={!!selected}>
      <div
        className="whiteboard-node-frame relative box-border flex h-full w-full items-center gap-3 overflow-hidden px-4"
        style={{
          background: 'var(--color-bg-base)',
          ...fillStyle(node.fillColor),
          ...borderStyle(node.borderColor),
        }}
        data-testid="whiteboard-weblink-node"
        data-url={url}
        onDoubleClick={onDoubleClick}
      >
        <Icon name="ph-globe" size={20} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[15px] font-medium text-fg" data-testid="whiteboard-weblink-title">
            {title}
          </span>
          {host && (
            <span className="truncate text-[13px] text-fg-muted" data-testid="whiteboard-weblink-host">
              {host}
            </span>
          )}
          {block.title?.trim() && <span className="truncate text-[12px] text-fg-muted">{url}</span>}
        </span>
      </div>
    </NodeChrome>
  )
}
