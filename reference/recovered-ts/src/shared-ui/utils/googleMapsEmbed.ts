function toValidatedUrl(rawUrl: string) {
  try {
    return new URL(rawUrl)
  } catch {
    return undefined
  }
}

function isGoogleHost(hostname: string) {
  const host = hostname.toLowerCase()
  return host === 'maps.google.com' || host.endsWith('.google.com')
}

function hasMapsPath(pathname: string) {
  return pathname === '/maps' || pathname.startsWith('/maps/')
}

function isGoogleMapsEmbedPath(pathname: string) {
  return pathname === '/maps/embed' || pathname.startsWith('/maps/embed/')
}

function extractCoords(rawUrl: string) {
  const match = rawUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)?z)?/i)
  if (!match) return undefined
  return { lat: match[1], lng: match[2], zoom: match[3] }
}

function extractPlaceId(rawUrl: string) {
  const match = rawUrl.match(/!1s(0x[a-fA-F0-9]+:0x[a-fA-F0-9]+)/)
  if (match) return match[1]

  const encodedMatch = rawUrl.match(/!1s(0x[a-fA-F0-9]+%3A0x[a-fA-F0-9]+)/i)
  if (encodedMatch) return decodeURIComponent(encodedMatch[1])

  return undefined
}

function extractPlaceName(pathname: string) {
  const match = pathname.match(/\/place\/([^/@]+)/)
  if (!match) return undefined
  return decodeURIComponent(match[1].replace(/\+/g, ' '))
}

function extractSearchQuery(pathname: string) {
  const match = pathname.match(/\/maps\/search\/([^/]+)/)
  if (!match) return undefined
  return decodeURIComponent(match[1].replace(/\+/g, ' '))
}

function buildPbEmbedParam(lat: string, lng: string, placeId?: string, placeName?: string) {
  const version = Date.now()

  if (placeId && placeName) {
    const encodedPlaceName = encodeURIComponent(placeName)
    return `!1m18!1m12!1m3!1d20000!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s${placeId}!2s${encodedPlaceName}!5e0!3m2!1sen!2sus!4v${version}`
  }

  return `!1m14!1m12!1m3!1d20000!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2sus!4v${version}`
}

function buildMapsGoogleOutputEmbedUrl(query: string, zoom?: string) {
  const embed = new URL('https://maps.google.com/maps')
  embed.searchParams.set('q', query)
  embed.searchParams.set('output', 'embed')
  if (zoom) embed.searchParams.set('z', zoom)
  return embed.toString()
}

function appendOutputEmbed(url: URL) {
  const embedUrl = new URL(url.toString())
  embedUrl.searchParams.set('output', 'embed')
  return embedUrl.toString()
}

export function isGoogleMapsUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed) return false
  if (!isGoogleHost(parsed.hostname)) return false
  return hasMapsPath(parsed.pathname)
}

export function buildGoogleMapsEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !isGoogleMapsUrl(rawUrl)) return undefined

  if (isGoogleMapsEmbedPath(parsed.pathname)) {
    if (parsed.searchParams.has('pb') || parsed.searchParams.get('output') === 'embed') {
      return parsed.toString()
    }

    const legacyEmbedTail = parsed.search.startsWith('?') ? parsed.search.slice(1) : ''
    if (legacyEmbedTail.length) {
      const canonical = new URL(parsed.origin)
      canonical.pathname = `/maps/${legacyEmbedTail}`
      return buildGoogleMapsEmbedUrl(canonical.toString())
    }

    return parsed.toString()
  }

  if (parsed.searchParams.get('output') === 'embed') {
    return parsed.toString()
  }

  const coords = extractCoords(rawUrl)
  const placeId = extractPlaceId(rawUrl)
  const placeName = extractPlaceName(parsed.pathname)
  const searchQuery = extractSearchQuery(parsed.pathname)

  if (coords) {
    const pb = buildPbEmbedParam(coords.lat, coords.lng, placeId, placeName)
    return `https://www.google.com/maps/embed?pb=${pb}`
  }

  if (searchQuery) {
    return buildMapsGoogleOutputEmbedUrl(searchQuery)
  }

  if (placeName) {
    return buildMapsGoogleOutputEmbedUrl(placeName)
  }

  if (parsed.pathname === '/maps') {
    return appendOutputEmbed(parsed)
  }

  return appendOutputEmbed(parsed)
}
