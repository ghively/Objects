import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { References } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, ConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { objectSummary, references, typeDef } from '@/test/mockApi'
import { ReferencesSection } from './ReferencesSection'

const mocked = vi.mocked(api)

const SELF = objectSummary({ path: 'People/Ada.md', id: 'ada', title: 'Ada', type: 'person' })

const DATA: References = references({
  tabs: ['all', 'backlinks', 'related', 'mentions'],
  mentions: [
    {
      path: 'Pages/Notes.md',
      version: 'v7',
      occurrences: [
        { start: 18, end: 21, text: 'Ada', context: 'Lunch with Ada.', contextStart: 7 },
        { start: 40, end: 43, text: 'ada', context: 'and ada again', contextStart: 36 },
      ],
    },
    {
      path: 'Pages/Log.md',
      version: 'v3',
      occurrences: [{ start: 0, end: 3, text: 'ADA', context: 'ADA called', contextStart: 0 }],
    },
  ],
  summaries: {
    'Pages/Notes.md': objectSummary({ path: 'Pages/Notes.md', title: 'Notes' }),
    'Pages/Log.md': objectSummary({ path: 'Pages/Log.md', title: 'Log' }),
  },
})

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page' })], objects: [], loaded: true })
  usePeek.getState().close()
  localStorage.setItem('object.references:ada', JSON.stringify({ tab: 'mentions', closed: false }))
  mocked.references.mockReset()
  mocked.references.mockResolvedValue(DATA)
  mocked.linkMention.mockReset()
  mocked.linkMention.mockResolvedValue({ version: 'v8' })
  mocked.onChange.mockImplementation(() => () => undefined)
})

const setup = async () => {
  const user = userEvent.setup()
  render(<ReferencesSection path={SELF.path} summary={SELF} />)
  await screen.findByText('Notes')
  mocked.references.mockClear()
  return user
}

describe('MentionsTab', () => {
  test('occurrences show their context with the match highlighted', async () => {
    await setup()
    const occ = document.querySelectorAll('[data-mention="Pages/Notes.md"] [data-occurrence]')
    expect(occ).toHaveLength(2)
    const first = occ[0].querySelector('.search-highlights') as HTMLElement
    expect(first.textContent).toBe('Lunch with Ada.')
    expect(first.querySelector('b')?.textContent).toBe('Ada')
    expect(occ[1].querySelector('b')?.textContent).toBe('ada')
    expect(screen.getAllByRole('button', { name: 'Link' })).toHaveLength(3)
  })

  test('link a mention sends version and reloads', async () => {
    const user = await setup()
    await user.click(screen.getAllByRole('button', { name: 'Link' })[1])
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
    expect(mocked.linkMention).toHaveBeenCalledWith({
      path: 'Pages/Notes.md',
      target: 'People/Ada.md',
      start: 40,
      end: 43,
      text: 'ada',
      baseVersion: 'v7',
    })
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent('Link created')
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
  })

  test('409 on link reloads without retry', async () => {
    mocked.linkMention.mockRejectedValue(new ConflictError('v9'))
    const user = await setup()
    await user.click(screen.getAllByRole('button', { name: 'Link' })[2])
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent('Changed elsewhere. Reloaded.')
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
    expect(mocked.linkMention.mock.calls[0][0]).toMatchObject({ path: 'Pages/Log.md', baseVersion: 'v3' })
  })

  test('422 (text moved) reloads without retry', async () => {
    mocked.linkMention.mockRejectedValue(new ApiError(422, 'The text has changed. Reload and try again.'))
    const user = await setup()
    await user.click(screen.getAllByRole('button', { name: 'Link' })[0])
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent('Changed elsewhere. Reloaded.')
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
  })

  test('a second click while linking sends nothing more', async () => {
    let finish: (v: { version: string }) => void = () => undefined
    mocked.linkMention.mockImplementation(() => new Promise((r) => (finish = r)))
    const user = await setup()
    const buttons = screen.getAllByRole('button', { name: 'Link' })
    await user.click(buttons[0])
    await user.click(buttons[1])
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
    finish({ version: 'v8' })
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
  })

  test('a mention context click peeks with the mentions list', async () => {
    const user = await setup()
    await user.click(document.querySelector('[data-mention="Pages/Log.md"] [data-occurrence] button') as HTMLElement)
    expect(usePeek.getState().path).toBe('Pages/Log.md')
    expect(usePeek.getState().list).toEqual(['Pages/Notes.md', 'Pages/Log.md'])
  })
})
