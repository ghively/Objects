/**
 * Round trip over a whole space (Task 19 runs it): set `OBJECT_ROUNDTRIP_SPACE`
 * to a folder (a copy of a space). For every `.md` under it, the body loads
 * into a headless editor and serializes byte-identical; for every annotated
 * leaf and container, toggling one option on and off again gives the
 * identical bytes. Skipped when the variable is unset.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'

const ROOT = process.env.OBJECT_ROUNDTRIP_SPACE

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full))
    else if (name.toLowerCase().endsWith('.md')) out.push(full)
  }
  return out.sort()
}

/** M1's split (`objfile.split_object` over `textfile`'s decoding): BOM off, LF line ends, frontmatter off. */
function bodyOf(text: string): string {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const first = t.split('\n', 1)[0]
  if (first !== '---' || !t.includes('\n')) return t
  let pos = 4
  while (pos <= t.length) {
    const nl = t.indexOf('\n', pos)
    const end = nl < 0 ? t.length : nl
    if (t.slice(pos, end) === '---') return nl < 0 ? '' : t.slice(nl + 1)
    if (nl < 0) break
    pos = nl + 1
  }
  return t // an unterminated fence: the whole text is the body
}

/** A known option that is not set yet and applies to the node, to toggle on and off. */
const PROBE: Record<string, [string, string | true]> = {
  paragraph: ['align', 'center'],
  heading: ['align', 'center'],
  bulletList: ['color', 'text-red'],
  orderedList: ['color', 'text-red'],
  taskList: ['color', 'text-red'],
  blockquote: ['quote', 'standout'],
  codeBlock: ['wrap', true],
  table: ['header-column', true],
  mathBlock: ['align', 'center'],
  media: ['caption', 'probe'],
  objectEmbed: ['view', 'embed'],
  bookmark: ['zz-probe', true],
  toggle: ['zz-probe', true],
  group: ['zz-probe', true],
  columns: ['zz-probe', true],
}

describe.skipIf(!ROOT)('round trip over OBJECT_ROUNDTRIP_SPACE', () => {
  test('every body serializes byte-identical, with and without an option toggled', () => {
    const files = markdownFiles(ROOT!)
    let annotated = 0
    const differences: string[] = []
    for (const file of files) {
      const body = bodyOf(readFileSync(file, 'utf8'))
      const editor = new TiptapEditor({ extensions: editorExtensions() })
      try {
        loadBody(editor, body)
        if (serializeBody(editor) !== body) {
          differences.push(`${file}: no-edit save differs`)
          continue
        }
        const targets: number[] = []
        editor.state.doc.descendants((node, pos) => {
          if (node.attrs.blockAnnotation != null || node.attrs.containerOpen != null) targets.push(pos)
          return true
        })
        for (const pos of targets) {
          annotated++
          const node = editor.state.doc.nodeAt(pos)!
          const probe = PROBE[node.type.name] ?? ['zz-probe', true]
          const existing = ((node.attrs.blockOptions ?? []) as { key: string }[]).some((o) => o.key === probe[0])
          const key = existing ? 'zz-probe' : probe[0]
          editor.commands.setBlockOption(key, existing ? true : probe[1], pos)
          editor.commands.setBlockOption(key, null, pos)
          if (serializeBody(editor) !== body) differences.push(`${file}: toggling ${key} at ${pos} differs`)
        }
      } finally {
        editor.destroy()
      }
    }
    process.stderr.write(`${files.length} files, ${annotated} annotated blocks, ${differences.length} differences\n`)
    expect(differences).toEqual([])
  })
})
