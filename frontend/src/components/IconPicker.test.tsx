import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { THEME_COLORS } from '@/theme/palette'
import { ColorPicker } from './ColorPicker'
import { IconPicker } from './IconPicker'
import { ImagePicker } from './ImagePicker'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

describe('IconPicker', () => {
  it('test IconPicker search "user" offers ph-user; colour row sets Icon.color', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<IconPicker value={null} onChange={onChange} />)
    await user.click(screen.getByRole('tab', { name: 'Icons' }))
    await user.type(screen.getByRole('textbox', { name: 'Search icons' }), 'user')
    const pick = await screen.findByRole('button', { name: 'ph-user' }, { timeout: 5000 })
    // Only the regular weight of the bundled Phosphor set is offered.
    expect(screen.queryByRole('button', { name: 'ph-user-bold' })).toBeNull()
    await user.click(pick)
    expect(onChange).toHaveBeenLastCalledWith({ type: 'iconify', val: 'ph-user' })

    rerender(<IconPicker value={{ type: 'iconify', val: 'ph-user' }} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Teal' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'iconify', val: 'ph-user', color: 'teal' })
  })

  it('emoji tab picks an emoji, has no colour row, and Remove clears', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value={{ type: 'emoji', val: '🚀' }} onChange={onChange} />)
    expect(screen.getByRole('tab', { name: 'Emoji' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Teal' })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Search emoji' }), 'heart')
    await user.click(screen.getAllByRole('button', { name: /heart/i })[0])
    expect(onChange.mock.calls[0][0]).toMatchObject({ type: 'emoji' })
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe('ColorPicker', () => {
  it('offers the 18 colours and no "none"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ColorPicker value="teal" onChange={onChange} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(THEME_COLORS.length)
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Light blue' }))
    expect(onChange).toHaveBeenCalledWith('sky')
  })
})

describe('ImagePicker', () => {
  it('test ImagePicker upload calls importImage and selects the new path', async () => {
    const user = userEvent.setup()
    vi.mocked(api.images).mockResolvedValueOnce([{ path: 'Attachments/old.png' }])
    vi.mocked(api.importImage).mockResolvedValueOnce({ path: 'Attachments/new.png' })
    const onChange = vi.fn()
    render(<ImagePicker value={null} onChange={onChange} />)
    expect(await screen.findByRole('button', { name: 'Attachments/old.png' })).toBeInTheDocument()

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'new.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Upload'), file)
    expect(api.importImage).toHaveBeenCalledWith('new.png', file)
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('Attachments/new.png'))
  })

  it('picks an existing image and removes', async () => {
    const user = userEvent.setup()
    vi.mocked(api.images).mockResolvedValueOnce([{ path: 'Attachments/old.png' }])
    const onChange = vi.fn()
    render(<ImagePicker value="Attachments/cover.png" onChange={onChange} />)
    await user.click(await screen.findByRole('button', { name: 'Attachments/old.png' }))
    expect(onChange).toHaveBeenLastCalledWith('Attachments/old.png')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
