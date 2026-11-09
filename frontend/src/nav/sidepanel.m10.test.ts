// M10: the AI chat side-panel entry (`{kind: 'aiChat', path?}`).
import { beforeEach, describe, expect, test } from 'vitest'
import {
  cleanEntries,
  isAiChatTarget,
  isPageTarget,
  openEntryIn,
  openInArea,
  replaceEntryTarget,
  sameSidepanelTarget,
} from './sidepanel'
import { activeTab, sameTarget, useTabs, type SidepanelTarget, type Target } from './tabs'

const obj = (path: string): Target => ({ kind: 'object', path })
const AI: SidepanelTarget = { kind: 'aiChat' }
let n = 0
const id = () => `e${++n}`
const s = useTabs.getState
const tab = () => activeTab(s())!

beforeEach(() => {
  n = 0
  localStorage.clear()
  s().reset()
})

describe('AI chat side-panel entry', () => {
  test('test aiChat is not a page target and compares by path', () => {
    expect(isAiChatTarget(AI)).toBe(true)
    expect(isAiChatTarget(obj('A.md'))).toBe(false)
    expect(isPageTarget(AI)).toBe(false)
    expect(isPageTarget({ kind: 'aiChat', path: 'AI Chats/A.md' })).toBe(false)
    expect(sameTarget(AI, { kind: 'aiChat' })).toBe(true)
    expect(sameTarget(AI, { kind: 'aiChat', path: 'AI Chats/A.md' })).toBe(false)
    expect(sameSidepanelTarget({ kind: 'aiChat', path: 'x.md' }, { kind: 'aiChat', path: 'x.md' })).toBe(true)
    expect(sameSidepanelTarget(AI, obj('A.md'))).toBe(false)
  })

  test('test opening the AI chat reveals the one already there', () => {
    let entries = openInArea([], AI, 'area1', id)
    expect(entries).toHaveLength(1)
    // Another entry takes area 2, then the chat is asked for again: the first one is revealed.
    entries = openInArea(entries, obj('B.md'), 'area2', id)
    entries = openInArea(entries, AI, 'area2', id)
    expect(entries).toHaveLength(2)
    expect(openEntryIn(entries, 'area1')?.target).toEqual(AI)
    // A saved chat by path is shown in that entry.
    entries = openInArea(entries, { kind: 'aiChat', path: 'AI Chats/One.md' }, 'area1', id)
    expect(entries).toHaveLength(2)
    expect(openEntryIn(entries, 'area1')?.target).toEqual({ kind: 'aiChat', path: 'AI Chats/One.md' })
  })

  test('test an agent or a transcript asked for is shown in the chat already there', () => {
    // accept-m17.5: a sidebar agent row (agentId) and a Chats tab row (agentId + chatId) reach the open chat.
    let entries = openInArea([], AI, 'area1', id)
    entries = openInArea(entries, { kind: 'aiChat', agentId: 'researcher' }, 'area1', id)
    expect(entries).toHaveLength(1)
    expect(openEntryIn(entries, 'area1')?.target).toEqual({ kind: 'aiChat', agentId: 'researcher' })
    entries = openInArea(entries, { kind: 'aiChat', agentId: 'researcher', chatId: 'c1' }, 'area1', id)
    expect(entries).toHaveLength(1)
    expect(openEntryIn(entries, 'area1')?.target).toEqual({ kind: 'aiChat', agentId: 'researcher', chatId: 'c1' })
    // Asking for the chat that is already shown adds no history step.
    const before = entries[0].history?.length
    entries = openInArea(entries, { kind: 'aiChat', agentId: 'researcher', chatId: 'c1' }, 'area1', id)
    expect(entries[0].history?.length).toBe(before)
  })

  test('test replace keeps the entry history length', () => {
    let entries = openInArea([], obj('A.md'), 'area1', id)
    entries = openInArea(entries, AI, 'area1', id)
    const e = entries[0]
    expect(e.history).toHaveLength(2)
    entries = replaceEntryTarget(entries, e.id, { kind: 'aiChat', path: 'AI Chats/C.md' })
    expect(entries[0].target).toEqual({ kind: 'aiChat', path: 'AI Chats/C.md' })
    expect(entries[0].history).toEqual([obj('A.md'), { kind: 'aiChat', path: 'AI Chats/C.md' }])
    expect(entries[0].index).toBe(1)
  })

  test('test persisted aiChat entries survive cleaning', () => {
    const cleaned = cleanEntries([
      { id: 'a', target: { kind: 'aiChat', path: 'AI Chats/C.md' }, isOpen: true, panelArea: 'area1', history: [{ kind: 'aiChat', path: 'AI Chats/C.md' }], index: 0 },
    ])
    expect(cleaned?.[0].target).toEqual({ kind: 'aiChat', path: 'AI Chats/C.md' })
    expect(cleaned?.[0].index).toBe(0)
  })

  test('test store: openInSidepanel, replace, and no swap for the chat', () => {
    s().open(obj('Main.md'))
    s().openInSidepanel(AI)
    const entry = tab().sidepanel![0]
    expect(entry.target).toEqual(AI)
    s().replaceSidepanelEntryTarget(entry.id, { kind: 'aiChat', path: 'AI Chats/X.md' })
    expect(tab().sidepanel![0].target).toEqual({ kind: 'aiChat', path: 'AI Chats/X.md' })
    s().swapWithMain(entry.id)
    // Nothing moved: the chat stays in the panel, the page in the main view.
    expect(tab().sidepanel![0].target).toEqual({ kind: 'aiChat', path: 'AI Chats/X.md' })
    expect(tab().history.at(-1)).toEqual(obj('Main.md'))
    // A hidden panel shows again when the chat is asked for.
    s().toggleSidepanel()
    expect(tab().hideSidepanel).toBe(true)
    s().openInSidepanel(AI)
    expect(tab().hideSidepanel).toBe(false)
    expect(tab().sidepanel).toHaveLength(1)
  })
})
