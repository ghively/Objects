/**
 * Installs the app's wikilink presenter: each chip resolves its target through
 * the back end, takes its target type's colour, shows the target's title on
 * hover, renders dimmed when unresolved, and opens its target on click
 * (peek; Ctrl/Cmd+click opens a new tab).
 */
import { setWikilinkPresenter, type WikilinkAttrs } from '@/editor/extensions/wikilink'
import { usePeek, useTabs } from '@/nav/tabs'
import { chipStyle } from '@/shell/typeColor'
import { ensureLinkIndex, resolveLink, stemOf, summaryOf, typeOf, useLinkIndex } from './linkIndex'

/** The object whose body holds `dom`: set as `data-object-path` on an ancestor. */
function fromPath(dom: HTMLElement): string | undefined {
  return dom.closest('[data-object-path]')?.getAttribute('data-object-path') ?? undefined
}

function clearStyle(dom: HTMLElement) {
  dom.style.removeProperty('--chip-fg')
  dom.style.removeProperty('--chip-bg')
  delete dom.dataset.color
}

export function presentWikilink(dom: HTMLElement, attrs: WikilinkAttrs): () => void {
  let alive = true
  let resolvedPath: string | null = null
  dom.dataset.state = 'pending'

  const apply = async () => {
    // Wait a tick so the chip is attached and `fromPath` can see its object.
    await Promise.resolve()
    if (!alive) return
    const [path] = await Promise.all([resolveLink(attrs.target, fromPath(dom)), ensureLinkIndex()])
    if (!alive) return
    resolvedPath = path
    delete dom.dataset.state
    if (!path) {
      dom.setAttribute('data-unresolved', '')
      dom.removeAttribute('data-resolved-path')
      dom.classList.add('wikilink-unresolved')
      dom.title = `No object named “${attrs.target}”`
      clearStyle(dom)
      return
    }
    dom.removeAttribute('data-unresolved')
    dom.classList.remove('wikilink-unresolved')
    dom.setAttribute('data-resolved-path', path)
    const summary = summaryOf(path)
    dom.title = summary?.title ?? stemOf(path)
    const type = typeOf(summary?.type)
    if (type) {
      dom.dataset.color = type.color
      const style = chipStyle(type.color) as Record<string, string>
      for (const [k, v] of Object.entries(style)) dom.style.setProperty(k, v)
    } else {
      clearStyle(dom)
    }
  }

  const onClick = (e: MouseEvent) => {
    if (!resolvedPath) return
    e.preventDefault()
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey) useTabs.getState().open({ kind: 'object', path: resolvedPath }, { newTab: true })
    else usePeek.getState().peek(resolvedPath)
  }

  // Middle-click (auxclick) also opens a new tab, like a browser link.
  const onAux = (e: MouseEvent) => {
    if (e.button !== 1 || !resolvedPath) return
    e.preventDefault()
    useTabs.getState().open({ kind: 'object', path: resolvedPath }, { newTab: true })
  }

  dom.addEventListener('click', onClick)
  dom.addEventListener('auxclick', onAux)
  void apply()
  // Re-resolve when the index reloads (objects created, renamed or deleted).
  const unsubscribe = useLinkIndex.subscribe((s, prev) => {
    if (s.revision !== prev.revision && s.loaded) void apply()
  })

  return () => {
    alive = false
    unsubscribe()
    dom.removeEventListener('click', onClick)
    dom.removeEventListener('auxclick', onAux)
  }
}

let installed = false

export function installWikilinkPresenter(): void {
  if (installed) return
  installed = true
  setWikilinkPresenter(presentWikilink)
}
