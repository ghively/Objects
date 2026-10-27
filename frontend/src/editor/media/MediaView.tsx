/**
 * Node views of the media blocks (image, PDF, audio, video, file) and of the
 * web link block (bookmark).
 *
 * - image: `<img>` from `api.fileUrl` (or the URL as written for `http(s)`);
 *   a failed load shows `RenderImage.loadingError`. Resizable, alignable, caption.
 * - PDF: an `<iframe>` of `api.fileUrl` at `height` (default 600 px, our
 *   value) with a bottom handle writing `height`; resizable, alignable, caption.
 * - audio: `<audio controls>`; caption.
 * - video: `<video controls>`; resizable width, alignable, caption.
 * - file: a card with a file icon by extension, the name, the size (from
 *   `api.attachments()`), "Open {type} on system" (`EntityMenu.openMediaOnSystem`)
 *   and "Download {mediaType}" (`EntityMenu.downloadMedia.text`); caption.
 * - a missing attachment shows "File not found." (our string).
 * Every block has a `…` menu with "Remove Block" (`EntityMenu.deleteEntityBlock.text`).
 *
 * The bookmark is a card with the link title, the domain and the URL, opened
 * in the system browser; nothing is fetched.
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Download, ExternalLink, Globe } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Attachment } from '@/api/types'
import { Icon } from '@/components/Icon'
import type { AttachmentKind, Option } from '../annotations'
import { EmbedMenu, ResizableEmbed, type EmbedMenuItem, type ResizableEmbedProps } from './ResizableEmbed'
import { cachedAttachments, decodeMarkdownPath, findAttachment, isExternalUrl, showToast } from './upload'

/** `RenderImage.loadingError`, verbatim. */
export const IMAGE_ERROR = 'This image could not be loaded. Please try again or delete the object.'
/** Our string. */
export const FILE_NOT_FOUND = 'File not found.'
/** Default PDF height in px (our value). */
export const PDF_DEFAULT_HEIGHT = 600

/** The word for a kind in "Open {type} on system" / "Download {mediaType}" (our wording). */
const KIND_WORD: Record<AttachmentKind, string> = {
  image: 'image',
  pdf: 'PDF',
  audio: 'audio',
  video: 'video',
  file: 'file',
}

/** A VS Code file icon by extension (bundled `vscode-icons`). */
export function fileIconFor(name: string): string {
  const ext = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    pdf: 'file-type-pdf2',
    xls: 'file-type-excel',
    xlsx: 'file-type-excel',
    xlsm: 'file-type-excel',
    csv: 'file-type-csv',
    doc: 'file-type-word',
    docx: 'file-type-word',
    ppt: 'file-type-powerpoint',
    pptx: 'file-type-powerpoint',
    zip: 'file-type-zip',
    '7z': 'file-type-zip',
    rar: 'file-type-zip',
    gz: 'file-type-zip',
    txt: 'file-type-text',
    json: 'file-type-json',
  }
  return `vscode-icons:${map[ext] ?? 'default-file'}`
}

/** "1.2 MB" style size (our format, 1024-based like the OS file managers on Windows). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function posOf(getPos: NodeViewProps['getPos']): number | undefined {
  return typeof getPos === 'function' ? getPos() : undefined
}

/** Shared node-view plumbing: write an option, remove the block. */
function useBlockActions({ editor, getPos, node }: Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>) {
  const setOption = (key: string, value: string | null) => {
    const pos = posOf(getPos)
    if (pos == null) return
    editor.commands.setBlockOption(key, value, pos)
  }
  const remove = () => {
    const pos = posOf(getPos)
    if (pos == null) return
    const current = editor.state.doc.nodeAt(pos)
    editor
      .chain()
      .deleteRange({ from: pos, to: pos + (current?.nodeSize ?? node.nodeSize) })
      .run()
  }
  return { setOption, remove }
}

/**
 * The attachment a wiki-form block names (`undefined` while the list loads,
 * `null` when it is not in the space).
 */
function useAttachment(target: string | null): Attachment | null | undefined {
  const [found, setFound] = useState<Attachment | null | undefined>(undefined)
  useEffect(() => {
    if (!target) {
      setFound(null)
      return
    }
    let alive = true
    setFound(undefined)
    void cachedAttachments().then((list) => {
      if (alive) setFound(findAttachment(list, target) ?? null)
    })
    return () => {
      alive = false
    }
  }, [target])
  return found
}

