// M32 fix pass, W16: the words left over. On screen a thing you wrote is a "note"; "page" stays
// only where a page is meant (the Work page, a type's page, "Open notes as a full page", the keys
// Page up and Page down, the "Page" link view, which shows a note as a whole page). Display only:
// no stored name, key or id is checked or changed here.
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { AI_CHAT_TEXT, REMOTE_CHAT_TEXT } from '@/ai/aiText'
import { allShortcuts, CATEGORY_LABELS } from '@/lib/shortcuts'
import { TAB_META } from '@/references/referencesUi'
import { PAGE_LAYOUTS_LABEL } from '@/types/PageLayoutCards'
import { TYPE_SETTINGS_TEXT } from '@/types/TypeSettings'
import { EDITOR_TEXT } from './sections/Editor'
import { OFFLINE_SYNC_TEXT } from './sections/OfflineSync'

/** Every string a text constant can show: its values, and what its functions answer. */
function strings(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    for (const args of [[1, 'x'], [2, 'x'], [[{ title: 'T', reason: 'template' }], 'x'], ['Name', 'host.example']]) {
      try {
        const said = (value as (...a: unknown[]) => unknown)(...args)
        if (typeof said === 'string') out.push([`${path}()`, said])
      } catch {
        // not that kind of function
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  }
  return out
}

/** The strings of `text` that still say "page" or "pages", by their path. */
const saysPage = (text: unknown, name: string) => [...new Set(strings(text, name).filter(([, s]) => /\bpages?\b/i.test(s)).map(([p]) => p))]

describe('W16: "note" where a note is meant', () => {
  test('test the Shortcuts list: the group reads "Note" and its rows name the note', () => {
    const name = (id: string) => allShortcuts().find((d) => d.id === id)?.name
    expect(CATEGORY_LABELS.page).toBe('Note')
    expect(name('deleteCurrentPage')).toBe('Delete this note')
    expect(name('openExportMenu')).toBe('Export this note')
    expect(name('toggleFavorite')).toBe('Pin or unpin this note')
    // It opens the New menu; "Add new content" was no label of the slash menu or of anything else.
    expect(name('openAddEntityMenu')).toBe('New')
    // No stored id changed.
    for (const id of ['deleteCurrentPage', 'openExportMenu', 'toggleFavorite', 'openAddEntityMenu']) expect(name(id)).toBeTruthy()
  })

  test('test the AI chat panel says notes (wording only)', () => {
    expect(AI_CHAT_TEXT.empty).toBe('Ask a question about the notes in the context, or about anything in your space.')
    expect(AI_CHAT_TEXT.placeholder).toBe('Ask about your notes…')
    expect(AI_CHAT_TEXT.notice).toBe(
      'AI Chat sends the notes in its context, and anything it reads with Object\'s search tools, to Anthropic through your Claude Code. Notes tagged "Exclude from AI" are never sent.',
    )
    expect(AI_CHAT_TEXT.exploreCardHelp).toBe('Ask about your notes with Claude Code.')
    expect(AI_CHAT_TEXT.addContext).toBe('Add a note to the context')
    expect(AI_CHAT_TEXT.pickPage).toBe('Find a note')
    expect(AI_CHAT_TEXT.appendToPage).toBe('Append to note')
    expect(AI_CHAT_TEXT.appendToPageNone).toBe('Add a note to the context to append to it.')
    expect(AI_CHAT_TEXT.appended).toBe('Appended to the note')
    expect(AI_CHAT_TEXT.noTarget).toBe('Add a note to the context first.')
    expect(AI_CHAT_TEXT.relevantNone).toBe('Open a note to see content related to it.')
    expect(REMOTE_CHAT_TEXT.noticeBody('Scout', 'agents.example')).toBe(
      'Scout is a remote agent. The context notes you send go to agents.example, outside this computer. Notes excluded from AI are never sent.',
    )
    expect(saysPage(AI_CHAT_TEXT, 'AI_CHAT_TEXT')).toEqual([])
    expect(saysPage(REMOTE_CHAT_TEXT, 'REMOTE_CHAT_TEXT')).toEqual([])
    // The names the catalog gives the entry points are as they were.
    expect([AI_CHAT_TEXT.title, AI_CHAT_TEXT.relevant, AI_CHAT_TEXT.findMore]).toEqual(['AI Chat', 'Relevant Content', 'Find More'])
  })

  test('test Settings > Editor and Offline & Sync say notes', () => {
    expect(EDITOR_TEXT.hideTypeDescription).toBe(
      'Removes the controls for editing properties and type settings from notes. Settings is still where you change them.',
    )
    expect(OFFLINE_SYNC_TEXT.mediaEverythingDescription).toBe('Media loads as soon as a note opens.')
    expect(OFFLINE_SYNC_TEXT.mediaLoadingDescription).toBe(
      'When images, video, audio and PDFs load: in notes, cover images, cards and galleries, image properties and whiteboards.',
    )
    expect(saysPage(OFFLINE_SYNC_TEXT, 'OFFLINE_SYNC_TEXT')).toEqual([])
    // "Open notes as a full page" is a page: the two strings that say so are the only ones left.
    expect(saysPage(EDITOR_TEXT, 'EDITOR_TEXT')).toEqual(['EDITOR_TEXT.fullPage', 'EDITOR_TEXT.fullPageDescription'])
  })

  test('test type settings: the layout block reads "Layout" and says notes', () => {
    expect(TYPE_SETTINGS_TEXT.page).toBe('Layout')
    expect(TYPE_SETTINGS_TEXT.pageLayoutExplanation).toBe('How notes of this type are laid out.')
    expect(PAGE_LAYOUTS_LABEL).toBe('Layout')
    expect(TYPE_SETTINGS_TEXT.fontExplanation).toBe('The typeface that notes of this type use.')
    // The only "page" left is the type's own page (its list of notes).
    expect(saysPage(TYPE_SETTINGS_TEXT, 'TYPE_SETTINGS_TEXT')).toEqual(['TYPE_SETTINGS_TEXT.defaultListViewExplanation'])
  })

  test('test the note page\'s tab and its setting read "Related"', () => {
    expect(TAB_META.related.label).toBe('Related')
    expect(EDITOR_TEXT.sections.relatedContent).toBe('Related')
  })
})
