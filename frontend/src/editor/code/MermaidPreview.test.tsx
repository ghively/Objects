import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MermaidPreview } from './MermaidPreview'

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, text: string) => ({ svg: `<svg data-testid="diagram"><text>${text.length}</text></svg>` })),
}))
vi.mock('mermaid', () => ({ default: mermaid }))

beforeEach(() => {
  mermaid.initialize.mockClear()
  mermaid.render.mockClear()
})
afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
})

describe('MermaidPreview', () => {
  test('mermaid renders strict with the theme and shows empty and error states', async () => {
    const { rerender } = render(<MermaidPreview text="graph TD; A-->B" />)
    await screen.findByTestId('diagram')
    expect(mermaid.initialize).toHaveBeenLastCalledWith({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
    expect(mermaid.render).toHaveBeenLastCalledWith(expect.stringMatching(/^mermaid-/), 'graph TD; A-->B')

    rerender(<MermaidPreview text="   " />)
    expect(await screen.findByText('Write a Mermaid diagram to see the preview')).toBeInTheDocument()

    mermaid.render.mockRejectedValueOnce(new Error('Parse error on line 1'))
    rerender(<MermaidPreview text="nonsense" />)
    expect(await screen.findByText('Diagram rendering error')).toBeInTheDocument()
    expect(screen.getByText('Parse error on line 1')).toBeInTheDocument()
  })

  test('light themes use the default mermaid theme', async () => {
    document.documentElement.setAttribute('data-theme', 'lightDimmed')
    render(<MermaidPreview text="graph LR; A-->B" />)
    await screen.findByTestId('diagram')
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'default' }))
  })

  test('mermaid rerenders on theme change', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    render(<MermaidPreview text="graph TD; A-->B" />)
    await screen.findByTestId('diagram')
    expect(mermaid.render).toHaveBeenCalledTimes(1)
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'light')
    })
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2))
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'default' }))

    // Dark Dimmed is a dark theme too.
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'darkDimmed')
    })
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(3))
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))
  })
})
