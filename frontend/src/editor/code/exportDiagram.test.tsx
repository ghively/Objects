import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PNG_SCALE, svgSize, svgToPng } from './exportDiagram'
import { MermaidPreview } from './MermaidPreview'

const RENDERED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" style="max-width: 120px;"><foreignObject><div>A</div></foreignObject></svg>'
const EXPORTED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text>A</text></svg>'

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))
vi.mock('mermaid', () => ({ default: mermaid }))

// Downloads: capture what each temporary link would save.
type Saved = { name: string; blob: Blob }
let saved: Saved[] = []
const blobs = new Map<string, Blob>()
let urlSeq = 0

// Canvas and image: jsdom draws nothing, so record the calls.
const drawImage = vi.fn()
let lastCanvas: { width: number; height: number } | null = null
let imageSrcs: string[] = []

beforeEach(() => {
  saved = []
  imageSrcs = []
  blobs.clear()
  drawImage.mockClear()
  mermaid.initialize.mockClear()
  mermaid.render.mockReset()
  mermaid.render.mockImplementation(async () => ({ svg: RENDERED }))
  URL.createObjectURL = vi.fn((b: Blob) => {
    const url = `blob:test/${++urlSeq}`
    blobs.set(url, b)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.get(this.href)! })
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    lastCanvas = this
    return { drawImage } as unknown as CanvasRenderingContext2D
  } as unknown as HTMLCanvasElement['getContext'])
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
    cb(new Blob(['png'], { type }))
  })
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(v: string) {
        imageSrcs.push(v)
        setTimeout(() => this.onload?.(), 0)
      }
    },
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mermaid export', () => {
  test('test mermaid svg export', async () => {
    render(<MermaidPreview text="graph TD; A-->B" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download as SVG' }))
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('diagram.svg')
    expect(saved[0].blob.type).toBe('image/svg+xml;charset=utf-8')
    const text = await saved[0].blob.text()
    expect(text).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n${RENDERED}`)
    // The SVG is the one already rendered: no second render.
    expect(mermaid.render).toHaveBeenCalledTimes(1)
  })

  test('test mermaid png export draws the svg', async () => {
    render(<MermaidPreview text="graph TD; A-->B" />)
    await screen.findByRole('button', { name: 'Download as PNG' })
    mermaid.render.mockImplementationOnce(async () => ({ svg: EXPORTED }))
    fireEvent.click(screen.getByRole('button', { name: 'Download as PNG' }))
    await waitFor(() => expect(saved).toHaveLength(1))

    // The export render is strict, themed and without HTML labels; the preview config comes back after.
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', theme: 'dark', htmlLabels: false, flowchart: { htmlLabels: false } }),
    )
    expect(mermaid.initialize).toHaveBeenLastCalledWith({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
    expect(mermaid.render).toHaveBeenLastCalledWith(expect.stringMatching(/^mermaid-export-/), 'graph TD; A-->B')

    // The exported SVG is drawn at 2x on a canvas and saved as PNG.
    expect(imageSrcs).toHaveLength(1)
    const drawn = decodeURIComponent(imageSrcs[0].replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
    expect(drawn).toContain('<text>A</text>')
    expect(drawn).toContain('width="120"')
    expect(drawn).toContain('height="40"')
    expect(lastCanvas).toMatchObject({ width: 120 * PNG_SCALE, height: 40 * PNG_SCALE })
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 240, 80)
    expect(saved[0].name).toBe('diagram.png')
    expect(saved[0].blob.type).toBe('image/png')
  })

  test('svg size reads width and height, then the view box', async () => {
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"/>')).toEqual({ width: 50, height: 20 })
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 30 10"/>')).toEqual({ width: 30, height: 10 })
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="60" viewBox="0 0 30 10"/>')).toEqual({ width: 60, height: 20 })
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg"/>')).toEqual({ width: 300, height: 150 })
    const png = await svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"/>', 3)
    expect(png.type).toBe('image/png')
    expect(lastCanvas).toMatchObject({ width: 30, height: 15 })
  })

  test('no export buttons before a diagram renders', async () => {
    mermaid.render.mockRejectedValueOnce(new Error('Parse error'))
    render(<MermaidPreview text="nonsense" />)
    expect(await screen.findByText('Diagram rendering error')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download as SVG' })).toBeNull()
    render(<MermaidPreview text="  " />)
    expect(screen.queryByRole('button', { name: 'Download as PNG' })).toBeNull()
  })
})
