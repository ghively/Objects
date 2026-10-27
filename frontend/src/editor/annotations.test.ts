import { marked } from 'marked'
import { describe, expect, test } from 'vitest'
import {
  KNOWN_OPTIONS,
  classifyEmbedLine,
  findInlineMath,
  formatAnnotation,
  isKnownValue,
  makeOption,
  optionsEqual,
  parseAnnotation,
  singleLink,
  type Annotation,
} from './annotations'

const keys = (a: Annotation | null) => a?.options.map((o) => [o.key, o.value])

describe('annotation lines', () => {
  test('annotation line lexes as its own html token', () => {
    // Regression guard (green from the start): the design relies on marked
    // lexing a comment line as a separate html token, even between blocks.
    const tokens = marked.lexer('para\n<!-- block: color=bg-red -->\n## Head\n<!-- column -->\n<!-- /columns -->\n', {
      gfm: true,
    })
    expect(tokens.map((t) => [t.type, t.raw])).toEqual([
      ['paragraph', 'para\n'],
      ['html', '<!-- block: color=bg-red -->\n'],
      ['heading', '## Head\n'],
      ['html', '<!-- column -->\n'],
      ['html', '<!-- /columns -->\n'],
    ])
    // Followed by a blank line, the comment's raw has no line break.
    const detached = marked.lexer('<!-- block: small -->\n\ntext\n', { gfm: true })
    expect(detached.map((t) => [t.type, t.raw])).toEqual([
      ['html', '<!-- block: small -->'],
      ['space', '\n\n'],
      ['paragraph', 'text\n'],
    ])
  })

  test('parse leaf, open, separator, close and reject ordinary comments', () => {
    expect(parseAnnotation('<!-- block: color=bg-blue align=center -->')).toEqual({
      type: 'leaf',
      options: [
        { key: 'color', value: 'bg-blue', raw: 'color=bg-blue' },
        { key: 'align', value: 'center', raw: 'align=center' },
      ],
    })
    expect(parseAnnotation('<!-- toggle open -->\n')).toEqual({
      type: 'open',
      name: 'toggle',
      options: [{ key: 'open', value: true, raw: 'open' }],
    })
    expect(parseAnnotation('<!-- group -->')).toEqual({ type: 'open', name: 'group', options: [] })
    expect(keys(parseAnnotation('<!-- columns widths=40,60 layout=grid -->'))).toEqual([
      ['widths', '40,60'],
      ['layout', 'grid'],
    ])
    expect(parseAnnotation('<!-- column -->\r\n')).toEqual({ type: 'separator', options: [] })
    for (const name of ['toggle', 'group', 'columns'] as const) {
      expect(parseAnnotation(`<!-- /${name} -->`)).toEqual({ type: 'close', name, options: [] })
    }
    expect(parseAnnotation('<!-- block: -->')).toEqual({ type: 'leaf', options: [] })

    for (const line of [
      '<!-- TODO: tidy -->',
      '<!-- callout -->',
      '<!-- /callout -->',
      '<!-- block -->',
      '<!-- column 2 -->',
      '<!-- /toggle open -->',
      '<!-- togglex -->',
      '<!-- toggle-x -->',
      '<!-- a --> trailing text',
      '<!-- block: Color=red -->',
      '<!-- block: color="unterminated -->',
      '<!-- block: a="x"b -->',
      '<!-- block: a=b=c -->',
      '<!-- block: caption="bad \\escape" -->',
      '    <!-- block: small -->',
      '<!-- block: small --> <!-- more -->',
      '<!-- block: small -->\n\n',
      'text <!-- block: small -->',
      '<!--\nblock: small\n-->',
      '',
    ]) {
      expect(parseAnnotation(line), line).toBeNull()
    }
  })

  test('lenient spellings parse and keep their text', () => {
    const tight = parseAnnotation('<!--block:color=bg-red-->')
    expect(tight?.type).toBe('leaf')
    expect(tight?.options).toEqual([{ key: 'color', value: 'bg-red', raw: 'color=bg-red' }])

    const upper = parseAnnotation('<!--   TOGGLE   open-->')
    expect(upper).toEqual({ type: 'open', name: 'toggle', options: [{ key: 'open', value: true, raw: 'open' }] })

    const spaced = parseAnnotation('   <!--   BLOCK:   small    wrap   -->  \t\n')
    expect(spaced?.type).toBe('leaf')
    expect(spaced?.options.map((o) => o.raw)).toEqual(['small', 'wrap'])

    expect(parseAnnotation('<!--/Columns-->')).toEqual({ type: 'close', name: 'columns', options: [] })
    expect(parseAnnotation('<!--COLUMN-->')).toEqual({ type: 'separator', options: [] })

    // Keys and values are case-sensitive: an upper-case value is simply unknown, and kept.
    const odd = parseAnnotation('<!-- block: color=BG-RED caption = -->')
    expect(odd).toBeNull() // `caption =` is not an option (no spaces around `=`)
    const kept = parseAnnotation('<!-- block: color=BG-RED -->')
    expect(kept?.options[0]).toEqual({ key: 'color', value: 'BG-RED', raw: 'color=BG-RED' })
    expect(isKnownValue(kept!.options[0])).toBe(false)

    // `raw` is the exact input text of each option.
    const quoted = parseAnnotation('<!-- block: caption="A \\"tiny\\" pixel" width=120 -->')
    expect(quoted?.options).toEqual([
      { key: 'caption', value: 'A "tiny" pixel', raw: 'caption="A \\"tiny\\" pixel"' },
      { key: 'width', value: '120', raw: 'width=120' },
    ])
  })

  test('canonical format orders options and quotes values', () => {
    const a = parseAnnotation('<!--block: caption=Rack width=480 align=center color=bg-blue small-->')!
    expect(formatAnnotation(a)).toBe('<!-- block: small color=bg-blue align=center width=480 caption="Rack" -->')
    expect(formatAnnotation({ type: 'leaf', options: [] })).toBe('<!-- block: -->')
    expect(formatAnnotation(parseAnnotation('<!--TOGGLE open-->')!)).toBe('<!-- toggle open -->')
    expect(formatAnnotation(parseAnnotation('<!-- columns layout=grid widths=33,33,34 -->')!)).toBe(
      '<!-- columns widths=33,33,34 layout=grid -->',
    )
    expect(formatAnnotation({ type: 'open', name: 'group', options: [] })).toBe('<!-- group -->')
    expect(formatAnnotation({ type: 'separator', options: [] })).toBe('<!-- column -->')
    expect(formatAnnotation({ type: 'close', name: 'columns', options: [] })).toBe('<!-- /columns -->')
    // An emoji icon is not a bare value, so it is quoted; an Iconify id is bare.
    expect(formatAnnotation({ type: 'leaf', options: [makeOption('icon', '⭐')] })).toBe('<!-- block: icon="⭐" -->')
    expect(formatAnnotation({ type: 'leaf', options: [makeOption('icon', 'ph-star')] })).toBe(
      '<!-- block: icon=ph-star -->',
    )
    // A value can never hold a line break or end the comment early.
    const line = formatAnnotation({ type: 'leaf', options: [makeOption('caption', 'a\nb --> c')] })
    expect(line).toBe('<!-- block: caption="a b -- > c" -->')
    expect(parseAnnotation(line)?.options[0].value).toBe('a b -- > c')
    // Canonical output parses back to the same options.
    expect(optionsEqual(parseAnnotation(formatAnnotation(a))!.options, a.options)).toBe(true)
  })

  test('caption with quotes and backslashes round trips', () => {
    for (const caption of ['A "tiny" pixel', 'C:\\path\\file', 'ends with \\', '""', '', 'mixed \\" both']) {
      const line = formatAnnotation({ type: 'leaf', options: [makeOption('caption', caption)] })
      const back = parseAnnotation(line)
      expect(back?.options, line).toEqual([{ key: 'caption', value: caption, raw: line.slice(12, -4) }])
    }
  })

  test('unknown options and values are kept in order', () => {
    const a = parseAnnotation('<!-- block: zeta=1 color=bg-purplish alpha="x y" align=center beta -->')!
    expect(a.options.map((o) => o.key)).toEqual(['zeta', 'color', 'alpha', 'align', 'beta'])
    expect(isKnownValue(a.options[1])).toBe(false) // unknown value of a known key: kept, not applied
    expect(formatAnnotation(a)).toBe('<!-- block: color=bg-purplish align=center zeta=1 alpha="x y" beta -->')
    // Known options compare as a set, unknown ones in order.
    const swappedKnown = parseAnnotation('<!-- block: align=center zeta=1 alpha="x y" color=bg-purplish beta -->')!
    expect(optionsEqual(a.options, swappedKnown.options)).toBe(true)
    const swappedUnknown = parseAnnotation('<!-- block: alpha="x y" zeta=1 color=bg-purplish align=center beta -->')!
    expect(optionsEqual(a.options, swappedUnknown.options)).toBe(false)
    expect(optionsEqual(a.options, a.options.slice(1))).toBe(false)
    // Quoting is not part of equality: `x` and `"x"` are the same value.
    expect(
      optionsEqual(parseAnnotation('<!-- block: view=embed -->')!.options, parseAnnotation('<!-- block: view="embed" -->')!.options),
    ).toBe(true)
  })

  test('the option table follows the plan', () => {
    expect(KNOWN_OPTIONS.map((o) => o.key)).toEqual([
      'small', 'color', 'align', 'icon', 'quote', 'list', 'wrap', 'lock', 'preview', 'header-column',
      'no-header-row', 'width', 'height', 'caption', 'view', 'bookmark', 'open', 'widths', 'layout',
      'details', // M8: "Show details" on a collection or query embed
    ])
    expect(isKnownValue({ key: 'color', value: 'text-emerald' })).toBe(true)
    expect(isKnownValue({ key: 'color', value: 'bg-gray' })).toBe(true)
    expect(isKnownValue({ key: 'color', value: 'bg-purplish' })).toBe(false)
    expect(isKnownValue({ key: 'align', value: 'left' })).toBe(false) // left is the default, never written
    expect(isKnownValue({ key: 'small', value: true })).toBe(true)
    expect(isKnownValue({ key: 'small', value: 'yes' })).toBe(false)
    expect(isKnownValue({ key: 'preview', value: 'split' })).toBe(true)
    expect(isKnownValue({ key: 'view', value: 'wideCard' })).toBe(true)
    expect(isKnownValue({ key: 'widths', value: '40,60' })).toBe(true)
    expect(isKnownValue({ key: 'width', value: '12.5' })).toBe(false)
  })
})

