import { describe, expect, test } from 'vitest'
import { objectSummary } from '@/test/mockApi'
import { plainText, statRows, textStats, TEXT_STATS_TEXT } from './textStats'

describe('textStats', () => {
  test('test counts words sentences paragraphs characters', () => {
    // A hyphen-joined word counts once; an emoji is one grapheme (one character).
    expect(textStats('A well-known fact. Two more!\nNext 👍🏽')).toEqual({
      words: 6,
      sentences: 3,
      paragraphs: 2,
      characters: 35,
    })
    expect(textStats('')).toEqual({ words: 0, sentences: 0, paragraphs: 0, characters: 0 })
    expect(textStats('👨‍👩‍👧').characters).toBe(1)
  })

  test('test math is excluded', () => {
    expect(plainText('Energy $E = mc^2$ is mass.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nDone.')).toBe(
      'Energy  is mass.\nDone.',
    )
    expect(textStats(plainText('A $x + y$ b')).words).toBe(2)
  })

  test('test plain text drops markdown syntax and block annotations', () => {
    const md = [
      '# Title here',
      '',
      '<!-- block: id=abc -->',
      '- **Bold** and _italic_ with [a link](https://x.y) and [[Ada Lovelace|Ada]]',
      '- [ ] a task',
      '> quoted `code`',
      '![[query:q1]]',
      '![alt](Attachments/a.png)',
      '',
      '---',
      '',
      'Last.',
    ].join('\n')
    expect(plainText(md)).toBe(
      ['Title here', 'Bold and italic with a link and Ada', 'a task', 'quoted code', 'Last.'].join('\n'),
    )
  })

  test('test stats tab order and created hidden for daily notes', () => {
    const summary = objectSummary({ path: 'Pages/A.md', createdAt: '2026-01-02T10:00:00Z', lastUpdated: '2026-01-03T11:00:00Z' })
    const stats = { words: 1, sentences: 2, paragraphs: 1, characters: 9 }
    const rows = statRows(stats, summary, { dailyNote: false })
    expect(rows.map((r) => r.key)).toEqual(['words', 'sentences', 'paragraphs', 'characters', 'createdAt', 'lastUpdated'])
    expect(rows.slice(0, 4).map((r) => `${r.value} ${r.label}`)).toEqual([
      '1 word',
      '2 sentences',
      '1 paragraph',
      '9 characters',
    ])
    expect(rows[4].label).toBe(TEXT_STATS_TEXT.createdAt)
    expect(rows[4].label).toBe('Created at')
    expect(rows[5].label).toBe('Last updated')
    expect(statRows(stats, summary, { dailyNote: true }).map((r) => r.key)).not.toContain('createdAt')
  })
})
