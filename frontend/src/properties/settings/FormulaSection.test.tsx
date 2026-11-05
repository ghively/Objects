import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PropertyDef, TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { PropertySettings } from '../PropertySettings'
import { FORMULA_TEXT } from './texts'

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const PRICE = propertyDef({ id: 'p-price', key: 'price', name: 'Price', type: 'number' })
const QTY = propertyDef({ id: 'p-qty', key: 'qty', name: 'Quantity', type: 'number' })
const TOTAL = propertyDef({
  id: 'p-total',
  key: 'total',
  name: 'Total',
  type: 'formula',
  options: { expression: 'prop("Price") * 2' },
})
const ORDER = typeDef({ id: 'order', name: 'Order', revision: 'r1', propertyDefinitions: [TITLE, PRICE, QTY, TOTAL] })

function savedDef(call = 0): PropertyDef | undefined {
  const t: TypeDef = vi.mocked(api.saveType).mock.calls[call][0]
  return t.propertyDefinitions.find((d) => d.id === 'p-total')
}

function open(objectPath?: string) {
  return render(
    <PropertySettings typeId="order" propertyId="p-total" open onOpenChange={vi.fn()} objectPath={objectPath} />,
  )
}

const editor = () => screen.getByRole('textbox', { name: FORMULA_TEXT.editorLabel }) as HTMLTextAreaElement

beforeEach(() => {
  vi.mocked(api.saveType).mockClear()
  vi.mocked(api.formulaPreview).mockReset()
  resetLinkIndex()
  useLinkIndex.setState({ types: [ORDER], objects: [], loaded: true })
})

