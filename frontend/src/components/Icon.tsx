import { Icon as IconifyIcon } from '@iconify/react'
import type { IconifyIcon as IconData, IconifyJSON } from '@iconify/types'
import { getIconData } from '@iconify/utils'
import { useEffect, useState } from 'react'
import type { Icon as IconValue } from '@/api/types'

// Icons are bundled (Phosphor via @iconify-json/ph, VS Code file icons via
// @iconify-json/vscode-icons) and never fetched over the network: we hand <Icon>
// the icon data object, so Iconify's API loader is never used.

const LOADERS: Record<string, () => Promise<unknown>> = {
  ph: () => import('@iconify-json/ph/icons.json'),
  'vscode-icons': () => import('@iconify-json/vscode-icons/icons.json'),
}

/** Bundled prefixes, longest first, so `vscode-icons-…` never matches a shorter prefix. */
const PREFIXES = Object.keys(LOADERS).sort((a, b) => b.length - a.length)

const FALLBACK_PREFIX = 'ph'
const FALLBACK_NAME = 'cube'

const collections = new Map<string, IconifyJSON>()
const loading = new Map<string, Promise<IconifyJSON>>()

function loadCollection(prefix: string): Promise<IconifyJSON> {
  const have = collections.get(prefix)
  if (have) return Promise.resolve(have)
  let p = loading.get(prefix)
  if (!p) {
    p = LOADERS[prefix]().then((m) => {
      const json = ((m as { default?: IconifyJSON }).default ?? m) as IconifyJSON
      collections.set(prefix, json)
      return json
    })
    loading.set(prefix, p)
  }
  return p
}

/** `{prefix, name}` for an Iconify id, or `prefix: null` when its prefix isn't bundled. */
export function parseIconId(id: string): { prefix: string | null; name: string } {
  for (const prefix of PREFIXES) {
    if (id.startsWith(`${prefix}-`) || id.startsWith(`${prefix}:`)) {
      return { prefix, name: id.slice(prefix.length + 1) }
    }
  }
  if (id.includes(':')) return { prefix: null, name: id }
  // A bare name ("check-circle") is a Phosphor icon, as in M1.
  return { prefix: 'ph', name: id }
}

/** "ph-check-circle", "ph:check-circle" or "check-circle" → "check-circle". */
export function phName(name: string): string {
  return name.replace(/^ph[-:]/, '')
}

/** True for an Iconify id (`ph-…`, `vscode-icons:…`), false for an emoji or other text. */
export function isIconifyId(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*[:-][a-z0-9]/i.test(s)
}

/** The icon id or emoji to render: an `Icon`'s `val`, a string as is, or `fallback` when empty. */
export function iconName(icon: IconValue | string | null | undefined, fallback: string): string {
  const v = typeof icon === 'string' ? icon : icon?.val
  return v && v.trim() ? v : fallback
}

interface Resolved {
  data: IconData
  /** `prefix:name` of the icon actually drawn. */
  resolved: string
  fallback: boolean
}

function lookupSync(id: string): Resolved | null | undefined {
  const { prefix, name } = parseIconId(id)
  if (prefix) {
    const json = collections.get(prefix)
    if (!json) return undefined // not loaded yet
    const data = getIconData(json, name)
    if (data) return { data, resolved: `${prefix}:${name}`, fallback: false }
  }
  const ph = collections.get(FALLBACK_PREFIX)
  if (!ph) return undefined
  const data = getIconData(ph, FALLBACK_NAME)
  return data ? { data, resolved: `${FALLBACK_PREFIX}:${FALLBACK_NAME}`, fallback: true } : null
}

async function lookup(id: string): Promise<Resolved | null> {
  const { prefix } = parseIconId(id)
  await Promise.all([prefix ? loadCollection(prefix) : null, loadCollection(FALLBACK_PREFIX)])
  return lookupSync(id) ?? null
}

/**
 * An `Icon` value or a frontmatter icon string: an Iconify id renders as an icon, anything else
 * (an emoji) as text. Nothing (and no fallback) renders nothing.
 */
export function IconOrEmoji({
  icon,
  size,
  fallback,
  className,
}: {
  icon: IconValue | string | null | undefined
  size: number
  fallback?: string
  className?: string
}) {
  const val = iconName(icon, fallback ?? '')
  if (!val) return null
  const emoji = typeof icon === 'object' && icon && icon.val.trim() ? icon.type === 'emoji' : !isIconifyId(val)
  if (!emoji) return <Icon name={val} size={size} className={className} />
  return (
    <span aria-hidden className={className} style={{ fontSize: size, lineHeight: 1 }}>
      {val}
    </span>
  )
}

export interface IconProps {
  /** Any Iconify id with a bundled prefix (`ph`, `vscode-icons`); anything else renders `ph-cube`. */
  name: string
  size?: number
  className?: string
}

export function Icon({ name, size = 16, className }: IconProps) {
  const [state, setState] = useState<{ name: string; r: Resolved | null } | null>(() => {
    const r = lookupSync(name)
    return r === undefined ? null : { name, r }
  })

  useEffect(() => {
    let alive = true
    const r = lookupSync(name)
    if (r !== undefined) {
      setState({ name, r })
      return
    }
    void lookup(name).then((res) => {
      if (alive) setState({ name, r: res })
    })
    return () => {
      alive = false
    }
  }, [name])

  const r = state && state.name === name ? state.r : null
  if (!r) {
    return (
      <span
        aria-hidden
        data-icon={name}
        className={className}
        style={{ display: 'inline-block', width: size, height: size }}
      />
    )
  }
  return (
    <IconifyIcon
      icon={r.data}
      width={size}
      height={size}
      className={className}
      aria-hidden
      data-icon={name}
      data-resolved={r.resolved}
      {...(r.fallback ? { title: name } : {})}
    />
  )
}
