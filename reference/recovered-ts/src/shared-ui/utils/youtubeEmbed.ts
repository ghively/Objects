const YOUTUBE_PROXY_PATH = '/youtube-proxy.html'
const YOUTUBE_WEB_FALLBACK_ORIGIN = 'https://app.capacities.io'

const FORWARDED_YOUTUBE_PARAMS = [
  'autoplay',
  'controls',
  'disablekb',
  'end',
  'fs',
  'hl',
  'iv_load_policy',
  'list',
  'listType',
  'loop',
  'modestbranding',
  'mute',
  'playlist',
  'playsinline',
  'rel',
  'start',
] as const

function getSafeRuntimeOrigin() {
  if (typeof window === 'undefined') return YOUTUBE_WEB_FALLBACK_ORIGIN
  const protocol = window.location.protocol
  const isHttpScheme = protocol === 'http:' || protocol === 'https:'
  return isHttpScheme ? window.location.origin : YOUTUBE_WEB_FALLBACK_ORIGIN
}

function getVideoIdFromYoutubeUrl(url: URL) {
  const host = url.hostname.toLowerCase()

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id || undefined
  }

  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (url.pathname.startsWith('/embed/')) {
      const id = url.pathname.replace('/embed/', '').split('/')[0]
      return id || undefined
    }

    if (url.pathname === '/watch') {
      return url.searchParams.get('v') || undefined
    }
  }

  return undefined
}

function toValidatedYoutubeUrl(rawUrl: string) {
  try {
    return new URL(rawUrl)
  } catch {
    return undefined
  }
}

export function isYoutubeUrl(rawUrl: string) {
  const parsed = toValidatedYoutubeUrl(rawUrl)
  if (!parsed) return false
  return !!getVideoIdFromYoutubeUrl(parsed)
}

export function buildYoutubeDirectEmbedUrl(rawUrl: string, widgetReferrer?: string) {
  const parsed = toValidatedYoutubeUrl(rawUrl)
  if (!parsed) return undefined

  const videoId = getVideoIdFromYoutubeUrl(parsed)
  if (!videoId) return undefined

  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`)

  for (const key of FORWARDED_YOUTUBE_PARAMS) {
    const value = parsed.searchParams.get(key)
    if (value !== null) embedUrl.searchParams.set(key, value)
  }

  embedUrl.searchParams.set('enablejsapi', '1')
  embedUrl.searchParams.set('origin', getSafeRuntimeOrigin())
  if (widgetReferrer) embedUrl.searchParams.set('widget_referrer', widgetReferrer)

  if (embedUrl.searchParams.get('loop') === '1' && !embedUrl.searchParams.get('playlist')) {
    embedUrl.searchParams.set('playlist', videoId)
  }

  return embedUrl.toString()
}

export function buildYoutubeProxyUrl(rawUrl: string) {
  const parsed = toValidatedYoutubeUrl(rawUrl)
  if (!parsed) return undefined

  const videoId = getVideoIdFromYoutubeUrl(parsed)
  if (!videoId) return undefined

  const runtimeOrigin = typeof window === 'undefined' ? YOUTUBE_WEB_FALLBACK_ORIGIN : window.location.origin
  const proxyUrl = new URL(YOUTUBE_PROXY_PATH, runtimeOrigin)
  proxyUrl.searchParams.set('v', videoId)

  for (const key of FORWARDED_YOUTUBE_PARAMS) {
    const value = parsed.searchParams.get(key)
    if (value !== null) proxyUrl.searchParams.set(key, value)
  }

  if (proxyUrl.searchParams.get('loop') === '1' && !proxyUrl.searchParams.get('playlist')) {
    proxyUrl.searchParams.set('playlist', videoId)
  }

  return proxyUrl.toString()
}

export function buildYoutubeEmbedRuntimeUrl(rawUrl: string, options?: { useProxy?: boolean; widgetReferrer?: string }) {
  const useProxy = options?.useProxy ?? true

  if (useProxy) {
    const proxyUrl = buildYoutubeProxyUrl(rawUrl)
    if (proxyUrl) return proxyUrl
  }

  return buildYoutubeDirectEmbedUrl(rawUrl, options?.widgetReferrer)
}
