// Polish item 6: rem-based editor sizing from a 15.5px root, and the text size (zoom).
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import { applyZoom, nextZoom, ZOOM_CACHE_KEY, ZOOM_MAX, ZOOM_MIN, zoomPercent } from './zoom'

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const tokensCss = strip(readFileSync(`${process.cwd()}/src/theme/tokens.css`, 'utf8'))
const editorCss = strip(readFileSync(`${process.cwd()}/src/editor/editor.css`, 'utf8'))

afterEach(() => {
  document.documentElement.style.removeProperty('--app-zoom')
  localStorage.clear()
})

describe('zoom steps', () => {
  test('test zoom in and out step by 0.05 and reset goes to 1', () => {
    expect(nextZoom(1, 'in')).toBe(1.05)
    expect(nextZoom(1.05, 'out')).toBe(1)
    expect(nextZoom(1.3, 'reset')).toBe(1)
    expect(nextZoom(0.9, 'out')).toBe(0.85)
  })

  test('test zoom stops before 1.5 going in and before 0.6 going out', () => {
    // The step that would reach 1.5 or 0.6 is refused.
    expect(nextZoom(1.45, 'in')).toBe(1.45)
    expect(nextZoom(0.65, 'out')).toBe(0.65)
    expect(ZOOM_MIN).toBe(0.6)
    expect(ZOOM_MAX).toBe(1.5)
  })

  test('test zoom percent is rounded', () => {
    expect(zoomPercent(1)).toBe('100%')
    expect(zoomPercent(1.05)).toBe('105%')
    expect(zoomPercent(0.85)).toBe('85%')
  })
})

describe('applyZoom', () => {
  test('test applyZoom sets the css variable and caches it for the first paint', () => {
    applyZoom(1.1)
    expect(document.documentElement.style.getPropertyValue('--app-zoom')).toBe('1.1')
    expect(localStorage.getItem(ZOOM_CACHE_KEY)).toBe('1.1')
    applyZoom(1)
    expect(document.documentElement.style.getPropertyValue('--app-zoom')).toBe('')
    expect(localStorage.getItem(ZOOM_CACHE_KEY)).toBeNull()
  })

  test('test applyZoom ignores a value outside the range', () => {
    applyZoom(7)
    expect(document.documentElement.style.getPropertyValue('--app-zoom')).toBe('')
  })
})

describe('root and editor sizing CSS', () => {
  test('test the root is 15.5px from 640px up', () => {
    // @media (min-width:640px){html{font-size:96.875%}}
    expect(tokensCss).toMatch(/@media \(min-width: 640px\)\s*{\s*html\s*{\s*font-size: 96\.875%;/)
  })

  test('test the note body is 1rem scaled by the zoom on a 1.5 line', () => {
    expect(editorCss).toMatch(/\.object-body-text\s*{\s*font-size: calc\(1rem \* var\(--app-zoom, 1\)\);/)
    expect(editorCss).toMatch(/\.object-editor\s*{[^}]*line-height: 1\.5;/)
    expect(editorCss).not.toMatch(/17px/)
  })
})
