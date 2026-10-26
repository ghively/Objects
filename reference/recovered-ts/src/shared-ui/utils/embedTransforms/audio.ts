import { hostEndsWith, toValidatedUrl } from './shared.js'

const SPOTIFY_EMBED_PATHS = /^\/(track|album|artist|episode|show|playlist)\//

export function buildSpotifyEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'spotify.com')) return undefined

  if (parsed.pathname.startsWith('/embed/')) {
    return parsed.toString()
  }

  if (!SPOTIFY_EMBED_PATHS.test(parsed.pathname)) return undefined

  parsed.pathname = `/embed${parsed.pathname}`
  return parsed.toString()
}

export function isSpotifyEmbeddableUrl(rawUrl: string) {
  return !!buildSpotifyEmbedUrl(rawUrl)
}

export function buildSoundCloudEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed) return undefined

  if (hostEndsWith(parsed.hostname, 'w.soundcloud.com') && parsed.pathname.startsWith('/player')) {
    return parsed.toString()
  }

  if (!hostEndsWith(parsed.hostname, 'soundcloud.com')) return undefined

  const player = new URL('https://w.soundcloud.com/player/')
  player.searchParams.set('url', parsed.toString())
  return player.toString()
}

export function isSoundCloudEmbeddableUrl(rawUrl: string) {
  return !!buildSoundCloudEmbedUrl(rawUrl)
}

export function buildBandcampEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'bandcamp.com')) return undefined

  if (parsed.pathname.includes('/EmbeddedPlayer/')) {
    return parsed.toString()
  }

  const albumMatch = parsed.pathname.match(/\/album\/([^/?#]+)/)
  const trackMatch = parsed.pathname.match(/\/track\/([^/?#]+)/)

  if (!albumMatch && !trackMatch) return undefined

  const player = new URL(
    `https://bandcamp.com/EmbeddedPlayer/${albumMatch ? 'album' : 'track'}=${albumMatch?.[1] || trackMatch?.[1]}`
  )
  player.pathname += '/size=large/bgcol=ffffff/linkcol=0687f5/transparent=true/'
  return player.toString()
}

export function isBandcampEmbeddableUrl(rawUrl: string) {
  return !!buildBandcampEmbedUrl(rawUrl)
}
