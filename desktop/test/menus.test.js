'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { applicationMenu, contextMenu } = require('../lib/menus')

const flags = (over = {}) => ({ canCut: true, canCopy: true, canPaste: true, canSelectAll: true, ...over })
const params = (over = {}) => ({
  isEditable: false, selectionText: '', misspelledWord: '', dictionarySuggestions: [], editFlags: flags(), ...over,
})

test('Windows and Linux have no menu bar', () => {
  assert.equal(applicationMenu('win32', 'Object'), null)
  assert.equal(applicationMenu('linux', 'Object'), null)
})

test('macOS has the standard menus so the system keys work', () => {
  const menu = applicationMenu('darwin', 'Object')
  assert.deepEqual(menu.map((m) => m.role || m.label), ['appMenu', 'editMenu', 'View', 'windowMenu'])
  const view = menu[2].submenu.map((i) => i.role || i.type)
  assert.deepEqual(view, ['resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen'])
})

test('a right click in text being edited: Cut, Copy, Paste, Select all', () => {
  const items = contextMenu(params({ isEditable: true, selectionText: 'word' }))
  assert.deepEqual(items, [
    { label: 'Cut', role: 'cut', enabled: true },
    { label: 'Copy', role: 'copy', enabled: true },
    { label: 'Paste', role: 'paste', enabled: true },
    { type: 'separator' },
    { label: 'Select all', role: 'selectAll', enabled: true },
  ])
})

test('what cannot be done is greyed', () => {
  const items = contextMenu(params({ isEditable: true, editFlags: flags({ canCut: false, canCopy: false }) }))
  assert.deepEqual(items.filter((i) => i.role).map((i) => [i.role, i.enabled]),
    [['cut', false], ['copy', false], ['paste', true], ['selectAll', true]])
})

test('a misspelled word: its suggestions first, then Add to dictionary', () => {
  const items = contextMenu(params({
    isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'tea', 'ten', 'tee', 'ted', 'tech'],
  }))
  assert.deepEqual(items.slice(0, 7), [
    { label: 'the', replace: 'the' },
    { label: 'tea', replace: 'tea' },
    { label: 'ten', replace: 'ten' },
    { label: 'tee', replace: 'tee' },
    { label: 'ted', replace: 'ted' },
    { label: 'Add to dictionary', addWord: 'teh' },
    { type: 'separator' },
  ])
  assert.equal(items[7].label, 'Cut')
})

test('a misspelled word with no suggestions still offers Add to dictionary', () => {
  const items = contextMenu(params({ isEditable: true, misspelledWord: 'zxqv' }))
  assert.deepEqual(items.slice(0, 2), [{ label: 'Add to dictionary', addWord: 'zxqv' }, { type: 'separator' }])
})

test('selected text that cannot be edited: Copy and Select all', () => {
  assert.deepEqual(contextMenu(params({ selectionText: 'some words' })), [
    { label: 'Copy', role: 'copy', enabled: true },
    { type: 'separator' },
    { label: 'Select all', role: 'selectAll', enabled: true },
  ])
})

test('a right click on nothing shows no menu', () => {
  assert.deepEqual(contextMenu(params()), [])
  assert.deepEqual(contextMenu(params({ selectionText: '   ' })), [])
})
