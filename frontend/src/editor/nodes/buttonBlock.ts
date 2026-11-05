/**
 * `buttonBlock` (M14): a button that runs an automation on the object whose body holds it. It
 * is an annotated one-line paragraph, the button's label (our option names):
 *
 *   <!-- block: button rule="01JC7ZK3T9Q4M2X8B5N6R1V0WE" -->
 *   Start weekly review
 *
 * Loaded only with the `button` flag on a paragraph whose source is one line (`blockTree`
 * offers the `button` target for it). `rule` is the automation's id (empty or missing: none
 * chosen yet). Without the app the comment is hidden and the label reads as a plain paragraph.
 *
 * The label is kept as its source text (`label`), so an unedited block re-emits its line as
 * read; editing the label rewrites only the label line, choosing another rule only the
 * annotation line (M7 rule 2). The editor draws it with `ButtonBlockView`.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { makeOption, type Option } from '../annotations'
import { ButtonBlockView } from './ButtonBlockView'
import { insertBlockNode } from './containers'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    buttonBlock: {
      /** Insert a button block below the current block, running automation `ruleId` (null: none yet). */
      insertButtonBlock: (ruleId: string | null, label?: string) => ReturnType
    }
  }
}

export const BUTTON_BLOCK_TEXT = {
  /** The label a new button gets (our string). */
  defaultLabel: 'Run automation',
} as const

/** The label line a button block writes: its source text, as kept. */
export function buttonBlockMarkdown(label: string): string {
  return label
}

/** The label's source text: a block's one line without its line end. */
export function buttonLabelOf(raw: string): string {
  return raw.replace(/(?:\r\n|\n|\r)$/, '')
}

/** The label as shown: its source with a leading backslash escape and outer blanks taken off. */
export function buttonLabelText(label: string): string {
  return label.trim().replace(/^\\(?=[^\sA-Za-z0-9])/, '')
}

/**
 * The source text for a label typed in the app: one line (line breaks become spaces), trimmed,
 * with a backslash before a first character that would start another block on reload (a heading,
 * a list item, a quote, a fence, a comment, an embed, a math block, a table row...), so the
 * paragraph stays one paragraph. `null` for an empty label (a button keeps its label).
 */
export function buttonLabelSource(text: string): string | null {
  const one = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (one === '') return null
  if (/^(?:[#>*+\-=`~<|$!\\]|\d{1,9}[.)](?:\s|$))/.test(one)) return `\\${one}`
  // A `Key:: value` field line is kept raw on load.
  if (/^[^\s:][^:]*::(?:\s|$)/.test(one)) return one.replace('::', '\\::')
  return one
}

/** The automation id of a button block's options (null: none chosen yet). */
export function buttonRuleOf(options: readonly Option[] | null | undefined): string | null {
  const v = (options ?? []).find((o) => o.key === 'rule')?.value
  return typeof v === 'string' && v !== '' ? v : null
}

/** The options a new button block carries: `button`, and `rule` once one is chosen. */
export function buttonBlockOptions(ruleId: string | null): Option[] {
  return ruleId ? [makeOption('button', true), makeOption('rule', ruleId)] : [makeOption('button', true)]
}

export const ButtonBlock = Node.create({
  name: 'buttonBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      label: {
        default: BUTTON_BLOCK_TEXT.defaultLabel,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? el.textContent ?? '',
        renderHTML: (attrs: { label: string }) => ({ 'data-label': attrs.label }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-button-block]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-button-block': '', class: 'button-block' }),
      buttonLabelText(String(node.attrs.label ?? '')),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ButtonBlockView)
  },

  renderText({ node }) {
    return buttonLabelText(String(node.attrs.label ?? ''))
  },

  renderMarkdown(node: { attrs?: { label?: string } }) {
    return buttonBlockMarkdown(node.attrs?.label ?? '')
  },

  addCommands() {
    return {
      insertButtonBlock:
        (ruleId, label) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          const node = state.schema.nodes.buttonBlock.create({
            label: buttonLabelSource(label ?? '') ?? BUTTON_BLOCK_TEXT.defaultLabel,
            blockOptions: buttonBlockOptions(ruleId),
          })
          insertBlockNode(tr, node)
          return true
        },
    }
  },
})
