/**
 * The date token chip (M8, Task 26): the token's day in the user's date format
 * (M5's `formatDate`, following the "Date format" device setting), drawn as a
 * small chip. A click opens that day's daily note, creating it when the day has
 * none (our choice); Ctrl/Cmd+click or a middle click opens it in a new tab, as
 * a wikilink does.
 *
 * A plain DOM node view (so it also draws in headless editors); it re-renders
 * when the date setting changes. The file's text is never touched: the chip is
 * display only.
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { api, DailyNoteExistsError } from '@/api/client'
import { invalidateLinkIndex, resolveLink } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { formatDate } from '@/properties/format'
import { useSettings } from '@/settings/useSettings'
import { ISO_DAY } from './dateToken'

/** The chip's text: the day in the user's date format (the raw text for a day it cannot read). */
export function dateTokenLabel(date: string): string {
  if (!ISO_DAY.test(date)) return date
  return formatDate({ start: date, resolution: 'day' })
}

/** The path of the daily note for `day`, creating the note when there is none. */
export async function dailyNotePath(day: string): Promise<string | null> {
  const found = await resolveLink(day)
  if (found) return found
  try {
    const res = await api.createDailyNote(day)
    void invalidateLinkIndex()
    return res.path
  } catch (e) {
    if (e instanceof DailyNoteExistsError && e.reason === 'exists' && e.path) return e.path
    throw e
  }
}

/** Open the daily note for `day` (a new tab with `newTab`). */
export async function openDateToken(day: string, newTab = false): Promise<void> {
  if (!ISO_DAY.test(day)) return
  const path = await dailyNotePath(day)
  if (!path) return
  useTabs.getState().open({ kind: 'object', path }, { newTab, via: 'link' })
}

const CALENDAR_ICON =
  '<svg class="date-token-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'

export class DateTokenView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private label: HTMLElement
  private unsubscribe: () => void

  constructor(node: PMNode) {
    this.node = node
    this.dom = document.createElement('time')
    this.dom.className = 'date-token date-token-chip'
    this.dom.setAttribute('data-date-token', '')
    this.dom.setAttribute('contenteditable', 'false')
    this.dom.setAttribute('role', 'link')
    this.dom.innerHTML = CALENDAR_ICON
    this.label = document.createElement('span')
    this.label.className = 'date-token-label'
    this.dom.append(this.label)
    this.dom.addEventListener('mousedown', (e) => {
      // Keep the caret where it is; the click opens the note.
      if (e.button === 0) e.preventDefault()
    })
    this.dom.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      void openDateToken(this.date, e.ctrlKey || e.metaKey)
    })
    this.dom.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      void openDateToken(this.date, true)
    })
    this.render()
    this.unsubscribe = useSettings.subscribe((s, prev) => {
      if (s.settings.dateFormatting !== prev.settings.dateFormatting) this.render()
    })
  }

  private get date(): string {
    return String(this.node.attrs.date ?? '')
  }

  private render() {
    const date = this.date
    this.dom.setAttribute('datetime', date)
    const label = dateTokenLabel(date)
    this.label.textContent = label
    this.dom.setAttribute('title', label)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  stopEvent(event: Event): boolean {
    return event.type === 'click' || event.type === 'auxclick'
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy() {
    this.unsubscribe()
  }
}
