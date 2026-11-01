import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

async function mount(body: string): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  render(<EditorContent editor={editor} />)
  await act(async () => {
    loadBody(editor, body)
  })
  return editor
}

describe('MathBlockView', () => {
  test('renders the formula with KaTeX in display mode (once KaTeX has loaded)', async () => {
    await mount('Intro\n\n$$\nE = mc^2\n$$\n')
    const render = await screen.findByTestId('math-block-render')
    await waitFor(() => expect(render.querySelector('.katex-display')).not.toBeNull())
    expect(render.querySelector('.math-pending')).toBeNull()
  })

  test('math block editor opens, previews and closes', async () => {
    const body = 'Intro\n\n$$\nx^2\n$$\n\nOutro\n'
    const editor = await mount(body)
    fireEvent.click(await screen.findByTestId('math-block-render'))
    const area = await screen.findByRole('textbox', { name: 'Math' })
    expect(area).toHaveValue('x^2')
    expect(screen.getByText('to insert above/below')).toBeInTheDocument()
    expect(screen.getByText('↵')).toBeInTheDocument()

    // Live preview: the rendered formula follows the draft.
    fireEvent.change(area, { target: { value: '\\frac{a}{b}' } })
    await waitFor(() => expect(screen.getByTestId('math-block-render').querySelector('.mfrac')).not.toBeNull())
    expect(serializeBody(editor)).toBe('Intro\n\n$$\n\\frac{a}{b}\n$$\n\nOutro\n')

    // Invalid TeX never throws; KaTeX colours the error.
    fireEvent.change(area, { target: { value: '\\frac{' } })
    await waitFor(() => expect(screen.getByTestId('math-block-render').innerHTML).toMatch(/katex-error|color/))

    fireEvent.change(area, { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Math' })).toBeNull())
    expect(serializeBody(editor)).toBe('Intro\n\n$$\ny\n$$\n\nOutro\n')
  })

  test('an untouched math block keeps its bytes when opened and closed', async () => {
    const body = 'Intro\n\n$$  \n  a + b\n$$\n'
    const editor = await mount(body)
    fireEvent.click(await screen.findByTestId('math-block-render'))
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(serializeBody(editor)).toBe(body)
  })

  test('Enter inserts a paragraph below and closes; at the start it inserts above', async () => {
    const editor = await mount('$$\nz\n$$\n')
    fireEvent.click(await screen.findByTestId('math-block-render'))
    let area = (await screen.findByRole('textbox', { name: 'Math' })) as HTMLTextAreaElement
    area.setSelectionRange(1, 1)
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Math' })).toBeNull())
    expect(editor.state.doc.child(0).type.name).toBe('mathBlock')
    expect(editor.state.doc.child(1).type.name).toBe('paragraph')

    fireEvent.click(screen.getByTestId('math-block-render'))
    area = (await screen.findByRole('textbox', { name: 'Math' })) as HTMLTextAreaElement
    area.setSelectionRange(0, 0)
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Math' })).toBeNull())
    expect(editor.state.doc.child(0).type.name).toBe('paragraph')
    expect(editor.state.doc.child(1).type.name).toBe('mathBlock')
  })

  test('does not open in a read-only editor', async () => {
    const editor = await mount('$$\nq\n$$\n')
    editor.setEditable(false)
    fireEvent.click(await screen.findByTestId('math-block-render'))
    expect(screen.queryByRole('textbox', { name: 'Math' })).toBeNull()
  })
})

describe('InlineMathView', () => {
  test('renders inline KaTeX', async () => {
    await mount('Energy $E=mc^2$ here.\n')
    const el = await screen.findByTestId('inline-math-render')
    expect(el.querySelector('.katex')).not.toBeNull()
    expect(el.querySelector('.katex-display')).toBeNull()
  })

  test('inline math edits and removes when emptied', async () => {
    const editor = await mount('Energy $E=mc^2$ here.\n')
    fireEvent.click(await screen.findByTestId('inline-math-render'))
    let input = await screen.findByRole('textbox', { name: 'Math' })
    expect(input).toHaveValue('E=mc^2')
    fireEvent.change(input, { target: { value: 'a+b' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Math' })).toBeNull())
    expect(serializeBody(editor)).toBe('Energy $a+b$ here.\n')

    fireEvent.click(screen.getByTestId('inline-math-render'))
    input = await screen.findByRole('textbox', { name: 'Math' })
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.queryByTestId('inline-math-render')).toBeNull())
    expect(serializeBody(editor)).toBe('Energy  here.\n')
  })

  test('a new empty formula opens its input straight away', async () => {
    const editor = await mount('Text\n')
    await act(async () => {
      editor.chain().setTextSelection(5).insertInlineMath('').run()
    })
    const input = await screen.findByRole('textbox', { name: 'Math' })
    fireEvent.change(input, { target: { value: '\\pi' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Math' })).toBeNull())
    expect(serializeBody(editor)).toBe('Text$\\pi$\n')
  })
  test('a blank line inside the block renders two display rows and keeps the source bytes', async () => {
    const body = 'Intro\n\n$$\nE = mc^2\n\na^2+b^2=c^2\n$$\n'
    const editor = await mount(body)
    const el = await screen.findByTestId('math-block-render')
    expect(el.querySelectorAll('.katex-display')).toHaveLength(2)
    expect(el.textContent).toContain('E')
    expect(serializeBody(editor)).toBe(body)
  })
})
