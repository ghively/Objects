// M23 Task 15: Keep on top in a browser: a Document Picture-in-Picture window (340x430, ported)
// with the page's style sheets and `<html>` theme attributes copied in, showing `WorkMini`.
// The window shares this page's JS, so the mini page reads the same work stores.
// M32: no window opens while Work is off for the space.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { isWorkOn } from '../useWorkOn'

/** The window's size (ported from the old dashboard). */
export const PIP_SIZE = { width: 340, height: 430 } as const

interface DocumentPictureInPicture {
  requestWindow(o: { width: number; height: number }): Promise<Window>
}

function pipApi(): DocumentPictureInPicture | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture ?? null
}

/** Whether this browser can open a Document Picture-in-Picture window. */
export function pipAvailable(): boolean {
  return pipApi() !== null
}

function copyStyles(from: Document, to: Document): void {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement('style')
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n')
      to.head.appendChild(style)
    } catch {
      // A sheet whose rules can't be read: link it instead.
      if (!sheet.href) continue
      const link = to.createElement('link')
      link.rel = 'stylesheet'
      link.href = sheet.href
      to.head.appendChild(link)
    }
  }
}

function copyHtmlAttrs(from: Element, to: Element): void {
  for (const a of Array.from(to.attributes)) if (!from.hasAttribute(a.name)) to.removeAttribute(a.name)
  for (const a of Array.from(from.attributes)) to.setAttribute(a.name, a.value)
}

/** Open the picture-in-picture window with `WorkMini` in it. */
export async function openWorkPip(): Promise<void> {
  const pip = pipApi()
  if (!pip || !isWorkOn()) return
  // Loaded here, not at the top: WorkMini reaches the views, and a view holds the button that calls this.
  const { WorkMini } = await import('./WorkMini')
  const w = await pip.requestWindow({ width: PIP_SIZE.width, height: PIP_SIZE.height })
  const doc = w.document
  copyStyles(document, doc)
  copyHtmlAttrs(document.documentElement, doc.documentElement)
  // The theme follows while the window is open.
  const observer = new MutationObserver(() => copyHtmlAttrs(document.documentElement, doc.documentElement))
  observer.observe(document.documentElement, { attributes: true })
  const host = doc.createElement('div')
  doc.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(WorkMini))
  w.addEventListener('pagehide', () => {
    observer.disconnect()
    root.unmount()
  })
}