describe('inline math and embed lines', () => {
  test('inline math follows Pandoc dollar rules', () => {
    const texts = (s: string) => findInlineMath(s).map((m) => m.text)
    expect(findInlineMath('$a$')).toEqual([{ start: 0, end: 3, text: 'a' }])
    expect(texts('The theorem $a^2+b^2=c^2$ holds and $x$ too')).toEqual(['a^2+b^2=c^2', 'x'])
    expect(texts('$5 and $6')).toEqual([])
    expect(texts('\\$a$')).toEqual([])
    expect(texts('costs \\$5 and $x$')).toEqual(['x'])
    expect(texts('$$')).toEqual([])
    expect(texts('$$a$$')).toEqual([])
    expect(texts('$ a$')).toEqual([])
    expect(texts('$a $')).toEqual([])
    expect(texts('$a$5')).toEqual([])
    expect(texts('$a$5 and $b$')).toEqual(['a$5 and $b'])
    expect(texts('$a\\$b$')).toEqual(['a\\$b'])
    expect(texts('price $5 vs $x$')).toEqual(['5 vs $x'])
    const [m] = findInlineMath('see $e^x$.')
    expect('see $e^x$.'.slice(m.start, m.end)).toBe('$e^x$')
  })

  test('embed line rules pick image, media or object embed', () => {
    expect(classifyEmbedLine('![rack](Attachments/rack.png)\n')).toEqual({
      kind: 'image',
      alt: 'rack',
      src: 'Attachments/rack.png',
    })
    expect(classifyEmbedLine('![](https://example.com/a.png "Title")')).toEqual({
      kind: 'image',
      alt: '',
      src: 'https://example.com/a.png',
    })
    expect(classifyEmbedLine('![[Attachments/Quarterly report.pdf]]')).toEqual({
      kind: 'media',
      mediaKind: 'pdf',
      target: 'Attachments/Quarterly report.pdf',
      label: null,
    })
    const kinds = (t: string) => {
      const e = classifyEmbedLine(t)
      return e?.kind === 'media' ? e.mediaKind : e?.kind
    }
    expect(kinds('![[clip.WAV]]')).toBe('audio')
    expect(kinds('![[clip.mp4]]')).toBe('video')
    expect(kinds('![[photo.jpeg]]')).toBe('image')
    expect(kinds('![[data.xlsx]]')).toBe('file')
    expect(kinds('![[archive.tar.gz]]')).toBe('file')
    expect(classifyEmbedLine('![[Ada Lovelace]]\r\n')).toEqual({ kind: 'objectEmbed', target: 'Ada Lovelace', label: null })
    expect(classifyEmbedLine('![[Ada Lovelace|Ada]]')).toEqual({ kind: 'objectEmbed', target: 'Ada Lovelace', label: 'Ada' })
    expect(classifyEmbedLine('![[Notes.md]]')).toEqual({ kind: 'objectEmbed', target: 'Notes.md', label: null })
    expect(classifyEmbedLine('![[clip.mp3|Intro]]')).toEqual({
      kind: 'media',
      mediaKind: 'audio',
      target: 'clip.mp3',
      label: 'Intro',
    })
    for (const other of [
      'text ![[Ada Lovelace]]',
      '![[Ada Lovelace]] and more',
      '![a](b.png) ![c](d.png)',
      '![[A]]\n![[B]]',
      '[[Ada Lovelace]]',
      '[link](https://example.com)',
      'plain',
    ]) {
      expect(classifyEmbedLine(other), other).toBeNull()
    }
    expect(singleLink('[Proxmox docs](https://pve.proxmox.com/wiki)\n')).toEqual({
      title: 'Proxmox docs',
      href: 'https://pve.proxmox.com/wiki',
    })
    expect(singleLink('see [docs](https://x.y)')).toBeNull()
  })
})
