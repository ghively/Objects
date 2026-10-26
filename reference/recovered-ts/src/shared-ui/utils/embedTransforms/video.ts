import { hostEndsWith, toValidatedUrl } from './shared.js'

export function buildVimeoEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'vimeo.com')) return undefined

  if (hostEndsWith(parsed.hostname, 'player.vimeo.com')) {
    return parsed.toString()
  }

  const pathMatch = parsed.pathname.match(/^\/(\d+)/)
  if (!pathMatch) return undefined

  const embed = new URL(`https://player.vimeo.com/video/${pathMatch[1]}`)
  embed.searchParams.set('title', '0')
  embed.searchParams.set('byline', '0')

  const hash = parsed.searchParams.get('h')
  if (hash) embed.searchParams.set('h', hash)

  return embed.toString()
}

export function isVimeoEmbeddableUrl(rawUrl: string) {
  return !!buildVimeoEmbedUrl(rawUrl)
}

export function buildLoomEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'loom.com')) return undefined

  if (parsed.pathname.includes('/embed/')) {
    return parsed.toString()
  }

  const shareMatch = parsed.pathname.match(/\/share\/([^/]+)/)
  if (!shareMatch) return undefined

  parsed.pathname = `/embed/${shareMatch[1]}`
  return parsed.toString()
}

export function isLoomEmbeddableUrl(rawUrl: string) {
  return !!buildLoomEmbedUrl(rawUrl)
}

export function buildTellaEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'tella.tv')) return undefined

  if (parsed.pathname.includes('/embed')) {
    return parsed.toString()
  }

  const videoMatch = parsed.pathname.match(/\/video\/([^/]+)/)
  if (!videoMatch) return undefined

  parsed.pathname = `/video/${videoMatch[1]}/embed`
  return parsed.toString()
}

export function isTellaEmbeddableUrl(rawUrl: string) {
  return !!buildTellaEmbedUrl(rawUrl)
}
