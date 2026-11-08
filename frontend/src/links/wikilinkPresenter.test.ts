import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { usePeek, useTabs, type Target } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { objectSummary, typeDef } from '@/test/mockApi'
import { resetLinkIndex } from './linkIndex'
import { presentWikilink } from './wikilinkPresenter'

const mocked = vi.mocked(api)
const objT = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetLinkIndex()
  useTabs.getState().reset()
  usePeek.getState().close()
  useSettings.setState({ settings: settingsDefaults })
  mocked.space.mockResolvedValue({
    name: 'space',
    root: '/space',
    types: [typeDef({ id: 'page', color: 'blue', icon: { type: 'iconify', val: 'ph-file-text' } })],
    icon: null,
    description: null,
    hideTaskManagement: false,
    revision: '',
  })
  mocked.objects.mockResolvedValue([objectSummary({ path: 'Pages/Beta.md', type: 'page', title: 'Beta' })])
  mocked.resolve.mockResolvedValue('Pages/Beta.md')
})

/** A chip inside an object's body, presented and resolved. */
async function chip() {
  const host = document.createElement('div')
  host.setAttribute('data-object-path', 'Pages/Alpha.md')
  const dom = document.createElement('span')
  dom.textContent = 'Beta'
  host.appendChild(dom)
  document.body.appendChild(host)
  const cleanup = presentWikilink(dom, { target: 'Beta', label: null })
  await vi.waitFor(() => expect(dom.getAttribute('data-resolved-path')).toBe('Pages/Beta.md'))
  return { dom, cleanup }
}

function icon(dom: HTMLElement) {
  return dom.querySelector(':scope > [data-wikilink-icon]')
}

describe('wikilink presenter', () => {
  test('test wikilink new-tab opens and peek open-as-page go via link', async () => {
    s().open(objT('Pages/Alpha.md'))
    const { dom, cleanup } = await chip()
    const open = vi.spyOn(useTabs.getState(), 'open')

    // A plain click keeps M1's peek.
    dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(usePeek.getState().path).toBe('Pages/Beta.md')
    expect(open).not.toHaveBeenCalled()
    usePeek.getState().close()

    // Ctrl+click and middle-click open a new tab, as a link.
    dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
    expect(open).toHaveBeenLastCalledWith(objT('Pages/Beta.md'), { newTab: true, via: 'link' })
    dom.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    expect(open).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenLastCalledWith(objT('Pages/Beta.md'), { newTab: true, via: 'link' })
    open.mockRestore()

    // The new tab carries the trail: Alpha › Beta.
    const tab = s().tabs[s().tabs.length - 1]
    expect(tab.crumbs).toEqual([[objT('Pages/Alpha.md')]])
    cleanup?.()
  })

  test('test inline link icon follows the setting', async () => {
    const { dom, cleanup } = await chip()
    // Shown by default: the type's icon in front of the title.
    await vi.waitFor(() => expect(icon(dom)).not.toBeNull())
    expect(dom.firstChild).toBe(icon(dom))
    expect(icon(dom)!.querySelector('svg')).not.toBeNull()
    expect(icon(dom)).toHaveAttribute('aria-hidden', 'true')
    expect(dom.textContent).toBe('Beta')

    // "Type icons on inline links" off: gone, and back when turned on.
    useSettings.setState({ settings: { ...settingsDefaults, hideEntityIconsOnInlineLinks: true } })
    await vi.waitFor(() => expect(icon(dom)).toBeNull())
    useSettings.setState({ settings: { ...settingsDefaults, hideEntityIconsOnInlineLinks: false } })
    await vi.waitFor(() => expect(icon(dom)).not.toBeNull())

    cleanup?.()
    expect(icon(dom)).toBeNull()
  })

  test('test hidden icon setting applies when the chip is first presented', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, hideEntityIconsOnInlineLinks: true } })
    const { dom, cleanup } = await chip()
    await new Promise((r) => setTimeout(r, 20))
    expect(icon(dom)).toBeNull()
    cleanup?.()
  })

  test('test unresolved links have no icon', async () => {
    mocked.resolve.mockResolvedValue(null)
    const dom = document.createElement('span')
    document.body.appendChild(dom)
    const cleanup = presentWikilink(dom, { target: 'Nope', label: null })
    await vi.waitFor(() => expect(dom).toHaveAttribute('data-unresolved'))
    await new Promise((r) => setTimeout(r, 20))
    expect(icon(dom)).toBeNull()
    cleanup?.()
  })
})
