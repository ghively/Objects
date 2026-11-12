'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spellCheckLanguagesFor, cleanTag } = require('../lib/spellcheck')

// What Chromium offers on Windows and Linux (`session.availableSpellCheckerLanguages`), shortened.
const AVAILABLE = ['af', 'de', 'de-CH', 'en-AU', 'en-CA', 'en-GB', 'en-US', 'es', 'es-419', 'es-AR', 'fr', 'pt-BR', 'pt-PT', 'sv']
const DEFAULTS = ['en-US']

test('an exact match wins, whatever its spelling', () => {
  assert.deepEqual(spellCheckLanguagesFor('de-CH', AVAILABLE, DEFAULTS), ['de-CH'])
  assert.deepEqual(spellCheckLanguagesFor('de_ch', AVAILABLE, DEFAULTS), ['de-CH'])
  assert.deepEqual(spellCheckLanguagesFor('EN-gb', AVAILABLE, DEFAULTS), ['en-GB'])
  assert.deepEqual(spellCheckLanguagesFor('es-419', AVAILABLE, DEFAULTS), ['es-419'])
})

test('else the same language: the bare language first, then its own region, then the first offered', () => {
  assert.deepEqual(spellCheckLanguagesFor('de-AT', AVAILABLE, DEFAULTS), ['de'])
  assert.deepEqual(spellCheckLanguagesFor('fr-CA', AVAILABLE, DEFAULTS), ['fr'])
  assert.deepEqual(spellCheckLanguagesFor('pt', AVAILABLE, DEFAULTS), ['pt-PT'])
  assert.deepEqual(spellCheckLanguagesFor('en', AVAILABLE, DEFAULTS), ['en-US'])
  assert.deepEqual(spellCheckLanguagesFor('en-NZ', AVAILABLE, DEFAULTS), ['en-US'])
  assert.deepEqual(spellCheckLanguagesFor('es-MX', ['es-AR', 'es-ES'], DEFAULTS), ['es-ES'])
  assert.deepEqual(spellCheckLanguagesFor('nl-BE', ['nl', 'nl-NL'], DEFAULTS), ['nl'])
  assert.deepEqual(spellCheckLanguagesFor('it-CH', ['it-CH-1996', 'it-IT'], DEFAULTS), ['it-IT'])
})

test('no match, no tag or not a tag: the system default languages', () => {
  assert.deepEqual(spellCheckLanguagesFor('ja', AVAILABLE, DEFAULTS), DEFAULTS)
  assert.deepEqual(spellCheckLanguagesFor(null, AVAILABLE, DEFAULTS), DEFAULTS)
  assert.deepEqual(spellCheckLanguagesFor('', AVAILABLE, DEFAULTS), DEFAULTS)
  assert.deepEqual(spellCheckLanguagesFor('english', AVAILABLE, DEFAULTS), DEFAULTS)
  assert.deepEqual(spellCheckLanguagesFor(7, AVAILABLE, DEFAULTS), DEFAULTS)
  assert.deepEqual(spellCheckLanguagesFor('de', [], ['de-DE']), ['de-DE'])
  // A copy: the caller may keep the list it was given.
  assert.notEqual(spellCheckLanguagesFor(null, AVAILABLE, DEFAULTS), DEFAULTS)
})

test('cleanTag keeps only what can be a language tag', () => {
  assert.equal(cleanTag('de_CH'), 'de-CH')
  assert.equal(cleanTag(' fr '), 'fr')
  assert.equal(cleanTag('x'.repeat(40)), null)
  assert.equal(cleanTag('de CH'), null)
  assert.equal(cleanTag('de--CH'), null)
  assert.equal(cleanTag(null), null)
  assert.equal(cleanTag({}), null)
})
