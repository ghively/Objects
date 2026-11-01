// Audit 2026-11-01 F1: the shell's entry chunk must not carry the pages and libraries it does
// not need at start. A static import of one of these from an entry-reachable module puts the
// code back into the entry (and makes the lazy import elsewhere ineffective), so each boundary
// is checked here at the source. The numbers themselves come from `npx vite build`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const src = (f: string) => readFileSync(join(process.cwd(), 'src', f), 'utf8')
// Value imports only: an `import type` brings no code.
const staticImports = (text: string) => [...text.matchAll(/^import(?!\s+type\b)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
const dynamicImports = (text: string) => [...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])

describe('lazy boundaries of the entry chunk', () => {
  test('App loads the graph, calendar and type settings pages on demand', () => {
    const app = src('App.tsx')
    const lazyOnes = ['@/graph/GraphPage', '@/graph/LocalGraphPanel', '@/calendar/CalendarPage', '@/types/TypeSettings']
    for (const m of lazyOnes) {
      expect(staticImports(app), m).not.toContain(m)
      expect(dynamicImports(app), m).toContain(m)
    }
  })

  test('the whiteboard loads on demand, from one shared lazy module, in the page and in the peek', () => {
    for (const f of ['object/ObjectPage.tsx', 'object/ObjectPeek.tsx']) {
      const text = src(f)
      expect(staticImports(text), f).not.toContain('@/whiteboard/WhiteboardPage')
      expect(staticImports(text), f).not.toContain('@/whiteboard/ink')
      expect(staticImports(text), f).toContain('./WhiteboardLazy')
    }
    const lazy = src('object/WhiteboardLazy.tsx')
    expect(dynamicImports(lazy)).toEqual(expect.arrayContaining(['@/whiteboard/WhiteboardPage', '@/whiteboard/ink']))
    // Type-only: no code.
    expect(staticImports(lazy).filter((m) => m.startsWith('@/whiteboard'))).toEqual([])
  })

  test('raw mode (CodeMirror) and the whiteboard dialog load on demand from the object view', () => {
    const view = src('object/ObjectView.tsx')
    expect(staticImports(view)).not.toContain('@/editor/RawMode')
    expect(dynamicImports(view)).toContain('@/editor/RawMode')
    expect(staticImports(view)).not.toContain('@/whiteboard/AddToWhiteboardDialog')
    expect(dynamicImports(view)).toContain('@/whiteboard/AddToWhiteboardDialog')
    // The find bar asks "is this raw mode's control?" without CodeMirror.
    expect(staticImports(src('find/FindBar.tsx'))).not.toContain('./rawFind')
    expect(staticImports(src('find/findControl.ts')).some((m) => m.startsWith('@codemirror'))).toBe(false)
  })

  test('the settings modal, shortcuts sheet and whiteboard dialog load on demand from the overlays', () => {
    const overlays = src('shell/GlobalOverlays.tsx')
    for (const m of ['@/settings/SettingsModal', '@/settings/ShortcutsSheet', '@/whiteboard/AddToWhiteboardDialog']) {
      expect(staticImports(overlays), m).not.toContain(m)
      expect(dynamicImports(overlays), m).toContain(m)
    }
  })

  test("the shell's calendar-sidebar shortcut needs none of the calendar page", () => {
    expect(staticImports(src('shell/shortcuts.ts'))).not.toContain('@/calendar/CalendarPage')
  })

  test('the build warns at the default chunk size again', () => {
    const config = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8')
    expect(config).not.toMatch(/chunkSizeWarningLimit/)
    expect(config).toMatch(/codeSplitting/)
  })
})
