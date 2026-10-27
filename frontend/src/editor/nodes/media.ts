/**
 * `media`: an image, PDF, audio, video or file block (rule 7). Two forms:
 *
 *   ![rack](Attachments/rack.png)          form 'md'   (src, alt): an image
 *   ![[Attachments/Quarterly report.pdf]]  form 'wiki' (target, label): any kind
 *
 * `kind` comes from the extension (Task 2's kinds). View settings (width,
 * height, align, caption) are block options. Rendering is minimal here; Task 11
 * adds the media views.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { attachmentKind, type AttachmentKind } from '../annotations'
import { insertBlockNode } from './containers'
import './media.css'

export type MediaAttrs = {
  form: 'md' | 'wiki'
  src?: string | null
  alt?: string | null
  target?: string | null
  label?: string | null
  kind?: AttachmentKind
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    media: {
      /** Insert a media block below the current block. */
      insertMedia: (attrs: MediaAttrs) => ReturnType
      /** Pick a file of `kind`, upload it and insert it (Task 11; `false` until then). */
      pickMedia: (kind: AttachmentKind) => ReturnType
    }
  }
}

export function mediaMarkdown(attrs: Partial<MediaAttrs>): string {
  if (attrs.form === 'md') return `![${attrs.alt ?? ''}](${attrs.src ?? ''})`
  return attrs.label ? `![[${attrs.target ?? ''}|${attrs.label}]]` : `![[${attrs.target ?? ''}]]`
}

/** The attributes for `attrs`, with `kind` filled in from the extension. */
export function mediaAttrs(attrs: MediaAttrs): Required<MediaAttrs> {
  const kind = attrs.kind ?? (attrs.form === 'md' ? 'image' : attachmentKind(attrs.target ?? ''))
  return {
    form: attrs.form,
    src: attrs.src ?? null,
    alt: attrs.alt ?? null,
    target: attrs.target ?? null,
    label: attrs.label ?? null,
    kind,
  }
}

const plain = (name: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
  renderHTML: (attrs: Record<string, unknown>) => (attrs[name] == null ? {} : { [`data-${name}`]: String(attrs[name]) }),
})

export const Media = Node.create({
  name: 'media',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      form: { ...plain('form'), default: 'wiki' },
      src: plain('src'),
      alt: plain('alt'),
      target: plain('target'),
      label: plain('label'),
      kind: { ...plain('kind'), default: 'file' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-media]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = node.attrs.form === 'md' ? node.attrs.alt || node.attrs.src : node.attrs.label || node.attrs.target
    return ['div', mergeAttributes(HTMLAttributes, { 'data-media': '', class: 'media-block' }), name || '']
  },

  renderText({ node }) {
    return mediaMarkdown(node.attrs as MediaAttrs)
  },

  renderMarkdown(node: { attrs?: Partial<MediaAttrs> }) {
    return mediaMarkdown(node.attrs ?? {})
  },

  addCommands() {
    return {
      insertMedia:
        (attrs) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          insertBlockNode(tr, state.schema.nodes.media.create(mediaAttrs(attrs)))
          return true
        },
      pickMedia: () => () => false,
    }
  },
})
