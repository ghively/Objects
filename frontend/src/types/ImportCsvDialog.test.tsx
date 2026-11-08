// M9 Task 19: Import CSV into a type ("Batch import to collection").
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { collection, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useSettings } from '@/settings/useSettings'
import { CSV_ROW_LIMIT, csvRecord, csvTargets, csvValue, defaultMapping, ImportCsvDialog } from './ImportCsvDialog'

const mocked = vi.mocked(api)
const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const AUTHOR = propertyDef({ id: 'author', key: 'author', name: 'Author', type: 'text' })
const PAGES = propertyDef({ id: 'pages', key: 'pages', name: 'Pages', type: 'number' })
const GENRE = propertyDef({
  id: 'genre',
  key: 'genre',
  name: 'Genre',
  type: 'label',
  options: { isArray: false, set: [{ id: 'g1', text: 'Fiction', color: 'gray', icon: null }] },
})
const BOOK = typeDef({ id: 'book', name: 'Book', pluralName: 'Books', propertyDefinitions: [TITLE, AUTHOR, PAGES, GENRE] })

const csvFile = (text: string, name = 'Reading list.csv') => new File([text], name, { type: 'text/csv' })

async function upload(user: ReturnType<typeof userEvent.setup>, text: string, name?: string) {
  await user.upload(screen.getByLabelText('Choose file or drop here.'), csvFile(text, name))
}

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.createObject.mockImplementation(async (_t, opts) => ({ path: `Books/${opts?.title}.md`, version: 'v1' }))
  mocked.createCollection.mockImplementation(async (name, typeIds) => collection({ id: 'c1', name, typeIds }))
})

