/**
 * Installs the app's wikilink presenter: each chip resolves its target through
 * the back end, takes its target type's colour, shows the target's title on
 * hover, renders dimmed when unresolved, and opens its target on click
 * (peek; Ctrl/Cmd+click or middle-click opens a new tab, which extends the
 * breadcrumb trail like any link). A small icon of the target's type, in its
 * colour, sits in front of the title unless "Show object type icon for inline
 * object links" is off (`hideEntityIconsOnInlineLinks`).
 */
import type { IconifyJSON } from '@iconify/types'
import { getIconData, iconToHTML, iconToSVG } from '@iconify/utils'
import { iconName, isIconifyId, parseIconId } from '@/components/Icon'
import type { Icon as IconValue } from '@/api/types'
import { setWikilinkPresenter, type WikilinkAttrs } from '@/editor/extensions/wikilink'
import { usePeek, useTabs } from '@/nav/tabs'
import { useSettings } from '@/settings/useSettings'
import { chipStyle } from '@/shell/typeColor'
import { ensureLinkIndex, resolveLink, stemOf, summaryOf, typeOf, useLinkIndex } from './linkIndex'

/** The object whose body holds `dom`: set as `data-object-path` on an ancestor. */
function fromPath(dom: HTMLElement): string | undefined {
  return dom.closest('[data-object-path]')?.getAttribute('data-object-path') ?? undefined
}

const ICON_SETS: Record<string, () => Promise<unknown>> = {
  ph: () => import('@iconify-json/ph/icons.json'),
  'vscode-icons': () => import('@iconify-json/vscode-icons/icons.json'),
}
const iconSets = new Map<string, Promise<IconifyJSON | null>>()

function iconSet(prefix: string): Promise<IconifyJSON | null> {
  let p = iconSets.get(prefix)
  if (!p) {
    const load = ICON_SETS[prefix]
    p = load
      ? load().then((m) => ((m as { default?: IconifyJSON }).default ?? m) as IconifyJSON).catch(() => null)
      : Promise.resolve(null)
    iconSets.set(prefix, p)
  }
  return p
}

/** The SVG markup of an Iconify id (falling back to `ph-cube`), sized to the text. */
async function iconSvg(id: string): Promise<string | null> {
  const { prefix, name } = parseIconId(id)
  const set = prefix ? await iconSet(prefix) : null
  let data = set ? getIconData(set, name) : null
  if (!data) {
    const ph = await iconSet('ph')
    data = ph ? getIconData(ph, 'cube') : null
  }
  if (!data) return null
  const svg = iconToSVG(data, { width: '1em', height: '1em' })
  return iconToHTML(svg.body, { ...svg.attributes, fill: 'currentColor' })
}

const ICON_ATTR = 'data-wikilink-icon'

function removeIcon(dom: HTMLElement) {
  dom.querySelector(`:scope > [${ICON_ATTR}]`)?.remove()
}

/** Put the type icon in front of the chip's text (or take it away). */
async function paintIcon(dom: HTMLElement, icon: IconValue | null | undefined, isAlive: () => boolean) {
  if (!icon || useSettings.getState().settings.hideEntityIconsOnInlineLinks) {
    removeIcon(dom)
    return
  }
  const val = iconName(icon, 'ph-cube')
  const emoji = icon.val.trim() ? icon.type === 'emoji' : !isIconifyId(val)
  const svg = emoji ? null : await iconSvg(val)
  if (!isAlive()) return
  removeIcon(dom)
  if (useSettings.getState().settings.hideEntityIconsOnInlineLinks) return
  const el = document.createElement('span')
  el.setAttribute(ICON_ATTR, '')
  el.setAttribute('aria-hidden', 'true')
  el.contentEditable = 'false'
  el.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;width:0.95em;height:0.95em;' +
    'margin-right:0.2em;vertical-align:-0.125em;font-size:0.95em;line-height:1;pointer-events:none'
  if (svg) el.innerHTML = svg
  else el.textContent = val
  dom.prepend(el)
}

function clearStyle(dom: HTMLElement) {
  dom.style.removeProperty('--chip-fg')
  dom.style.removeProperty('--chip-bg')
  delete dom.dataset.color
}

export function presentWikilink(dom: HTMLElement, attrs: WikilinkAttrs): () => void {
  let alive = true
  let resolvedPath: string | null = null
  let typeIcon: IconValue | null = null
  // Bumped on each paint so a slow icon load never lands after a newer one.
  let iconRun = 0
  const showIcon = () => {
    const run = ++iconRun
    void paintIcon(dom, typeIcon, () => alive && run === iconRun)
  }
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
      typeIcon = null
      showIcon()
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
    typeIcon = type ? type.icon : null
    showIcon()
  }

  const onClick = (e: MouseEvent) => {
    if (!resolvedPath) return
    e.preventDefault()
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey) useTabs.getState().open({ kind: 'object', path: resolvedPath }, { newTab: true, via: 'link' })
    else usePeek.getState().peek(resolvedPath)
  }

  // Middle-click (auxclick) also opens a new tab, like a browser link.
  const onAux = (e: MouseEvent) => {
    if (e.button !== 1 || !resolvedPath) return
    e.preventDefault()
    useTabs.getState().open({ kind: 'object', path: resolvedPath }, { newTab: true, via: 'link' })
  }

  dom.addEventListener('click', onClick)
  dom.addEventListener('auxclick', onAux)
  void apply()
  // Re-resolve when the index reloads (objects created, renamed or deleted).
  const unsubscribe = useLinkIndex.subscribe((s, prev) => {
    if (s.revision !== prev.revision && s.loaded) void apply()
  })
  const unsubscribeSettings = useSettings.subscribe((s, prev) => {
    if (s.settings.hideEntityIconsOnInlineLinks !== prev.settings.hideEntityIconsOnInlineLinks) showIcon()
  })

  return () => {
    alive = false
    unsubscribe()
    unsubscribeSettings()
    removeIcon(dom)
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
