/// <reference types="node" />
import { render, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { Icon, iconName } from './Icon'

// The real bundled icon sets, read straight from disk: pushing these multi-MB JSON files through
// the module transform costs seconds of CPU and slows timing-sensitive tests running alongside.
async function iconSet(pkg: string) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const file = path.resolve(process.cwd(), 'node_modules', pkg, 'icons.json')
  return { default: JSON.parse(fs.readFileSync(file, 'utf8')) }
}
vi.mock('@iconify-json/ph/icons.json', () => iconSet('@iconify-json/ph'))
vi.mock('@iconify-json/vscode-icons/icons.json', () => iconSet('@iconify-json/vscode-icons'))

function svgOf(container: HTMLElement): Promise<SVGElement> {
  return waitFor(() => {
    const svg = container.querySelector('svg')
    if (!svg) throw new Error('not rendered yet')
    return svg
  }, { timeout: 10000 })
}

describe('Icon', () => {
  test('test Icon renders vscode-icons-file-type-excel offline and unknown prefix falls back', async () => {
    const fetched: unknown[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = ((...args: unknown[]) => {
      fetched.push(args)
      return Promise.reject(new Error('offline'))
    }) as typeof fetch
    try {
      const excel = render(<Icon name="vscode-icons-file-type-excel" />)
      const svg = await svgOf(excel.container)
      expect(svg.dataset.resolved).toBe('vscode-icons:file-type-excel')
      expect(svg.dataset.icon).toBe('vscode-icons-file-type-excel')
      expect(svg.getAttribute('title')).toBeNull()

      const colon = render(<Icon name="vscode-icons:file-type-word" />)
      expect((await svgOf(colon.container)).dataset.resolved).toBe('vscode-icons:file-type-word')

      const ph = render(<Icon name="ph-check-circle" />)
      expect((await svgOf(ph.container)).dataset.resolved).toBe('ph:check-circle')

      const unknown = render(<Icon name="mdi-home-variant" />)
      const fallback = await svgOf(unknown.container)
      expect(fallback.dataset.resolved).toBe('ph:cube')
      expect(fallback.dataset.icon).toBe('mdi-home-variant')
      expect(fallback.getAttribute('title')).toBe('mdi-home-variant')

      expect(fetched).toEqual([])
    } finally {
      globalThis.fetch = realFetch
    }
  }, 20000)

  test('a loaded icon draws on its first render, never as a bare span', async () => {
    await svgOf(render(<Icon name="ph-graph" />).container)
    // The first render (no effects run) already carries the icon; Iconify's default first render
    // is an empty <span>, which left a tab's icon briefly without data-icon or size.
    const html = renderToString(<Icon name="ph-graph" />)
    expect(html).toContain('<svg')
    expect(html).toContain('data-icon="ph-graph"')
  }, 20000)

  test('iconName reads an Icon, a string or nothing', () => {
    expect(iconName({ type: 'iconify', val: 'ph-check-circle' }, 'ph-cube')).toBe('ph-check-circle')
    expect(iconName('ph-user', 'ph-cube')).toBe('ph-user')
    expect(iconName(null, 'ph-cube')).toBe('ph-cube')
    expect(iconName({ type: 'iconify', val: '' }, 'ph-file-text')).toBe('ph-file-text')
  })
})
