// M29 Task 12: the synced mark in property settings ("Synced from a script or agent").
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PropertyDef, PropertyType, SyncedSpec, TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { PropertySettings } from '../PropertySettings'
import { SYNCED_SETTINGS_TEXT as T } from './SyncedSection'

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })

function hostType(kind: PropertyType, synced?: SyncedSpec | null): TypeDef {
  const p = propertyDef({ id: 'p-disk', key: 'diskFree', name: 'Disk free', type: kind, ...(synced ? { synced } : {}) })
  return typeDef({ id: 'host', name: 'Host', pluralName: 'Hosts', revision: 'r1', propertyDefinitions: [TITLE, p] })
}

function open(kind: PropertyType, synced?: SyncedSpec | null) {
  useLinkIndex.setState({ types: [hostType(kind, synced)], objects: [], loaded: true })
  return render(<PropertySettings typeId="host" propertyId="p-disk" open onOpenChange={vi.fn()} />)
}

function savedDef(call = 0): PropertyDef | undefined {
  const t: TypeDef = vi.mocked(api.saveType).mock.calls[call][0]
  return t.propertyDefinitions.find((d) => d.id === 'p-disk')
}

const toggle = () => screen.getByRole('switch', { name: T.toggle })
const sourceBox = () => screen.getByRole('textbox', { name: T.source }) as HTMLInputElement
const staleBox = () => screen.getByRole('spinbutton', { name: T.staleAfter }) as HTMLInputElement

beforeEach(() => {
  vi.mocked(api.saveType).mockClear()
  resetLinkIndex()
})

describe('SyncedSection', () => {
  test('the toggle needs a source', async () => {
    const user = userEvent.setup()
    open('number')
    expect(screen.queryByRole('textbox', { name: T.source })).toBeNull()
    await user.click(toggle())
    expect(sourceBox()).toHaveAttribute('aria-invalid', 'true')
    expect(sourceBox()).toHaveAttribute('placeholder', T.sourcePlaceholder)
    expect(screen.getByText(T.hidesFileValues)).toBeInTheDocument()
    await user.click(sourceBox())
    await user.tab()
    expect(api.saveType).not.toHaveBeenCalled()
    await user.type(sourceBox(), '   ')
    await user.tab()
    expect(api.saveType).not.toHaveBeenCalled()
    expect(sourceBox()).toHaveAttribute('aria-invalid', 'true')
  })

  test('source and stale after are saved', async () => {
    const user = userEvent.setup()
    open('number')
    await user.click(toggle())
    await user.type(sourceBox(), 'Inventory script')
    await user.tab()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.synced).toEqual({ source: 'Inventory script', staleAfterDays: 7 })
    expect(sourceBox()).toHaveAttribute('aria-invalid', 'false')

    await user.clear(staleBox())
    await user.type(staleBox(), '3')
    await user.tab()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(2))
    expect(savedDef(1)?.synced).toEqual({ source: 'Inventory script', staleAfterDays: 3 })
    expect(screen.getByText('days')).toBeInTheDocument()
  })

  test('stale after out of range is not saved', async () => {
    const user = userEvent.setup()
    open('datetime', { source: 'Inventory script', staleAfterDays: 7 })
    await user.clear(staleBox())
    await user.type(staleBox(), '400')
    await user.tab()
    expect(api.saveType).not.toHaveBeenCalled()
    expect(staleBox().value).toBe('7')
  })

  test('turning it off saves synced null', async () => {
    const user = userEvent.setup()
    open('label', { source: 'Inventory script', staleAfterDays: 7 })
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(sourceBox().value).toBe('Inventory script')
    await user.click(toggle())
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.synced).toBeNull()
  })

  test('not shown for a relation or formula property', () => {
    for (const kind of ['entity', 'formula'] as const) {
      const { unmount } = open(kind)
      expect(screen.queryByRole('switch', { name: T.toggle })).toBeNull()
      expect(screen.queryByRole('region', { name: T.title })).toBeNull()
      unmount()
    }
  })

  test.each(['text', 'url', 'number', 'boolean', 'datetime', 'datetimeSimple', 'label'] as const)(
    'shown for a %s property',
    (kind) => {
      open(kind)
      expect(screen.getByRole('region', { name: T.title })).toHaveTextContent(T.description)
    },
  )
})
