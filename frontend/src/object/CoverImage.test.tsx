import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { COVER_TEXT, CoverImage, type CoverImageProps } from './CoverImage'

function cover(props: Partial<CoverImageProps> = {}) {
  const onOffsetChange = vi.fn()
  const onToggleWide = vi.fn()
  const r = render(
    <div>
      <button type="button">outside</button>
      <CoverImage
        path="Attachments/cover.png"
        wide={false}
        crop
        onChange={vi.fn()}
        onOffsetChange={onOffsetChange}
        onToggleWide={onToggleWide}
        {...props}
      />
    </div>,
  )
  const img = r.container.querySelector('[data-cover-image] img') as HTMLImageElement
  img.getBoundingClientRect = () => ({ width: 800, height: 200, top: 0, left: 0, right: 800, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  return { ...r, img, onOffsetChange, onToggleWide }
}

function drag(img: HTMLElement, dy: number) {
  fireEvent.pointerDown(img, { button: 0, clientY: 100 })
  fireEvent.pointerMove(window, { clientY: 100 + dy })
  fireEvent.pointerUp(window, { clientY: 100 + dy })
}

describe('CoverImage (M9)', () => {
  test('test strings verbatim', () => {
    expect(COVER_TEXT).toMatchObject({
      toggleWide: 'Toggle wide cover image',
      reposition: 'Reposition cover image',
      dragHint: 'Drag to move the image',
      save: 'Save',
      cancel: 'Cancel',
    })
  })

  test('test offset sets object position', () => {
    const { img } = cover({ offset: 30 })
    expect(img.style.objectPosition).toBe('0% 30%')
  })

  test('test drag repositions and save writes offset', async () => {
    const user = userEvent.setup()
    const { img, onOffsetChange } = cover()
    expect(img.style.objectPosition).toBe('0% 50%')
    await user.click(screen.getByRole('button', { name: 'Reposition cover image' }))
    expect(screen.getByText('Drag to move the image')).toBeInTheDocument()
    // Down by 40 px of 200: 50 − 40 / 200 × 100 = 30.
    drag(img, 40)
    expect(img.style.objectPosition).toBe('0% 30%')
    expect(onOffsetChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onOffsetChange).toHaveBeenCalledWith(30)
    expect(screen.queryByText('Drag to move the image')).toBeNull()
  })

  test('test clicking outside saves', async () => {
    const user = userEvent.setup()
    const { img, onOffsetChange } = cover({ offset: 20 })
    await user.click(screen.getByRole('button', { name: 'Reposition cover image' }))
    drag(img, -20)
    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(onOffsetChange).toHaveBeenCalledWith(30)
  })

  test('test cancel restores', async () => {
    const user = userEvent.setup()
    const { img, onOffsetChange } = cover({ offset: 70 })
    await user.click(screen.getByRole('button', { name: 'Reposition cover image' }))
    drag(img, 40)
    expect(img.style.objectPosition).toBe('0% 50%')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(img.style.objectPosition).toBe('0% 70%')
    expect(onOffsetChange).not.toHaveBeenCalled()
  })

  test('test offset clamps 0 to 100', async () => {
    const user = userEvent.setup()
    const { img, onOffsetChange } = cover()
    await user.click(screen.getByRole('button', { name: 'Reposition cover image' }))
    drag(img, 1000)
    expect(img.style.objectPosition).toBe('0% 0%')
    drag(img, -5000)
    expect(img.style.objectPosition).toBe('0% 100%')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onOffsetChange).toHaveBeenCalledWith(100)
  })

  test('test toggle wide and no reposition for an uncropped cover', async () => {
    const user = userEvent.setup()
    const { onToggleWide } = cover({ crop: false })
    await user.click(screen.getByRole('button', { name: 'Toggle wide cover image' }))
    expect(onToggleWide).toHaveBeenCalledTimes(1)
    // The offset only moves a cropped image.
    expect(screen.queryByRole('button', { name: 'Reposition cover image' })).toBeNull()
  })
})