export function MediaView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as {
    form: 'md' | 'wiki'
    src: string | null
    alt: string | null
    target: string | null
    label: string | null
    kind: AttachmentKind
  }
  const options = node.attrs.blockOptions as Option[] | null
  const editable = editor.isEditable
  const { setOption, remove } = useBlockActions({ editor, getPos, node })
  const kind: AttachmentKind = attrs.kind ?? 'file'

  // The space path (or external URL) the block shows.
  const written = attrs.form === 'md' ? (attrs.src ?? '') : (attrs.target ?? '')
  const external = attrs.form === 'md' && isExternalUrl(written)
  const local = external ? null : attrs.form === 'md' ? decodeMarkdownPath(written) : written
  // Wiki-form targets may be Obsidian short names: look them up; md images are loaded as written.
  const lookup = useAttachment(attrs.form === 'wiki' || kind === 'file' ? local : null)
  const path = lookup ? lookup.path : local
  const url = external ? written : path ? api.fileUrl(path) : ''
  const missing = attrs.form === 'wiki' || kind === 'file' ? lookup === null : false
  const name = attrs.form === 'md' ? attrs.alt || baseName(local ?? written) : attrs.label || baseName(path ?? written)

  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])

  const menuItems: EmbedMenuItem[] = []
  if (kind === 'file' && path && !missing) {
    menuItems.push({ label: `Open ${KIND_WORD[kind]} on system`, onSelect: () => void openOnSystem(path) })
  }
  menuItems.push({ label: 'Remove Block', onSelect: remove })
  const menu = <EmbedMenu items={menuItems} />

  const frame = (body: ReactNode | ((s: { height?: number }) => ReactNode), opts: Partial<ResizableEmbedProps>) => (
    <ResizableEmbed options={options} editable={editable} setOption={setOption} menu={menu} {...opts}>
      {body}
    </ResizableEmbed>
  )

  let content: ReactNode
  if (missing) {
    content = frame(
      <div className="media-missing" data-testid="media-missing">
        <span className="media-missing-name">{baseName(written)}</span>
        <span>{FILE_NOT_FOUND}</span>
      </div>,
      { captionable: true },
    )
  } else if (kind === 'image') {
    content = frame(
      failed ? (
        <div className="media-error" data-testid="media-image-error">
          {IMAGE_ERROR}
        </div>
      ) : (
        <img className="media-image" src={url} alt={attrs.alt ?? attrs.label ?? ''} draggable={false} onError={() => setFailed(true)} />
      ),
      { resizeWidth: true, alignable: true, captionable: true },
    )
  } else if (kind === 'pdf') {
    content = frame(
      ({ height }) => (
        <iframe className="media-pdf" src={url} title={name} style={{ height: `${height ?? PDF_DEFAULT_HEIGHT}px` }} />
      ),
      { resizeWidth: true, alignable: true, captionable: true, resizeHeight: PDF_DEFAULT_HEIGHT },
    )
  } else if (kind === 'audio') {
    content = frame(<audio className="media-audio" controls preload="metadata" src={url} aria-label={name} />, {
      captionable: true,
    })
  } else if (kind === 'video') {
    content = frame(<video className="media-video" controls preload="metadata" src={url} aria-label={name} />, {
      resizeWidth: true,
      alignable: true,
      captionable: true,
    })
  } else {
    content = frame(
      <div className="media-file" data-testid="media-file">
        <Icon name={fileIconFor(path ?? written)} size={28} />
        <div className="media-file-text">
          <div className="media-file-name">{name}</div>
          {lookup && <div className="media-file-size">{formatSize(lookup.size)}</div>}
        </div>
        {path && lookup && (
          <div className="media-file-actions" contentEditable={false}>
            <button
              type="button"
              className="media-file-btn"
              title={`Open ${KIND_WORD[kind]} on system`}
              aria-label={`Open ${KIND_WORD[kind]} on system`}
              onClick={() => void openOnSystem(path)}
            >
              <ExternalLink size={14} />
            </button>
            <a
              className="media-file-btn"
              href={url}
              download={baseName(path)}
              title={`Download ${KIND_WORD[kind]}`}
              aria-label={`Download ${KIND_WORD[kind]}`}
            >
              <Download size={14} />
            </a>
          </div>
        )}
      </div>,
      { captionable: true },
    )
  }

  return (
    <NodeViewWrapper
      className={`media-block${selected ? ' is-selected' : ''}`}
      data-media=""
      data-kind={kind}
      data-testid="media-block"
    >
      {content}
    </NodeViewWrapper>
  )
}

async function openOnSystem(path: string): Promise<void> {
  try {
    await api.openAttachment(path)
  } catch (err) {
    showToast(err instanceof Error && err.message ? err.message : 'The file could not be opened.')
  }
}

/** The host name of a URL, without `www.` (empty for something that is not a URL). */
export function domainOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function BookmarkView({ node, editor, getPos, selected }: NodeViewProps) {
  const href = String(node.attrs.href ?? '')
  const title = String(node.attrs.title ?? '') || href
  const domain = domainOf(href)
  const { remove } = useBlockActions({ editor, getPos, node })
  const safe = /^(https?:|mailto:)/i.test(href)
  return (
    <NodeViewWrapper
      className={`bookmark-block${selected ? ' is-selected' : ''}`}
      data-bookmark=""
      data-testid="bookmark-block"
    >
      <div className="bookmark-frame">
        <a
          className="bookmark-card"
          href={safe ? href : undefined}
          target="_blank"
          rel="noopener noreferrer"
          draggable={false}
        >
          <Globe size={18} className="bookmark-icon" aria-hidden />
          <span className="bookmark-text">
            <span className="bookmark-title">{title}</span>
            {domain && <span className="bookmark-domain">{domain}</span>}
            <span className="bookmark-url">{href}</span>
          </span>
        </a>
        {editor.isEditable && (
          <div className="resizable-embed-toolbar" contentEditable={false}>
            <EmbedMenu items={[{ label: 'Remove Block', onSelect: remove }]} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}
