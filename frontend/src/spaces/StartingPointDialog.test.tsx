import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { SpaceInfo } from '@/api/types'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { CREATE_SPACE_TEXT } from './CreateSpaceDialog'
import { STARTING_POINT_TEXT, StartingPointDialog } from './StartingPointDialog'

const mocked = vi.mocked(api)

const info = (over: Partial<SpaceInfo> = {}): SpaceInfo => ({ name: 'Fresh', root: '/tmp/fresh', types: [], ...over })

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  resetLinkIndex()
})

describe('StartingPointDialog', () => {
  test('test a new or empty space offers the two starting points and writes nothing before a pick', async () => {
    act(() => useSpaceInfo.setState({ space: info({ needsSetup: true }), loaded: true }))
    render(<StartingPointDialog />)
    expect(await screen.findByRole('dialog', { name: STARTING_POINT_TEXT.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CREATE_SPACE_TEXT.basicLabel })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CREATE_SPACE_TEXT.blankLabel })).toBeInTheDocument()
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
  })

  test('test picking basic setup applies it and closes', async () => {
    const user = userEvent.setup()
    act(() => useSpaceInfo.setState({ space: info({ needsSetup: true }), loaded: true }))
    mocked.spaceSetup.mockResolvedValue(info({ needsSetup: false }))
    render(<StartingPointDialog />)
    await user.click(await screen.findByRole('button', { name: CREATE_SPACE_TEXT.basicLabel }))
    expect(mocked.spaceSetup).toHaveBeenCalledWith('basic')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('test picking IT operations applies it and reloads the link index (M28)', async () => {
    const user = userEvent.setup()
    act(() => useSpaceInfo.setState({ space: info({ needsSetup: true }), loaded: true }))
    mocked.spaceSetup.mockResolvedValue(info({ needsSetup: false }))
    const load = vi.spyOn(useLinkIndex.getState(), 'load').mockResolvedValue(undefined)
    render(<StartingPointDialog />)
    const buttons = (await screen.findByRole('dialog')).querySelectorAll('button[aria-describedby]')
    expect([...buttons].map((b) => b.getAttribute('aria-label'))).toEqual([
      CREATE_SPACE_TEXT.basicLabel,
      CREATE_SPACE_TEXT.itopsLabel,
      CREATE_SPACE_TEXT.blankLabel,
    ])
    await user.click(screen.getByRole('button', { name: 'IT operations' }))
    expect(mocked.spaceSetup).toHaveBeenCalledWith('itops')
    await waitFor(() => expect(load).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('test picking an empty space does not reload the link index', async () => {
    const user = userEvent.setup()
    act(() => useSpaceInfo.setState({ space: info({ needsSetup: true }), loaded: true }))
    mocked.spaceSetup.mockResolvedValue(info({ needsSetup: false }))
    const load = vi.spyOn(useLinkIndex.getState(), 'load').mockResolvedValue(undefined)
    render(<StartingPointDialog />)
    await user.click(await screen.findByRole('button', { name: CREATE_SPACE_TEXT.blankLabel }))
    expect(mocked.spaceSetup).toHaveBeenCalledWith('blank')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(load).not.toHaveBeenCalled()
  })

  test('test closing without a pick writes nothing', async () => {
    const user = userEvent.setup()
    act(() => useSpaceInfo.setState({ space: info({ needsSetup: true }), loaded: true }))
    render(<StartingPointDialog />)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
  })

  test('test a space that was set up is not asked', () => {
    act(() => useSpaceInfo.setState({ space: info({ needsSetup: false }), loaded: true }))
    render(<StartingPointDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
