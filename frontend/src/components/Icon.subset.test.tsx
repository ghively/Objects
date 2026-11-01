/// <reference types="node" />
// Audit 2026-11-01 F3: the app's own icons draw from the bundled subset without the 4.4 MB
// Phosphor set; a user-chosen icon loads the full set once and is remembered for the next start.
import { render, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

let phLoads = 0
async function iconSet(pkg: string) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const file = path.resolve(process.cwd(), 'node_modules', pkg, 'icons.json')
  return { default: JSON.parse(fs.readFileSync(file, 'utf8')) }
}
vi.mock('@iconify-json/ph/icons.json', async () => {
  phLoads++
  return iconSet('@iconify-json/ph')
})
vi.mock('@iconify-json/vscode-icons/icons.json', () => iconSet('@iconify-json/vscode-icons'))

beforeEach(() => {
  vi.resetModules()
  phLoads = 0
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
})

const mod = () => import('./Icon')

describe('Icon with the app subset', () => {
  test('an app icon and the fallback draw on the first render without loading the full set', async () => {
    const { Icon, resolveIconSync } = await mod()
    expect(resolveIconSync('ph-graph')?.resolved).toBe('ph:graph')
    const html = renderToString(<Icon name="ph-graph" />)
    expect(html).toContain('<svg')
    expect(html).toContain('data-resolved="ph:graph"')
    // A `prefix:` id whose prefix is not bundled falls back at once (the fallback is in the subset).
    const unknown = renderToString(<Icon name="mdi:home-variant" />)
    expect(unknown).toContain('data-resolved="ph:cube"')
    expect(unknown).toContain('title="mdi:home-variant"')
    await new Promise((r) => setTimeout(r, 20))
    expect(phLoads).toBe(0)
  })

  test('a user-chosen icon outside the subset loads the full set once and is remembered', async () => {
    const { Icon, resolveIconSync } = await mod()
    expect(resolveIconSync('ph-alien')).toBeUndefined() // not at hand yet
    const first = render(<Icon name="ph-alien" />)
    await waitFor(() => expect(first.container.querySelector('svg')?.dataset.resolved).toBe('ph:alien'), { timeout: 10000 })
    render(<Icon name="ph-alien-fill" />)
    await waitFor(() => expect(document.querySelector('[data-resolved="ph:alien-fill"]')).not.toBeNull(), { timeout: 10000 })
    expect(phLoads).toBe(1)
    const stored = JSON.parse(localStorage.getItem('object.icons') ?? '{}') as Record<string, unknown>
    expect(Object.keys(stored)).toEqual(['ph:alien', 'ph:alien-fill'])

    // The next start (a fresh module): drawn at once from what was remembered, no load.
    vi.resetModules()
    phLoads = 0
    // Loading the full set now would be a wasted 4.4 MB: make it fail loudly.
    vi.doMock('@iconify-json/ph/icons.json', () => {
      throw new Error('the full Phosphor set was loaded for a remembered icon')
    })
    try {
      const fresh = await mod()
      expect(fresh.resolveIconSync('ph-alien')?.resolved).toBe('ph:alien')
      expect(renderToString(<fresh.Icon name="ph-alien" />)).toContain('data-resolved="ph:alien"')
      // Review fix 2026-11-01 #6: the async resolver takes the remembered icon too, without the load.
      expect((await fresh.resolveIcon('ph-alien'))?.resolved).toBe('ph:alien')
      expect(phLoads).toBe(0)
    } finally {
      vi.doMock('@iconify-json/ph/icons.json', async () => {
        phLoads++
        return iconSet('@iconify-json/ph')
      })
    }
  }, 20000)

  test('an id the full set does not have falls back to ph-cube after the load', async () => {
    const { Icon } = await mod()
    const { container } = render(<Icon name="ph-no-such-icon-xyz" />)
    await waitFor(() => expect(container.querySelector('svg')?.dataset.resolved).toBe('ph:cube'), { timeout: 10000 })
    expect(container.querySelector('svg')?.getAttribute('title')).toBe('ph-no-such-icon-xyz')
    expect(localStorage.getItem('object.icons')).toBeNull()
  }, 20000)
})
