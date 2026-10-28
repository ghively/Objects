import { Editor as TiptapEditor } from '@tiptap/core'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { bgColorToken, colorStyle, textColorToken } from '../menus/colors'

// The icon widget renders M2's `Icon` into its own React root, outside Testing Library.
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = false
})
afterAll(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = previousActEnv
})

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
})

function mounted(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function blockOf(editor: TiptapEditor, selector: string, text: string): HTMLElement {
  const el = Array.from(editor.view.dom.querySelectorAll<HTMLElement>(selector)).find((e) => e.textContent?.includes(text))
  if (!el) throw new Error(`no ${selector} with ${text}`)
  return el
}

const BODY = [
  '<!-- block: small -->',
  'Small text',
  '',
  '<!-- block: color=text-blue -->',
  'Blue text',
  '',
  '<!-- block: align=center -->',
  'Centered text',
  '',
  '<!-- block: align=right -->',
  '## Right heading',
  '',
  '<!-- block: icon="⭐" -->',
  'Starred text',
  '',
  '<!-- block: icon=ph-star -->',
  'Iconified text',
  '',
  '<!-- block: quote=standout -->',
  '> Big quote',
  '',
  '> Plain quote',
  '',
  '<!-- block: list=alphabetical -->',
  '1. alpha one',
  '2. alpha two',
  '',
  '<!-- block: list=roman -->',
  '1. roman one',
  '',
  'Between lists',
  '',
  '1. plain one',
  '',
].join('\n')

describe('block options render', () => {
  test('small, colour, align, icon, standout and list types render from options', () => {
    const editor = mounted(BODY)
    expect(blockOf(editor, 'p', 'Small text')).toHaveAttribute('data-block-small', '')
    expect(blockOf(editor, 'p', 'Blue text').getAttribute('style')).toContain(`color: ${textColorToken('blue')}`)
    expect(blockOf(editor, 'p', 'Centered text')).toHaveAttribute('data-block-align', 'center')
    expect(blockOf(editor, 'h2', 'Right heading')).toHaveAttribute('data-block-align', 'right')

    const starred = blockOf(editor, 'p', 'Starred text')
    const emoji = starred.querySelector('.block-icon')
    expect(emoji).not.toBeNull()
    expect(emoji!.textContent).toBe('⭐')
    expect(starred.firstChild).toBe(emoji) // before the block's text
    expect(emoji).toHaveAttribute('contenteditable', 'false')

    const iconified = blockOf(editor, 'p', 'Iconified text').querySelector('.block-icon')
    expect(iconified).toHaveAttribute('data-icon-value', 'ph-star')

    expect(blockOf(editor, 'blockquote', 'Big quote')).toHaveAttribute('data-block-quote', 'standout')
    expect(blockOf(editor, 'blockquote', 'Plain quote')).not.toHaveAttribute('data-block-quote')
    expect(blockOf(editor, 'ol', 'alpha one')).toHaveAttribute('data-block-list', 'alphabetical')
    expect(blockOf(editor, 'ol', 'roman one')).toHaveAttribute('data-block-list', 'roman')
    expect(blockOf(editor, 'ol', 'plain one')).not.toHaveAttribute('data-block-list')
    // Rendering never touches the bytes.
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('background colour uses label tokens', () => {
    const body = '<!-- block: color=bg-teal -->\nTeal box\n\n<!-- block: color=bg-red -->\n### Red heading\n'
    const editor = mounted(body)
    const p = blockOf(editor, 'p', 'Teal box')
    expect(p).toHaveAttribute('data-block-color', 'bg-teal')
    expect(p.getAttribute('style')).toContain(`background-color: ${bgColorToken('teal')}`)
    expect(p.getAttribute('style')).toContain('var(--label-bg-teal)')
    expect(p.getAttribute('style')).toContain('var(--tag-text-teal)')
    expect(blockOf(editor, 'h3', 'Red heading').getAttribute('style')).toContain('var(--label-bg-red)')
    expect(colorStyle('bg-nope')).toBe('')
    expect(colorStyle('text-sky')).toBe('color: var(--label-text-sky);')
  })

  test('an icon set by command appears and goes with the option', () => {
    const editor = mounted('Plain text\n')
    editor.commands.setTextSelection(3)
    editor.commands.setBlockOption('icon', '🙂')
    expect(blockOf(editor, 'p', 'Plain text').querySelector('.block-icon')!.textContent).toBe('🙂')
    expect(serializeBody(editor)).toBe('<!-- block: icon="🙂" -->\nPlain text\n')
    editor.commands.setBlockOption('icon', null)
    expect(editor.view.dom.querySelector('.block-icon')).toBeNull()
    expect(serializeBody(editor)).toBe('Plain text\n')
  })
})
