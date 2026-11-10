// M31 fix pass: "Media loading: Required only" and the media token reach every space image, not
// just the editor's media blocks: covers, cards and galleries (the Page link view card too), image
// property cells (whiteboard media: whiteboard/media.test.tsx). One placeholder, full or compact.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/api/client'
import { CoverImage } from '@/object/CoverImage'
import { CoverImageCell } from '@/properties/cells/CoverImageCell'
import { MEDIA_TEXT, bumpMediaToken, resetMediaToken, withMediaToken } from '@/settings/mediaLoading'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { PageCard } from '@/views/cards/PageCard'
import { SmallCard } from '@/views/cards/SmallCard'
import { WideCard } from '@/views/cards/WideCard'
import { SpaceImage } from './SpaceImage'

const COVER = 'Attachments/cover.png'
const URL_RE = /^\/api\/file\?path=Attachments%2Fcover\.png&m=\w+$/
const TYPE = typeDef({ id: 'page', name: 'Page', propertyDefinitions: [] })
const ROW = row({ summary: objectSummary({ path: 'Pages/A.md', title: 'A', type: 'page', coverImage: COVER }) })

const required = () => useSettings.setState({ settings: { ...settingsDefaults, mediaLoading: 'required' }, revision: 'r0', loaded: true })

beforeEach(() => {
  resetMediaToken()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

afterEach(() => resetMediaToken())

describe('the media token on every space file URL', () => {
  test('api.fileUrl carries the token once the media cache is cleared; a URL never carries two', () => {
    expect(api.fileUrl(COVER)).toBe('/api/file?path=Attachments%2Fcover.png')
    const t = bumpMediaToken()
    expect(api.fileUrl(COVER)).toBe(`/api/file?path=Attachments%2Fcover.png&m=${t}`)
    expect(withMediaToken(api.fileUrl(COVER), 'next')).toBe('/api/file?path=Attachments%2Fcover.png&m=next')
    expect(withMediaToken('https://example.com/a.png', 'next')).toBe('https://example.com/a.png')
  })

  test('a shown image reloads when the cache is cleared (a card picture, a cover)', () => {
    render(
      <>
        <PageCard row={ROW} type={TYPE} />
        <CoverImage path={COVER} wide={false} crop />
      </>,
    )
    const srcs = () => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(srcs()).toEqual(['/api/file?path=Attachments%2Fcover.png', '/api/file?path=Attachments%2Fcover.png'])
    act(() => void bumpMediaToken())
    for (const src of srcs()) expect(src).toMatch(URL_RE)
  })
})

describe('Media loading: Required only outside the media blocks', () => {
  test('SpaceImage: Everything shows the image; Required only the placeholder until Load', () => {
    const { unmount } = render(<SpaceImage path={COVER} className="h-44 w-full" />)
    expect(document.querySelector('img')).not.toBeNull()
    unmount()
    required()
    render(<SpaceImage path={COVER} className="h-44 w-full" />)
    expect(document.querySelector('img')).toBeNull()
    const ph = screen.getByTestId('media-placeholder')
    expect(ph).toHaveTextContent('cover.png')
    expect(ph).toHaveTextContent(MEDIA_TEXT.notLoaded)
    fireEvent.click(screen.getByRole('button', { name: MEDIA_TEXT.load }))
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/file?path=Attachments%2Fcover.png')
  })

  test('the Page link view card shows the full placeholder; Load loads the picture and does not open the card', () => {
    required()
    const onOpen = vi.fn()
    render(<PageCard row={ROW} type={TYPE} onOpen={onOpen} />)
    const card = screen.getByTestId('page-card')
    expect(card.querySelector('img')).toBeNull()
    expect(within(card).getByTestId('media-placeholder')).toHaveTextContent(MEDIA_TEXT.notLoaded)
    fireEvent.click(within(card).getByRole('button', { name: MEDIA_TEXT.load }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(card.querySelector('img')).not.toBeNull()
  })

  test('small and wide cards (galleries, boards) show the compact placeholder; Enter on Load does not open the card', () => {
    required()
    const onOpen = vi.fn()
    render(
      <>
        <SmallCard row={ROW} type={TYPE} props={[]} onOpen={onOpen} />
        <WideCard row={ROW} type={TYPE} props={[]} onOpen={onOpen} />
      </>,
    )
    for (const id of ['small-card', 'wide-card']) {
      const card = screen.getByTestId(id)
      expect(card.querySelector('img'), id).toBeNull()
      const ph = within(card).getByTestId('media-placeholder')
      expect(ph).toHaveAttribute('data-compact')
      const load = within(ph).getByRole('button', { name: MEDIA_TEXT.load })
      expect(load).toHaveAttribute('title', `cover.png: ${MEDIA_TEXT.notLoaded}`)
      fireEvent.keyDown(load, { key: 'Enter' })
      fireEvent.click(load)
      expect(onOpen).not.toHaveBeenCalled()
      expect(card.querySelector('img'), id).not.toBeNull()
    }
  })

  test('a cover image waits behind Load', () => {
    required()
    render(<CoverImage path={COVER} wide={false} crop onChange={vi.fn()} />)
    const cover = document.querySelector('[data-cover-image]')!
    expect(cover.querySelector('img')).toBeNull()
    fireEvent.click(within(cover as HTMLElement).getByRole('button', { name: MEDIA_TEXT.load }))
    expect(cover.querySelector('img')).not.toBeNull()
  })

  test("an image property cell's thumbnail is a compact Load that doesn't open the picker", () => {
    required()
    const def = propertyDef({ id: 'cover', key: 'coverImage', name: 'Cover', type: 'coverImage' })
    render(<CoverImageCell def={def} value={COVER} readOnly={false} density="panel" onChange={vi.fn()} />)
    expect(document.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: MEDIA_TEXT.load }))
    expect(document.querySelector('img')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
