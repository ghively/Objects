// M9 Task 19: Import CSV into a type ("Batch import to collection").
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { collection, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { CSV_ROW_LIMIT, csvRecord, csvTargets, defaultMapping, ImportCsvDialog } from './ImportCsvDialog'

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
})
