// M29 Task 9: a relation picker's "Create '<q>'" rows, one per allowed type, the suggested first.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropertyDef } from '@/api/types'
import { setLastTypeSpace, useLastType } from '@/create/lastType'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { collection, objectSummary, propertyDef, typeDef } from '@/test/mockApi'
import { useDefs } from '@/types/useDefinitions'
import { api } from '@/api/client'
import { RelationPicker } from './RelationPicker'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

const mocked = vi.mocked(api)

const TYPES = [
  typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true }),
  typeDef({ id: 'host', name: 'Host', pluralName: 'Hosts', namePatterns: ['{ip}', '{fqdn}', 'SRV-*', '@@@##'] }),
  typeDef({ id: 'application', name: 'Application', pluralName: 'Applications' }),
  typeDef({ id: 'software', name: 'Software', pluralName: 'Software', namePatterns: ['{version}'] }),
  typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags', basic: true }),
]

function relDef(options: PropertyDef['options']): PropertyDef {
  return propertyDef({ id: 'p1', key: 'runsOn', name: 'Runs on', type: 'entity', options })
}

const createButtons = () =>
  [...document.querySelectorAll<HTMLElement>('[data-create-type]')].map((b) => ({
    type: b.getAttribute('data-create-type'),
    text: b.textContent,
  }))

beforeEach(async () => {
  localStorage.clear()
  await setLastTypeSpace(null)
  useTabs.getState().reset()
  resetLinkIndex()
  mocked.createObject.mockClear()
  useLinkIndex.setState({
    types: TYPES,
    objects: [objectSummary({ path: 'Software/Python 3.11.md', id: 'id-py', type: 'software', title: 'Python 3.11' })],
    loaded: true,
  })
})

describe('RelationPicker create rows (M29)', () => {
  it("a relation to Software offers Create 'SQL Server 2019' as Software only", async () => {
    const user = userEvent.setup()
    render(<RelationPicker def={relDef({ isArray: true, allowedTypes: ['software'] })} value={[]} onChange={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), 'SQL Server 2019')
    expect(createButtons()).toEqual([{ type: 'software', text: "Create 'SQL Server 2019'SoftwareSuggested" }])
  })

  it('a relation allowing Host and Application puts Host first for 10.20.0.5', async () => {
    const user = userEvent.setup()
    render(
      <RelationPicker def={relDef({ isArray: true, allowedTypes: ['application', 'host'] })} value={[]} onChange={vi.fn()} />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), '10.20.0.5')
    expect(createButtons().map((b) => b.type)).toEqual(['host', 'application'])
    expect(createButtons()[0].text).toContain('Suggested')
    expect(createButtons()[1].text).not.toContain('Suggested')
  })

  it('picking creates and adds the ref', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RelationPicker
        def={relDef({ isArray: true, allowedTypes: ['application', 'host'] })}
        value={[{ target: 'Old', path: 'Hosts/Old.md' }]}
        onChange={onChange}
      />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), 'Payroll')
    await user.click(screen.getByRole('button', { name: /Create 'Payroll'.*Application/ }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        { target: 'Old', path: 'Hosts/Old.md' },
        { target: 'Payroll', path: 'application/Payroll.md' },
      ]),
    )
    expect(mocked.createObject.mock.calls).toEqual([['application', { title: 'Payroll' }]])
    expect(useLastType.getState().typeId).toBe('application')
  })

  it('Enter with nothing found creates the suggested type; any type allowed lists the writable ones', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(<RelationPicker def={relDef({ isArray: false })} value={[]} onChange={onChange} onClose={onClose} />)
    await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), 'SRV-09')
    expect(createButtons().map((b) => b.type)).toEqual(['host', 'application', 'page', 'software', 'tag'])
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ target: 'SRV-09', path: 'host/SRV-09.md' }]))
    expect(onClose).toHaveBeenCalled()
  })

  it("an any-type relation doesn't take the active tab's scope (M29 review #13)", async () => {
    const user = userEvent.setup()
    // On a collection of Hosts, a relation to any type doesn't suggest Host for a name that isn't one.
    useDefs.setState({ collections: [collection({ id: 'c-hosts', typeIds: ['host'] })], queries: [], loaded: true })
    useTabs.getState().open({ kind: 'collection', id: 'c-hosts' })
    try {
      render(<RelationPicker def={relDef({ isArray: false })} value={[]} onChange={vi.fn()} />)
      await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), 'Payroll')
      expect(createButtons().length).toBeGreaterThan(1)
      expect(createButtons().filter((b) => b.text?.includes('Suggested'))).toEqual([])
    } finally {
      useDefs.setState({ collections: [], queries: [], loaded: false })
    }
  })

  it('no create rows for an exact match, a fixed set or an empty query', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <RelationPicker def={relDef({ isArray: true, allowedTypes: ['software'] })} value={[]} onChange={vi.fn()} />,
    )
    expect(createButtons()).toEqual([])
    await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), 'python 3.11')
    expect(createButtons()).toEqual([])
    unmount()
    render(
      <RelationPicker
        def={relDef({ isArray: true, allowedTypes: ['software'], hasFixedSet: true, fixedSet: ['id-py'] })}
        value={[]}
        onChange={vi.fn()}
      />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), 'Java 21')
    expect(createButtons()).toEqual([])
  })

  it('the Tag relation keeps its own Create row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    vi.mocked(api.ensureTag).mockResolvedValueOnce({ path: 'Tags/On Hold.md', created: true })
    render(<RelationPicker def={relDef({ isArray: false, allowedTypes: ['tag'] })} value={[]} onChange={onChange} />)
    await user.type(screen.getByRole('textbox', { name: 'Search or Create' }), 'On Hold')
    expect(createButtons()).toEqual([])
    await user.click(screen.getByRole('option', { name: "Create 'On Hold'" }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ target: 'On Hold', path: 'Tags/On Hold.md' }]))
    expect(mocked.createObject).not.toHaveBeenCalled()
  })
})
