/**
 * `toggle`: a container whose first child is the toggle's own line and the
 * rest its children. In the file:
 *
 *   <!-- toggle open -->
 *   ### Server checklist
 *   - [ ] Patch the hosts
 *   <!-- /toggle -->
 *
 * `open` is a container option (`toggle.isOpen`; absent = closed).
 *
 * The node view draws a caret before the toggle's first child (rotated when
 * open; `--editor-toggle`, or `--editor-toggle-empty` when the toggle has no
 * children) and the outliner line along the children (`--editor-toggle-outline`)
 * unless the `hideOutlinerLines` setting is on. With `toggleStyle: 'bullet'` the
 * caret shows as a bullet that turns into the caret on hover. Clicking the caret
 * runs `setToggleOpen`, so the file's open line changes (rule 2). A closed
 * toggle's children are hidden by node decorations.
 */
import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type NodeView } from '@tiptap/pm/view'
import { useSettings } from '@/settings/useSettings'
import type { Option } from '../annotations'
import { ancestorOfType, containerSourceAttributes, flag, unwrapAt, wrapBlocks } from './containers'
import { renderOptions, setOptionAt } from './blockOptions'
import './toggle.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      /** Wrap the selected blocks in a toggle (open, so its children stay visible). */
      wrapInToggle: () => ReturnType
      /** Replace the toggle around the selection by its blocks. */
      unwrapToggle: () => ReturnType
      /** Open or close the toggle at `pos` (writes or removes its `open` option). */
      setToggleOpen: (pos: number, open: boolean) => ReturnType
    }
  }
}

export function isToggleOpen(options: Option[] | null | undefined): boolean {
  return (options ?? []).some((o) => o.key === 'open' && o.value === true)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** A right-pointing caret (rotated by CSS when open). */
function caretIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'toggle-caret-icon')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M6 3.5 10.5 8 6 12.5')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.75')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  return svg
}

function applyAttributes(el: HTMLElement, attrs: Record<string, unknown>) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) el.removeAttribute(key)
    else el.setAttribute(key, String(value))
  }
}

/** The plain-DOM node view: caret, outliner line and the children (`contentDOM`). */
class ToggleView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private caret: HTMLButtonElement
  private outline: HTMLElement
  private node: PMNode
  private unsubscribe: () => void
  private editor: Editor
  private getPos: () => number | undefined
  private htmlAttributes: Record<string, unknown>

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined, htmlAttributes: Record<string, unknown>) {
    this.node = node
    this.editor = editor
    this.getPos = getPos
    this.htmlAttributes = htmlAttributes
    this.dom = document.createElement('div')
    this.caret = document.createElement('button')
    this.caret.type = 'button'
    this.caret.className = 'toggle-caret'
    this.caret.setAttribute('contenteditable', 'false')
    this.caret.tabIndex = -1
    const bullet = document.createElement('span')
    bullet.className = 'toggle-bullet'
    bullet.setAttribute('aria-hidden', 'true')
    this.caret.append(bullet, caretIcon())
    this.caret.addEventListener('mousedown', (e) => e.preventDefault())
    this.caret.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.toggle()
    })
    this.outline = document.createElement('div')
    this.outline.className = 'toggle-outline'
    this.outline.setAttribute('contenteditable', 'false')
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'toggle-content'
    this.dom.append(this.caret, this.outline, this.contentDOM)
    this.render()
    this.unsubscribe = useSettings.subscribe((s, prev) => {
      if (s.settings.toggleStyle !== prev.settings.toggleStyle || s.settings.hideOutlinerLines !== prev.settings.hideOutlinerLines) {
        this.renderSettings()
      }
    })
  }

  private get open(): boolean {
    return isToggleOpen(this.node.attrs.blockOptions as Option[] | null)
  }

  private toggle() {
    const pos = this.getPos()
    if (pos == null || !this.editor.isEditable) return
    const open = !this.open
    this.editor
      .chain()
      .setToggleOpen(pos, open)
      .command(({ tr }) => {
        if (open) return true
        // Closing with the cursor in a hidden child: move it to the end of the toggle's line.
        const node = tr.doc.nodeAt(pos)
        if (!node || node.childCount < 2) return true
        const firstEnd = pos + 1 + node.child(0).nodeSize
        const { from } = tr.selection
        if (from > firstEnd && from < pos + node.nodeSize) {
          tr.setSelection(TextSelection.near(tr.doc.resolve(firstEnd - 1), -1))
        }
        return true
      })
      .run()
  }

  private renderSettings() {
    const { toggleStyle, hideOutlinerLines } = useSettings.getState().settings
    this.dom.setAttribute('data-toggle-style', toggleStyle)
    this.dom.setAttribute('data-outline', hideOutlinerLines ? 'false' : 'true')
    this.outline.hidden = hideOutlinerLines || !this.open || this.node.childCount < 2
  }

  private render() {
    const open = this.open
    const empty = this.node.childCount < 2
    for (const attr of Array.from(this.dom.attributes)) {
      if (attr.name.startsWith('data-block-')) this.dom.removeAttribute(attr.name)
    }
    applyAttributes(
      this.dom,
      mergeAttributes(
        // The creation-time attributes, minus the option ones (re-rendered from the node).
        Object.fromEntries(Object.entries(this.htmlAttributes).filter(([k]) => !k.startsWith('data-block-') && k !== 'style')),
        renderOptions(this.node.attrs.blockOptions as Option[] | null),
        { class: 'block-toggle' },
      ),
    )
    this.dom.setAttribute('data-toggle', '')
    this.dom.setAttribute('data-open', open ? 'true' : 'false')
    this.dom.toggleAttribute('data-empty', empty)
    this.caret.setAttribute('aria-expanded', open ? 'true' : 'false')
    this.caret.setAttribute('aria-label', open ? 'Collapse' : 'Expand') // our strings
    this.caret.style.color = empty ? 'var(--editor-toggle-empty)' : 'var(--editor-toggle)'
    this.renderSettings()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  stopEvent(event: Event): boolean {
    return this.caret.contains(event.target as globalThis.Node)
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }): boolean {
    if (mutation.type === 'selection') return false
    return !this.contentDOM.contains(mutation.target)
  }

  destroy() {
    this.unsubscribe()
  }
}