describe('ImportCsvDialog', () => {
  test('test header row toggle', async () => {
    const user = userEvent.setup()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={() => undefined} />)
    expect(screen.getByText('Batch import to collection')).toBeInTheDocument()
    expect(screen.getByText('Use this with caution')).toBeInTheDocument()
    await upload(user, 'Name,Author\nDune,Herbert\nEmma,Austen\n')
    expect(await screen.findByText('Add 2 new Books to')).toBeInTheDocument()
    const mappings = screen.getByRole('region', { name: 'Property Mappings' })
    expect(within(mappings).getByText('Name')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Has a header row' }))
    expect(screen.getByText('Add 3 new Books to')).toBeInTheDocument()
    expect(within(mappings).getByText('Column 1')).toBeInTheDocument()
    expect(within(mappings).getByText('Column 2')).toBeInTheDocument()
  })

  test('test mapping defaults and first value wins', () => {
    const targets = csvTargets(BOOK)
    expect(defaultMapping(['Name', 'author', 'Pages', 'Unknown'], targets)).toEqual(['title', 'author', 'pages', null])
    // Two columns on Author: the first non-empty value is kept; a number and a label are parsed.
    const mapping = ['title', 'author', 'author', 'pages', 'genre']
    expect(csvRecord(['Dune', 'Herbert', 'Someone', '1,234', 'fiction'], mapping, targets)).toEqual({
      title: 'Dune',
      values: { author: 'Herbert', pages: 1234, genre: ['Fiction'] },
    })
    // An unknown option and a non-number are skipped, not sent.
    expect(csvRecord(['X', '', 'B', 'many', 'Poetry'], mapping, targets)).toEqual({ title: 'X', values: { author: 'B' } })
  })

  test('a percentage column is read in percent, as the cell is (audit 2026-11-01 #14)', () => {
    const share = propertyDef({ id: 'share', key: 'share', name: 'Share', type: 'number', options: { numberFormat: { type: 'percentage', options: {} } } })
    const plain = propertyDef({ id: 'rate', key: 'rate', name: 'Rate', type: 'number' })
    expect(csvValue(share, '25')).toBe(0.25)
    expect(csvValue(share, '25%')).toBe(0.25)
    expect(csvValue(share, '14.3')).toBe(0.143)
    // A plain number keeps "25" and reads a trailing % as the fraction, as its cell does.
    expect(csvValue(plain, '25')).toBe(25)
    expect(csvValue(plain, '25%')).toBe(0.25)
  })

  test('a quoted cell is one value; only an unquoted cell with commas is a list; text is trimmed (audit 2026-11-01)', () => {
    const people = propertyDef({ id: 'people', key: 'people', name: 'People', type: 'entity', options: { isArray: true } })
    const tags = propertyDef({ id: 'tags', key: 'tags', name: 'Tags', type: 'entity_tags' })
    const q = (text: string) => ({ text, quoted: true })
    expect(csvValue(people, q('Smith, John'))).toEqual([{ target: 'Smith, John', path: null }])
    expect(csvValue(people, 'Smith, John')).toEqual([
      { target: 'Smith', path: null },
      { target: 'John', path: null },
    ])
    expect(csvValue(tags, q('a, b'))).toEqual(['a, b'])
    expect(csvValue(tags, ' a , b ')).toEqual(['a', 'b'])
    expect(csvValue(GENRE, q('Fiction'))).toEqual(['Fiction'])
    expect(csvValue(AUTHOR, '  hello  ')).toBe('hello')
    // Records keep the quoting through the dialog's reader.
    const targets = csvTargets(typeDef({ id: 'b', propertyDefinitions: [TITLE, people] }))
    expect(csvRecord([q('Dune'), q('Smith, John')], ['title', 'people'], targets)).toEqual({
      title: 'Dune',
      values: { people: [{ target: 'Smith, John', path: null }] },
    })
  })

  test('test creates one object per row', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={onOpenChange} />)
    await upload(user, 'Name,Author,Pages\r\nDune,Herbert,412\r\nEmma,Austen,\r\n')
    await user.click(await screen.findByRole('button', { name: 'Import' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mocked.createObject.mock.calls).toEqual([
      ['book', { title: 'Dune', templateId: 'none', values: { author: 'Herbert', pages: 412 } }],
      ['book', { title: 'Emma', templateId: 'none', values: { author: 'Austen' } }],
    ])
    expect(mocked.createCollection).not.toHaveBeenCalled()
  })

  test("a column written with decimal commas is read with them, whatever the setting", async () => {
    const before = useSettings.getState().settings
    useSettings.setState({ settings: { ...before, decimalSeparator: 'dot' } })
    try {
      // A plain value follows the setting: "1,5" under "dot" is 15.
      expect(csvValue(PAGES, '1,5')).toBe(15)
      expect(csvValue(PAGES, '1,5', true)).toBe(1.5)
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(<ImportCsvDialog type={BOOK} open onOpenChange={onOpenChange} />)
      await upload(user, 'Name,Pages\r\nDune,"1,5"\r\nEmma,"1.234,25"\r\nOdd,12\r\n')
      await user.click(await screen.findByRole('button', { name: 'Import' }))
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(mocked.createObject.mock.calls.map((c) => c[1]?.values)).toEqual([{ pages: 1.5 }, { pages: 1234.25 }, { pages: 12 }])
    } finally {
      useSettings.setState({ settings: before })
    }
  })

  test('a column the cells cannot tell about follows the setting', async () => {
    const before = useSettings.getState().settings
    useSettings.setState({ settings: { ...before, decimalSeparator: 'comma' } })
    try {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(<ImportCsvDialog type={BOOK} open onOpenChange={onOpenChange} />)
      // "1.234" reads either way: the setting (comma) makes it 1234. "2.5" can only be a point: 2.5.
      await upload(user, 'Name,Pages,Pages\r\nDune,1.234,2.5\r\n')
      await user.click(await screen.findByRole('button', { name: 'Import' }))
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(mocked.createObject.mock.calls[0][1]?.values).toEqual({ pages: 1234 })
      expect(csvRecord(['Dune', '', '2.5'], ['title', 'pages', 'pages'], csvTargets(BOOK), [undefined, undefined, false]).values).toEqual({ pages: 2.5 })
    } finally {
      useSettings.setState({ settings: before })
    }
  })

  test('test over row limit shows not supported', async () => {
    const user = userEvent.setup()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={() => undefined} />)
    const lines = ['Name', ...Array.from({ length: CSV_ROW_LIMIT + 1 }, (_, i) => `Book ${i}`)]
    await upload(user, lines.join('\n'))
    expect(await screen.findByText('This file is not supported. We only support CSV imports up to 1000 rows.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  test('test new collection option', async () => {
    const user = userEvent.setup()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={() => undefined} />)
    await upload(user, 'Name\nDune\n')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Import into' }), 'New collection "Reading list"')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(1))
    expect(mocked.createCollection).toHaveBeenCalledWith('Reading list', ['book'])
    expect(mocked.createObject).toHaveBeenCalledWith('book', { title: 'Dune', templateId: 'none', values: { collections: ['Reading list'] } })
  })

  test('a malformed file shows the reading error', async () => {
    const user = userEvent.setup()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={() => undefined} />)
    await upload(user, 'Name\n"Dune\n')
    expect(
      await screen.findByText('Some issues were found while parsing your file. Make sure to use a valid CSV file to ensure the import you expect.'),
    ).toBeInTheDocument()
  })

  test('blank lines do not become objects', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={onOpenChange} />)
    await upload(user, 'Name,Author\n\nDune,Herbert\n,\n\nEmma,Austen\n\n')
    expect(await screen.findByText('Add 2 new Books to')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mocked.createObject.mock.calls.map((c) => c[1]?.title)).toEqual(['Dune', 'Emma'])
  })

  test('a file dropped on the drop zone is read', async () => {
    render(<ImportCsvDialog type={BOOK} open onOpenChange={() => {}} />)
    const zone = screen.getByText('Choose file or drop here.').closest('label')!
    const dataTransfer = { files: [csvFile('Name\nDune\nEmma\n')], types: ['Files'] }
    expect(fireEvent.dragOver(zone, { dataTransfer })).toBe(false)
    fireEvent.drop(zone, { dataTransfer })
    expect(await screen.findByText('Add 2 new Books to')).toBeInTheDocument()
  })
})

