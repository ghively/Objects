// M32 fix pass (F1): the client applies the server's own rule to the text it holds when a rename
// answers (`Space.rename_object`: the first `# Old title` heading outside a code fence). The
// expected texts below were produced by the server's rule; 8,000 generated texts were compared
// with it when this was written.
import { describe, expect, test } from 'vitest'
import { retitledBody } from './titleHeading'

const re = (body: string, to = 'Beta') => retitledBody(body, 'Alpha', to)

describe('retitledBody', () => {
  test('a body that opens with the title gets the new title as its heading, and nothing else changes', () => {
    expect(re('# Alpha\n\nfirst line\n')).toBe('# Beta\n\nfirst line\n')
    expect(re('# Alpha')).toBe('# Beta')
  })

  test('leading blank lines and text above the heading are kept', () => {
    expect(re('\n\n# Alpha\nx')).toBe('\n\n# Beta\nx')
    expect(re('intro\n# Alpha\n')).toBe('intro\n# Beta\n')
  })

  test('CRLF line ends are kept', () => {
    expect(re('# Alpha\r\n\r\nfirst line\r\n')).toBe('# Beta\r\n\r\nfirst line\r\n')
  })

  test('only the first heading that is the old title changes', () => {
    expect(re('x\n# Alpha\n# Alpha\n')).toBe('x\n# Beta\n# Alpha\n')
    expect(re('# Other\n\n# Alpha\n')).toBe('# Other\n\n# Beta\n')
  })

  test('closing hashes and spaces around the title are part of the heading line', () => {
    expect(re('#  Alpha  ##\nx')).toBe('# Beta\nx')
    expect(re('#\tAlpha\t\nx')).toBe('# Beta\nx')
  })

  test.each([
    ['a longer heading', '# Alpha Beta\n'],
    ['another case', '# alpha\n'],
    ['a second-level heading', '## Alpha\n'],
    ['no space after the hash', '#Alpha\n'],
    ['an indented line', ' # Alpha\n'],
    ['the title as plain text', 'Alpha\n'],
    ['an empty body', ''],
  ])('%s is left alone', (_name, body) => {
    expect(re(body)).toBe(body)
  })

  test('a heading inside a code fence is not the heading; the next one outside is', () => {
    expect(re('```\n# Alpha\n```\n# Alpha\n')).toBe('```\n# Alpha\n```\n# Beta\n')
    expect(re('~~~ md\n# Alpha\n~~~~\n# Alpha')).toBe('~~~ md\n# Alpha\n~~~~\n# Beta')
    // A fence that is never closed runs to the end.
    expect(re('```\n# Alpha\n')).toBe('```\n# Alpha\n')
    // A shorter fence, or another character, does not close it.
    expect(re('````\n```\n# Alpha\n')).toBe('````\n```\n# Alpha\n')
    expect(re('```\n~~~\n# Alpha\n')).toBe('```\n~~~\n# Alpha\n')
    // Backticks followed by a backtick on the same line are inline code, not a fence.
    expect(re('```a`b\n# Alpha\n')).toBe('```a`b\n# Beta\n')
  })

  test('the new title is written with its spaces collapsed, as the server stores it', () => {
    expect(re('# Alpha\n', '  New   name ')).toBe('# New name\n')
  })

  test('the same title, or an empty one, changes nothing', () => {
    expect(re('# Alpha\n', 'Alpha')).toBe('# Alpha\n')
    expect(re('# Alpha\n', '   ')).toBe('# Alpha\n')
  })
})