const toggleHideKey = new PluginKey<DecorationSet>('toggleHide')

/** Hide every child but the first of each closed toggle. */
function hiddenChildren(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'toggle' && !isToggleOpen(node.attrs.blockOptions as Option[] | null)) {
      let at = pos + 1
      node.forEach((child, _offset, index) => {
        if (index > 0) {
          decos.push(Decoration.node(at, at + child.nodeSize, { style: 'display: none', 'data-toggle-hidden': '' }))
        }
        at += child.nodeSize
      })
    }
    return node.isBlock && !node.isTextblock
  })
  return DecorationSet.create(doc, decos)
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return containerSourceAttributes()
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const open = isToggleOpen(node.attrs.blockOptions as Option[] | null)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '', 'data-open': open ? 'true' : 'false', class: 'block-toggle' }), 0]
  },

  addNodeView() {
    return ({ node, editor, getPos, HTMLAttributes }) =>
      new ToggleView(node, editor, getPos as () => number | undefined, HTMLAttributes)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: toggleHideKey,
        state: {
          init: (_, state) => hiddenChildren(state.doc),
          apply: (tr, old) => (tr.docChanged ? hiddenChildren(tr.doc) : old),
        },
        props: {
          decorations: (state) => toggleHideKey.getState(state),
        },
      }),
    ]
  },

  renderMarkdown(node: { content?: unknown[] }, h: { renderChildren: (c: unknown[], sep: string) => string }) {
    return node.content ? h.renderChildren(node.content, '\n\n') : ''
  },

  addCommands() {
    return {
      wrapInToggle:
        () =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          return wrapBlocks(tr, state.schema.nodes.toggle, [flag('open')])
        },
      unwrapToggle:
        () =>
        ({ tr, dispatch }) => {
          const found = ancestorOfType(tr, 'toggle')
          if (!found) return false
          if (!dispatch) return true
          return unwrapAt(tr, found.pos)
        },
      setToggleOpen:
        (pos, open) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node || node.type.name !== 'toggle') return false
          if (dispatch) setOptionAt(tr, pos, 'open', open ? true : null)
          return true
        },
    }
  },
})
