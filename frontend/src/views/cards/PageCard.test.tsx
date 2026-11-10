// M31 item 14: the "Page" link view: a full-width, read-only preview of the object as its page
// shows it (cover, type, icon and title, description, the properties the page shows, the first
// lines of the body); clicking it opens the object.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { ObjectCard } from './ObjectCard'
import { PageCard, pageCardProperties } from './PageCard'

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const DESC = propertyDef({ id: 'description', key: 'description', name: 'Description', type: 'entity_description' })
const ROLE = propertyDef({ id: 'p-role', key: 'role', name: 'Role', type: 'text' })
const PHONE = propertyDef({ id: 'p-phone', key: 'phone', name: 'Phone', type: 'text', visibility: 'hideWhenEmpty' })
const DESK = propertyDef({ id: 'p-desk', key: 'desk', name: 'Desk', type: 'text' })
const SECRET = propertyDef({ id: 'p-secret', key: 'secret', name: 'Secret', type: 'text', visibility: 'hidden' })
const NOTES = propertyDef({ id: 'p-notes', key: 'notes', name: 'Notes', type: 'blocks' })
const PERSON = typeDef({
  id: 'person',
  name: 'Person',
  propertyDefinitions: [TITLE, DESC, ROLE, PHONE, DESK, SECRET, NOTES],
})

const ADA = row({
  summary: objectSummary({
    path: 'People/Ada Lovelace.md',
    type: 'person',
    title: 'Ada Lovelace',
    icon: '🧮',
    description: 'Wrote the first program.',
    coverImage: 'Attachments/ada.png',
  }),
  values: { role: 'Analyst', secret: 'hush', desk: null, phone: null },
  preview: 'Notes on the Analytical Engine. More lines follow.',
})

describe('PageCard', () => {
  test('shows the cover, type, icon, title, description, the shown properties and the first lines', () => {
    render(<PageCard row={ADA} type={PERSON} />)
    const card = screen.getByTestId('page-card')
    expect(card).toHaveAttribute('data-path', 'People/Ada Lovelace.md')
    expect(card.querySelector('img')).toHaveAttribute('src', expect.stringContaining('ada.png'))
    expect(within(card).getByTestId('card-type')).toHaveTextContent('Person')
    expect(within(card).getByRole('heading', { name: /Ada Lovelace/ })).toHaveTextContent('🧮')
    expect(within(card).getByTestId('card-description')).toHaveTextContent('Wrote the first program.')
    // As the page shows them: hidden and hidden-when-empty ones are left out, an empty one reads "Empty".
    expect(within(card).getAllByTestId('card-prop-name').map((e) => e.textContent)).toEqual(['Role', 'Desk'])
    expect(within(card).getByDisplayValue('Analyst')).toBeInTheDocument()
    expect(within(card).getByText('Empty')).toBeInTheDocument()
    expect(card).not.toHaveTextContent('hush')
    expect(within(card).getByTestId('page-card-body')).toHaveTextContent('Notes on the Analytical Engine.')
    // Read-only: nothing in it can be typed into.
    for (const box of within(card).queryAllByRole('textbox')) expect(box).toHaveAttribute('readonly')
  })

  test('clicking or Enter opens the object; ObjectCard draws it for the page view', () => {
    const onOpen = vi.fn()
    render(<ObjectCard row={ADA} type={PERSON} view="page" props={[]} onOpen={onOpen} />)
    const card = screen.getByTestId('page-card')
    fireEvent.click(card)
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen.mock.calls[0][0]).toBe(ADA)
  })

  test('without a cover, description or body it shows just the header', () => {
    const bare = row({ summary: objectSummary({ path: 'People/Bo.md', type: 'person', title: 'Bo' }) })
    render(<PageCard row={bare} type={typeDef({ id: 'person', propertyDefinitions: [TITLE] })} />)
    const card = screen.getByTestId('page-card')
    expect(card.querySelector('img')).toBeNull()
    expect(within(card).queryByTestId('page-card-body')).toBeNull()
    expect(within(card).getByRole('heading', { name: 'Bo' })).toBeInTheDocument()
    expect(pageCardProperties(PERSON, ADA).map((p) => p.propertyId)).toEqual(['role', 'desk'])
  })
})
