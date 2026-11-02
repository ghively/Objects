// The generated Phosphor subset (`appIcons.ts`, by `scripts/app-icons.mjs`) holds every `ph-…` id
// the app's code references, and is what the generator produces today (audit 2026-11-01 F3).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { appIcons } from './appIcons'

// The generator is plain Node (no bundling), imported from the repo for the same build in-process.
const generator = () => import('../../scripts/app-icons.mjs')

describe('app icons subset', () => {
  test('every ph- id referenced in src/ that the Phosphor set has is in the subset', async () => {
    const { referencedPhIds, loadPhosphor } = await generator()
    const full = loadPhosphor()
    const have = (name: string) => !!appIcons.icons[name] || !!appIcons.aliases?.[name]
    const exists = (name: string) => !!full.icons[name] || !!full.aliases?.[name]
    const referenced = referencedPhIds(join(process.cwd(), 'src')) as string[]
    expect(referenced.length).toBeGreaterThan(150)
    const missing = referenced.filter((name) => exists(name) && !have(name))
    expect(missing, 'run node scripts/app-icons.mjs').toEqual([])
    // The fallback is always there, and the subset is a Phosphor set.
    expect(have('cube')).toBe(true)
    expect(appIcons.prefix).toBe('ph')
    expect(appIcons.width).toBe(full.width)
  })

  test('the checked-in file is what the generator writes (deterministic)', async () => {
    const { generate } = await generator()
    const { text } = await generate()
    // Git may check the file out with CRLF (Windows autocrlf); the generator always writes LF.
    const current = readFileSync(join(process.cwd(), 'src', 'icons', 'appIcons.ts'), 'utf8').replace(/\r\n/g, '\n')
    expect(current).toBe(text)
    // Small: the point of the subset.
    expect(text.length).toBeLessThan(200_000)
  }, 20000)
})