describe('FormulaSection', () => {
  test('shows the expression with highlighted tokens', () => {
    open()
    expect(editor().value).toBe('prop("Price") * 2')
    const pre = document.querySelector('[data-formula-highlight]') as HTMLElement
    expect(pre.querySelector('[data-token="prop"]')?.textContent).toBe('prop')
    expect(pre.querySelector('[data-token="string"]')?.textContent).toBe('"Price"')
    expect(pre.querySelector('[data-token="operator"]')?.textContent).toBe('*')
    expect(pre.querySelector('[data-token="number"]')?.textContent).toBe('2')
  })

  test('typing does not save; leaving the editor saves the expression once', async () => {
    const user = userEvent.setup()
    open()
    await user.clear(editor())
    await user.type(editor(), 'prop("Price") + 1')
    expect(api.saveType).not.toHaveBeenCalled()
    await user.tab()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.options.expression).toBe('prop("Price") + 1')
    expect(vi.mocked(api.saveType).mock.calls[0][1]).toEqual({ baseRevision: 'r1' })
  })

  test('Ctrl+Enter saves', async () => {
    const user = userEvent.setup()
    open()
    await user.type(editor(), ' + 3')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.options.expression).toBe('prop("Price") * 2 + 3')
  })

  test('the Save button appears for an unsaved edit and saves it', async () => {
    const user = userEvent.setup()
    open()
    expect(screen.queryByRole('button', { name: FORMULA_TEXT.save })).toBeNull()
    await user.type(editor(), '0')
    await user.click(screen.getByRole('button', { name: FORMULA_TEXT.save }))
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.options.expression).toBe('prop("Price") * 20')
  })

  test('closing the dialog keeps an unsaved edit', async () => {
    const user = userEvent.setup()
    const view = open()
    await user.type(editor(), '0')
    view.unmount()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.options.expression).toBe('prop("Price") * 20')
  })

  test('deleting the property does not save it back when the dialog closes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const view = render(<PropertySettings typeId="order" propertyId="p-total" open onOpenChange={onOpenChange} />)
    await user.type(editor(), '0')
    // A formula is deleted without typing a confirmation (it holds no values in the files).
    expect(screen.queryByRole('textbox', { name: 'Type "delete" to confirm' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete property' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    view.unmount()
    const calls = vi.mocked(api.saveType).mock.calls
    expect(calls.at(-1)![0].propertyDefinitions.some((d) => d.id === 'p-total')).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(vi.mocked(api.saveType).mock.calls.at(-1)![0].propertyDefinitions.some((d) => d.id === 'p-total')).toBe(false)
  })

  test('previews against the open object with the unsaved definitions', async () => {
    vi.mocked(api.formulaPreview).mockResolvedValue({ value: { type: 'number', value: 1234.5 }, error: null })
    open('Orders/A.md')
    await waitFor(() => expect(screen.getByText('1234.5')).toBeInTheDocument())
    const req = vi.mocked(api.formulaPreview).mock.calls.at(-1)![0]
    expect(req.typeId).toBe('order')
    expect(req.path).toBe('Orders/A.md')
    expect(req.expression).toBe('prop("Price") * 2')
    expect(req.properties?.find((d) => d.id === 'p-total')?.options.expression).toBe('prop("Price") * 2')
  })

  test('the preview is debounced and follows the draft', async () => {
    const user = userEvent.setup()
    vi.mocked(api.formulaPreview).mockImplementation(async (r) => ({
      value: { type: 'text', value: `= ${r.expression}` },
      error: null,
    }))
    open('Orders/A.md')
    await user.type(editor(), ' + 1')
    await waitFor(() => expect(screen.getByText('= prop("Price") * 2 + 1')).toBeInTheDocument())
    // One request for the first render, one after typing stopped; never one per keystroke.
    expect(vi.mocked(api.formulaPreview).mock.calls.length).toBeLessThanOrEqual(2)
    expect(vi.mocked(api.formulaPreview).mock.calls.at(-1)![0].properties?.find((d) => d.id === 'p-total')?.options.expression).toBe(
      'prop("Price") * 2 + 1',
    )
  })

  test('without an open object it parses only and says so', async () => {
    vi.mocked(api.formulaPreview).mockResolvedValue({ value: null, error: null })
    open()
    expect(await screen.findByText(FORMULA_TEXT.openObject)).toBeInTheDocument()
    expect(vi.mocked(api.formulaPreview).mock.calls[0][0]).not.toHaveProperty('path')
  })

  test('shows the parse error', async () => {
    vi.mocked(api.formulaPreview).mockResolvedValue({ value: null, error: 'Unknown function "rnd"' })
    open()
    expect(await screen.findByText('Unknown function "rnd"')).toBeInTheDocument()
  })

  test('shows an evaluation error value', async () => {
    vi.mocked(api.formulaPreview).mockResolvedValue({ value: { type: 'error', value: null, error: 'Division by zero' }, error: null })
    open('Orders/A.md')
    expect(await screen.findByText('Division by zero')).toBeInTheDocument()
  })

  test('the property list inserts prop("Name") at the cursor without saving', async () => {
    const user = userEvent.setup()
    open()
    const props = screen.getByRole('group', { name: FORMULA_TEXT.properties })
    expect(within(props).getByRole('button', { name: 'Insert Quantity' })).toBeInTheDocument()
    // The formula itself is not offered.
    expect(within(props).queryByRole('button', { name: 'Insert Total' })).toBeNull()
    await user.click(editor())
    editor().setSelectionRange(editor().value.length, editor().value.length)
    await user.click(within(props).getByRole('button', { name: 'Insert Quantity' }))
    expect(editor().value).toBe('prop("Price") * 2prop("Quantity")')
    expect(api.saveType).not.toHaveBeenCalled()
  })

  test('the function list searches and inserts a call with the caret inside', async () => {
    const user = userEvent.setup()
    open()
    await user.clear(editor())
    await user.type(screen.getByRole('textbox', { name: FORMULA_TEXT.searchFunctions }), 'round')
    const list = screen.getByRole('list', { name: FORMULA_TEXT.functions })
    expect(within(list).getByText('round(number, digits?)')).toBeInTheDocument()
    expect(within(list).queryByText('if(condition, then, else)')).toBeNull()
    editor().focus()
    await user.click(within(list).getByRole('button', { name: 'Insert round' }))
    expect(editor().value).toBe('round()')
    expect(editor().selectionStart).toBe(6)
  })

  test('a function search with no match says so', async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByRole('textbox', { name: FORMULA_TEXT.searchFunctions }), 'zzz')
    expect(screen.getByText(FORMULA_TEXT.noFunctions)).toBeInTheDocument()
  })

  test('the number format is saved with the property', async () => {
    const user = userEvent.setup()
    open()
    const section = screen.getByRole('region', { name: FORMULA_TEXT.numberFormat })
    await user.click(within(section).getByRole('button', { name: 'Number format' }))
    await user.click(screen.getByRole('button', { name: 'Percentage' }))
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.options.numberFormat?.type).toBe('percentage')
    expect(savedDef()?.options.expression).toBe('prop("Price") * 2')
  })

  test('a formula cannot change its property type', () => {
    open()
    expect(screen.getByText('This property type cannot be changed.')).toBeInTheDocument()
  })

  test('the expression is limited to 2000 characters', () => {
    open()
    fireEvent.change(editor(), { target: { value: 'x' } })
    expect(editor().maxLength).toBe(2000)
  })
})
