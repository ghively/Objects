import { Icon as IconifyIcon } from '@iconify/react'
import type { IconifyIcon as IconData, IconifyJSON } from '@iconify/types'
import { getIconData } from '@iconify/utils'
import { useEffect, useState } from 'react'

// Icons are bundled (Phosphor via @iconify-json/ph) and never fetched over the network:
// we hand <Icon> the icon data object, so Iconify's API loader is never used.

let collection: IconifyJSON | null = null
let loading: Promise<IconifyJSON> | null = null

function loadCollection(): Promise<IconifyJSON> {
  if (collection) return Promise.resolve(collection)
  loading ??= import('@iconify-json/ph/icons.json').then((m) => {
    collection = ((m as { default?: IconifyJSON }).default ?? m) as IconifyJSON
    return collection
  })
  return loading
}

/** "ph-check-circle", "ph:check-circle" or "check-circle" → "check-circle". */
export function phName(name: string): string {
  return name.replace(/^ph[-:]/, '')
}

function lookup(name: string): IconData | null {
  if (!collection) return null
  return getIconData(collection, phName(name)) ?? getIconData(collection, 'cube')
}

export interface IconProps {
  name: string
  size?: number
  className?: string
}

export function Icon({ name, size = 16, className }: IconProps) {
  const [data, setData] = useState<IconData | null>(() => lookup(name))

  useEffect(() => {
    let alive = true
    if (collection) {
      setData(lookup(name))
      return
    }
    void loadCollection().then(() => {
      if (alive) setData(lookup(name))
    })
    return () => {
      alive = false
    }
  }, [name])

  if (!data) {
    return (
      <span
        aria-hidden
        className={className}
        style={{ display: 'inline-block', width: size, height: size }}
      />
    )
  }
  return <IconifyIcon icon={data} width={size} height={size} className={className} aria-hidden />
}
