import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { TOOL_LABEL, WB, t } from './strings'
import { TOOLS } from './model'

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, '../../../docs/strings.txt'),
  'utf8',
)

type Msg = { t?: number; b?: Msg; s?: string; i?: { t: number; v?: string; k?: string }[] }

/** The compiled message tree (`var e={…};export{e as t}`), read as data. */
function messages(): Record<string, unknown> {
  const start = SOURCE.indexOf('var e={') + 'var e='.length
  const end = SOURCE.lastIndexOf(';export{')
  return new Function(`return (${SOURCE.slice(start, end)})`)() as Record<string, unknown>
}

function textOf(m: Msg): string {
  const body = m.b ?? m
  if (body.s) return body.s
  return (body.i ?? []).map((x) => (x.t === 3 ? (x.v ?? '') : x.t === 4 ? `{${x.k}}` : '')).join('')
}

const TREE = messages()

function lookup(key: string): string | undefined {
  let node: unknown = TREE
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node && typeof node === 'object' && 'b' in node ? textOf(node as Msg) : undefined
}

describe('whiteboard strings', () => {
  test('test every reference string exists verbatim in the strings file', () => {
    const referenced = Object.entries(WB).filter(([, v]) => v.ref !== 'ours')
    expect(referenced.length).toBeGreaterThan(100)
    for (const [name, { text, ref }] of referenced) {
      expect(lookup(ref), `${name} (${ref})`).toBe(text)
      // And verbatim as a compiled message text.
      expect(SOURCE.includes(`s:\`${text}\``), `${name} verbatim`).toBe(true)
    }
  })

  test('test our strings are marked ours and are not Object strings by accident', () => {
    const ours = Object.entries(WB).filter(([, v]) => v.ref === 'ours')
    expect(ours.map(([k]) => k).sort()).toEqual(['changedElsewhere', 'newerVersion', 'pickType', 'readOnly', 'saveFailed', 'searchObjects'])
    expect(t('newerVersion')).toBe('This whiteboard was saved by a newer version of Object.')
    expect(t('changedElsewhere')).toBe('Changed elsewhere. Reloaded.')
  })

  test('test every tool has a label', () => {
    for (const tool of TOOLS) expect(TOOL_LABEL[tool].text.length).toBeGreaterThan(0)
    expect(TOOL_LABEL.select.text).toBe('Move')
    expect(TOOL_LABEL.link.text).toBe('Existing object')
    expect(TOOL_LABEL.blockArrow.text).toBe('Arrow right')
  })
})
