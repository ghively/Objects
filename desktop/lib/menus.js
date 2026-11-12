'use strict'
// The menus, as plain data (main.js turns them into Electron menus).

/**
 * The application menu: none on Windows and Linux (the app's own top bar is the menu); on
 * macOS the standard App, Edit, View and Window menus, so the system's keys work (Cmd+Q, Cmd+H,
 * Cmd+C/V/X/A/Z, Cmd+M, full screen). View has no Reload and no developer tools.
 */
function applicationMenu(platform) {
  if (platform !== 'darwin') return null
  return [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
}

/** How many spelling suggestions are listed. */
const SUGGESTIONS = 5

/**
 * The right-click menu for where the page showed none of its own (Electron's `context-menu`
 * event, which is not sent when the page handled the click). `[]`: no menu.
 * Items: `{label, role, enabled}`, `{label, replace}` (a spelling suggestion),
 * `{label, addWord}` and `{type: 'separator'}`.
 */
function contextMenu(params) {
  const flags = params.editFlags || {}
  const items = []
  if (params.isEditable) {
    if (params.misspelledWord) {
      for (const word of (params.dictionarySuggestions || []).slice(0, SUGGESTIONS)) {
        items.push({ label: word, replace: word })
      }
      items.push({ label: 'Add to dictionary', addWord: params.misspelledWord })
      items.push({ type: 'separator' })
    }
    items.push({ label: 'Cut', role: 'cut', enabled: flags.canCut === true })
    items.push({ label: 'Copy', role: 'copy', enabled: flags.canCopy === true })
    items.push({ label: 'Paste', role: 'paste', enabled: flags.canPaste === true })
    items.push({ type: 'separator' })
    items.push({ label: 'Select all', role: 'selectAll', enabled: flags.canSelectAll === true })
  } else if (typeof params.selectionText === 'string' && params.selectionText.trim() !== '') {
    items.push({ label: 'Copy', role: 'copy', enabled: flags.canCopy === true })
    items.push({ type: 'separator' })
    items.push({ label: 'Select all', role: 'selectAll', enabled: flags.canSelectAll === true })
  }
  return items
}

module.exports = { applicationMenu, contextMenu }
