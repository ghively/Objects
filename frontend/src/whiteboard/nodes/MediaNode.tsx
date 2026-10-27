/**
 * A media node (M8): a block node whose block is `{type: 'media', path}`, an uploaded file in the
 * space. Rendered as a media primitive filling its frame (Object's `data-whiteboard-media-
 * primitive`: no ring, the image `object-fit: cover`, the node radius): an image or video, a PDF
 * (M7's same-origin `<iframe>` of `api.fileUrl`), an audio player, or a file row with M7's icon by
 * extension. Images and videos keep their aspect while resizing. Double-click opens the file with
 * the OS (`/api/attachments/open`; our choice of the two the plan allows: the peek shows objects,
 * not attachments). Only same-origin URLs are used; nothing leaves the machine.
 */
import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { WhiteboardMediaBlock } from '@/api/whiteboardTypes'
import { Icon } from '@/components/Icon'
import { FILE_NOT_FOUND, IMAGE_ERROR, fileIconFor } from '@/editor/media/MediaView'
import { showToast } from '@/editor/media/upload'
import type { WhiteboardNodeProps } from '../canvasTypes'
import { borderStyle } from '../colors'
import { mediaHost, useWhiteboardHost } from '../host'
import { keepsAspect, mediaKindOf } from '../model'
import { NodeChrome } from './NodeChrome'

/** "Open {type} on system" (`EntityMenu.openMediaOnSystem`), with M7's words for the kinds. */
const KIND_WORD = { image: 'image', pdf: 'PDF', audio: 'audio', video: 'video', file: 'file' } as const

export function mediaOpenLabel(path: string): string {
  return `Open ${KIND_WORD[mediaKindOf(path)]} on system`
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

export function MediaNode({ data, selected }: WhiteboardNodeProps) {
  const node = data.node
  const block = data.block as WhiteboardMediaBlock
  const host = mediaHost(useWhiteboardHost())
  const path = block.path
  const kind = mediaKindOf(path)
  const url = host.fileUrl(path)
  const name = baseName(path)
  // A failed load is remembered for its URL only, so a new path tries again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = failedUrl === url
  const setFailed = () => setFailedUrl(url)

  const open = () => {
    void host.openAttachment(path).catch((err: unknown) => {
      showToast(err instanceof Error && err.message ? err.message : 'The file could not be opened.')
    })
  }
  const onDoubleClick = (e: ReactMouseEvent) => {
    e.stopPropagation()
    open()
  }

  let body
  if (failed) {
    body = (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center text-[13px] text-fg-muted" data-testid="whiteboard-media-error">
        <span className="truncate font-medium text-fg">{name}</span>
        <span>{kind === 'image' ? IMAGE_ERROR : FILE_NOT_FOUND}</span>
      </div>
    )
  } else if (kind === 'image') {
    body = (
      <img
        src={url}
        alt={name}
        draggable={false}
        className="block h-full min-h-0 w-full"
        style={{ objectFit: 'cover' }}
        onError={setFailed}
      />
    )
  } else if (kind === 'video') {
    body = (
      <video
        src={url}
        controls
        preload="metadata"
        aria-label={name}
        className="nodrag block h-full w-full bg-black"
        style={{ objectFit: 'contain' }}
        onError={setFailed}
      />
    )
  } else if (kind === 'pdf') {
    // The iframe takes no pointer input on the canvas, so the node drags and selects like any other
    // (our choice); double-click opens the PDF in the OS viewer.
    body = <iframe src={url} title={name} className="block h-full w-full border-0 bg-white" style={{ pointerEvents: 'none' }} />
  } else if (kind === 'audio') {
    body = (
      <div className="flex h-full w-full items-center gap-2 px-3">
        <audio src={url} controls preload="metadata" aria-label={name} className="nodrag min-w-0 flex-1" onError={setFailed} />
      </div>
    )
  } else {
    body = (
      <div className="flex h-full w-full items-center gap-3 px-3" data-testid="whiteboard-media-file">
        <Icon name={fileIconFor(path)} size={28} />
        <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{name}</span>
        <button
          type="button"
          className="nodrag rounded-md p-1 text-fg-muted hover:bg-hover"
          title={mediaOpenLabel(path)}
          aria-label={mediaOpenLabel(path)}
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
        >
          <Icon name="ph-arrow-square-out" size={16} />
        </button>
      </div>
    )
  }

  return (
    <NodeChrome node={node} selected={!!selected} keepAspectRatio={keepsAspect(kind)}>
      <div
        className="whiteboard-node-frame relative box-border h-full w-full overflow-hidden"
        style={{
          background: 'var(--color-bg-base)',
          borderRadius: 'var(--whiteboard-node-radius, 0.75rem)',
          ...borderStyle(node.borderColor),
        }}
        data-testid="whiteboard-media-node"
        data-kind={kind}
        data-path={path}
        data-whiteboard-media-primitive={node.headless === false ? undefined : 'true'}
        data-whiteboard-embed-only="true"
        onDoubleClick={onDoubleClick}
      >
        {body}
      </div>
    </NodeChrome>
  )
}