// Audit 2026-11-07 #15: an import that fails part-way resumes from the failed row on the next Import
// (into the collection it already made); rows already created are never created again.
describe('ImportCsvDialog retry after a failure', () => {
  const failSecond = () => {
    let calls = 0
    mocked.createObject.mockImplementation(async (_t, opts) => {
      calls += 1
      if (calls === 2) throw new Error('disk full')
      return { path: `Books/${opts?.title}.md`, version: 'v1' }
    })
  }

  test('Import again resumes from the failed row', async () => {
    failSecond()
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={onOpenChange} />)
    await upload(user, 'Name,Author\nDune,Herbert\nEmma,Austen\nIt,King\n')
    await screen.findByText('Add 3 new Books to')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('disk full')).toBeInTheDocument()
    expect(mocked.createObject.mock.calls.map((c) => c[1]?.title)).toEqual(['Dune', 'Emma'])
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mocked.createObject.mock.calls.map((c) => c[1]?.title)).toEqual(['Dune', 'Emma', 'Emma', 'It'])
  })

  test('the new collection is made once and reused on the retry', async () => {
    failSecond()
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={onOpenChange} />)
    await upload(user, 'Name,Author\nDune,Herbert\nEmma,Austen\n')
    await screen.findByText('Add 2 new Books to')
    await user.selectOptions(screen.getByLabelText('Import into'), 'newCollection')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('disk full')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mocked.createCollection).toHaveBeenCalledTimes(1)
    const sent = mocked.createObject.mock.calls.map((c) => [c[1]?.title, (c[1]?.values as { collections?: string[] } | undefined)?.collections])
    expect(sent).toEqual([
      ['Dune', ['Reading list']],
      ['Emma', ['Reading list']],
      ['Emma', ['Reading list']],
    ])
  })

  test('a new file starts a fresh import', async () => {
    failSecond()
    const user = userEvent.setup()
    render(<ImportCsvDialog type={BOOK} open onOpenChange={() => undefined} />)
    await upload(user, 'Name\nDune\nEmma\n')
    await screen.findByText('Add 2 new Books to')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('disk full')).toBeInTheDocument()
    await upload(user, 'Name\nDune\nEmma\n', 'Other.csv')
    await screen.findByText('Other.csv')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(4))
    expect(mocked.createObject.mock.calls.map((c) => c[1]?.title)).toEqual(['Dune', 'Emma', 'Dune', 'Emma'])
  })
})
