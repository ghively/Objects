import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, SpaceInfo, TypeDef, UpdateResult, ViewDesign } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from './ObjectPage'
import { MIN_CONTENT_WIDTH, PageLayout, PROPERTIES_BESIDE_WIDTH, PROPERTY_PANEL_WIDTH, propertiesBeside, type PanelVariant } from './PageLayout'

const mocked = vi.mocked(api)

function layout(partial: Partial<TypeDef>, coverImage: string | null = null, onCoverChange = vi.fn()) {
  const type = typeDef({ id: 'person', ...partial })
  const summary = objectSummary({ path: 'People/Ada.md', type: 'person', title: 'Ada', coverImage })
  return render(
    <PageLayout
      type={type}
      summary={summary}
      header={<h1>Ada</h1>}
      properties={<aside aria-label="Properties">props</aside>}
      body={<p>Body text</p>}
      onCoverChange={onCoverChange}
    />,
  )
}

describe('PageLayout', () => {
  test('test each viewDesign renders its layout container', () => {
    const cases: [ViewDesign | null, string, string][] = [
      [null, 'standard', ''],
      ['indexCard', 'indexCard', '[data-index-card]'],
      ['profile', 'profile', '[data-profile-column]'],
      ['encyclopedia', 'encyclopedia', ''],
    ]
    for (const [viewDesign, name, marker] of cases) {
      const { container, unmount } = layout({ viewDesign })
      const root = container.querySelector('[data-page-layout]') as HTMLElement
      expect(root.dataset.pageLayout).toBe(name)
      const props = screen.getByRole('complementary', { name: 'Properties' })
      const content = container.querySelector('[data-page-content]') as HTMLElement
      const body = container.querySelector('[data-page-body]') as HTMLElement
      if (name === 'standard') {
        // The left panel, outside the content column.
        expect(content.contains(props)).toBe(false)
      } else {
        expect(content.contains(props)).toBe(true)
      }
      if (marker) expect(container.querySelector(marker)?.contains(props)).toBe(true)
      if (name === 'profile') {
        expect(container.querySelector('[data-profile-column] [data-profile-image]')).not.toBeNull()
      }
      if (name === 'encyclopedia') {
        // The infobox sits next to the body, after it.
        expect(body.parentElement).toBe(props.parentElement)
        expect(body.compareDocumentPosition(props) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
      unmount()
    }
  })

  test('test wide layout removes max width', () => {
    const narrow = layout({ wideLayoutMode: false })
    let content = narrow.container.querySelector('[data-page-content]') as HTMLElement
    expect(content.dataset.wide).toBe('false')
    expect(content.className).toContain('max-w-[var(--page-content-width)]')
    narrow.unmount()

    const wide = layout({ wideLayoutMode: true })
    content = wide.container.querySelector('[data-page-content]') as HTMLElement
    expect(content.dataset.wide).toBe('true')
    expect(content.className).toContain('max-w-none')
    expect(content.className).not.toContain('max-w-[var(--page-content-width)]')
  })

  test('test font serif applies to title and body', () => {
    const { container } = layout({ font: 'serif' })
    const title = container.querySelector('[data-page-title]') as HTMLElement
    const body = container.querySelector('[data-page-body]') as HTMLElement
    expect(title.style.fontFamily).toBe('var(--object-font-serif)')
    expect(body.style.fontFamily).toBe('var(--object-font-serif)')
    expect(title.contains(screen.getByRole('heading', { name: 'Ada' }))).toBe(true)
    expect(body.textContent).toBe('Body text')
  })

  test('test cover renders from fileUrl, cropped and wide per type settings', () => {
    const a = layout({ wideCoverImage: true, cropCoverImage: true }, 'Attachments/cover.png')
    let cover = a.container.querySelector('[data-cover-image]') as HTMLElement
    let img = cover.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(mocked.fileUrl('Attachments/cover.png'))
    expect(cover.dataset.wide).toBe('true')
    expect(cover.dataset.crop).toBe('true')
    expect(img.className).toContain('object-cover')
    // Wide: outside the content column, spanning the panel.
    expect(a.container.querySelector('[data-page-content]')?.contains(cover)).toBe(false)
    a.unmount()

    const b = layout({ wideCoverImage: false, cropCoverImage: false }, 'Attachments/cover.png')
    cover = b.container.querySelector('[data-cover-image]') as HTMLElement
    img = cover.querySelector('img') as HTMLImageElement
    expect(cover.dataset.wide).toBe('false')
    expect(cover.dataset.crop).toBe('false')
    expect(img.className).not.toContain('object-cover')
    expect(img.className).toContain('h-auto')
    expect(b.container.querySelector('[data-page-content]')?.contains(cover)).toBe(true)
  })
})

describe('narrow layouts', () => {
  function sized(width: number, viewDesign: ViewDesign | null = null) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height: 800 } as DOMRect)
    const type = typeDef({ id: 'person', viewDesign })
    const summary = objectSummary({ path: 'People/Ada.md', type: 'person', title: 'Ada' })
    const drawn: PanelVariant[] = []
    const r = render(
      <PageLayout
        type={type}
        summary={summary}
        header={<h1>Ada</h1>}
        properties={(variant) => {
          drawn.push(variant)
          return <aside aria-label="Properties" data-variant={variant}>props</aside>
        }}
        body={<p>Body text</p>}
      />,
    )
    return { ...r, drawn }
  }

  test('test the width rule: the panel sits beside from panel plus minimum content width', () => {
    expect(PROPERTY_PANEL_WIDTH).toBe(370)
    expect(MIN_CONTENT_WIDTH).toBe(480)
    expect(PROPERTIES_BESIDE_WIDTH).toBe(850)
    expect(propertiesBeside(null)).toBe(true)
    expect(propertiesBeside(850)).toBe(true)
    expect(propertiesBeside(849)).toBe(false)
    expect(propertiesBeside(320)).toBe(false)
  })

  test('test a wide standard page keeps the property panel beside the content', () => {
    const { container } = sized(1052)
    const props = screen.getByRole('complementary', { name: 'Properties' })
    expect(props.dataset.variant).toBe('side')
    expect(container.querySelector('[data-page-content]')?.contains(props)).toBe(false)
    expect((container.querySelector('[data-page-layout]') as HTMLElement).dataset.properties).toBe('beside')
  })

  test('test a narrow standard page puts the property panel inline under the title', () => {
    const { container } = sized(752)
    const props = screen.getByRole('complementary', { name: 'Properties' })
    expect(props.dataset.variant).toBe('card')
    const inline = container.querySelector('[data-properties-inline]') as HTMLElement
    expect(inline.contains(props)).toBe(true)
    // Under the header, before the body.
    const title = container.querySelector('[data-page-title]') as HTMLElement
    const body = container.querySelector('[data-page-body]') as HTMLElement
    expect(title.compareDocumentPosition(inline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(inline.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((container.querySelector('[data-page-layout]') as HTMLElement).dataset.properties).toBe('inline')
  })

  test('test other designs keep their own placement when narrow', () => {
    const { container } = sized(500, 'encyclopedia')
    expect(screen.getByRole('complementary', { name: 'Properties' }).dataset.variant).toBe('infobox')
    expect(container.querySelector('[data-properties-inline]')).toBeNull()
    expect((container.querySelector('[data-page-layout]') as HTMLElement).dataset.properties).toBeUndefined()
  })

  test('test the main column has no minimum width rule (the side panel is a share of the card)', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
    expect(css).not.toMatch(/\[data-main-column\][^{]*\{[^}]*min-width/)
  })
})

describe('cover image on the object page', () => {
  const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People', revision: 'r1' })
  const PATH = 'People/Ada.md'
  let onDisk: ObjectDetail

  beforeEach(() => {
    localStorage.clear()
    useTabs.getState().reset()
    usePeek.getState().close()
    resetLinkIndex()
    for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
    onDisk = objectDetail({
      summary: objectSummary({ path: PATH, type: 'person', title: 'Ada' }),
      frontmatter: { type: 'Person', title: 'Ada' },
      body: 'Hello.\n',
      version: 'v1',
    })
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PERSON] } satisfies SpaceInfo)
    mocked.objects.mockResolvedValue([onDisk.summary])
    mocked.object.mockImplementation(async () => onDisk)
    mocked.resolve.mockResolvedValue(null)
    mocked.images.mockResolvedValue([{ path: 'Attachments/cover.png' }])
    mocked.updateProperties.mockImplementation(
      async (_p: string, updates: Record<string, unknown>): Promise<UpdateResult> => ({
        version: 'v2',
        frontmatter: { ...updates },
        links: {},
        synced: [],
        skipped: [],
      }),
    )
    mocked.onChange.mockImplementation((_cb: (e: ChangeEvent) => void) => () => undefined)
  })

  test('test Add cover image then Remove writes coverImage then null', async () => {
    const user = userEvent.setup()
    const { container } = render(<ObjectPage path={PATH} />)
    await screen.findByRole('heading', { level: 1, name: 'Ada' })
    expect(container.querySelector('[data-cover-image]')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Add cover image' }))
    await user.click(await screen.findByRole('button', { name: 'Attachments/cover.png' }))
    await waitFor(() =>
      expect(mocked.updateProperties).toHaveBeenCalledWith(
        PATH,
        { coverImage: 'Attachments/cover.png' },
        'v1',
        undefined,
      ),
    )

    const cover = await waitFor(() => {
      const el = container.querySelector('[data-cover-image]') as HTMLElement | null
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(cover.querySelector('img')?.getAttribute('src')).toBe(mocked.fileUrl('Attachments/cover.png'))
    expect(screen.queryByRole('button', { name: 'Add cover image' })).not.toBeInTheDocument()

    await user.click(within(cover).getByRole('button', { name: 'Remove cover image' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith(PATH, { coverImage: null }, 'v2', undefined))
    await waitFor(() => expect(container.querySelector('[data-cover-image]')).toBeNull())
  })
})
