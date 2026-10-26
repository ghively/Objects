import { hostEndsWith, toValidatedUrl } from './shared.js'

const FIGMA_FILE_RE =
  /^https:\/\/([\w.-]+\.)?figma\.com\/(file|proto|design|board|slides|deck)\/([0-9a-zA-Z]{22,128})(?:\/.*)?$/

const TLDRAW_APP_RE = /^\/[fprsv]\/[^/]+\/?$/

export function buildFigmaEmbedUrl(rawUrl: string) {
  if (rawUrl.includes('embed.figma.com')) return rawUrl

  if (FIGMA_FILE_RE.test(rawUrl) && !rawUrl.includes('figma.com/embed')) {
    const embed = new URL(rawUrl.replace(/:\/\/([\w.-]+\.)?figma\.com/, '://embed.figma.com'))
    embed.searchParams.set('embed-host', 'capacities')
    return embed.toString()
  }

  if (rawUrl.includes('figma.com/embed')) return rawUrl

  return undefined
}

export function isFigmaEmbeddableUrl(rawUrl: string) {
  return !!buildFigmaEmbedUrl(rawUrl)
}

export function buildMiroEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'miro.com')) return undefined

  if (parsed.pathname.includes('/live-embed/')) {
    return parsed.toString()
  }

  const boardMatch = parsed.pathname.match(/\/app\/board\/([^/]+)/)
  if (!boardMatch) return undefined

  parsed.pathname = `/app/live-embed/${boardMatch[1]}/`
  return parsed.toString()
}

export function isMiroEmbeddableUrl(rawUrl: string) {
  return !!buildMiroEmbedUrl(rawUrl)
}

export function buildCanvaEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'canva.com')) return undefined

  if (!parsed.pathname.match(/^\/design\/([^/]+)\/.+/)) return undefined

  if (parsed.searchParams.has('embed')) {
    return parsed.toString()
  }

  parsed.searchParams.set('embed', '')
  return parsed.toString()
}

export function isCanvaEmbeddableUrl(rawUrl: string) {
  return !!buildCanvaEmbedUrl(rawUrl)
}

export function buildTldrawEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'tldraw.com')) return undefined

  if (!parsed.pathname.match(TLDRAW_APP_RE)) return undefined

  if (parsed.searchParams.get('embed') === 'true') {
    return parsed.toString()
  }

  parsed.searchParams.set('embed', 'true')
  return parsed.toString()
}

export function isTldrawEmbeddableUrl(rawUrl: string) {
  return !!buildTldrawEmbedUrl(rawUrl)
}

export function buildDesmosEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'desmos.com')) return undefined

  if (!parsed.pathname.match(/^\/calculator\/([^/]+)\/?$/)) return undefined

  if (parsed.search === '?embed') {
    return parsed.toString()
  }

  if (parsed.search || parsed.hash) return undefined

  parsed.search = '?embed'
  return parsed.toString()
}

export function isDesmosEmbeddableUrl(rawUrl: string) {
  return !!buildDesmosEmbedUrl(rawUrl)
}

export function buildDiagramsNetEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed) return undefined

  const host = parsed.hostname.toLowerCase()

  if (host === 'embed.diagrams.net') {
    if (!parsed.searchParams.has('embed')) {
      parsed.searchParams.set('embed', '1')
    }
    return parsed.toString()
  }

  if (host === 'viewer.diagrams.net') {
    return parsed.toString()
  }

  if (host.endsWith('draw.io') || host === 'app.diagrams.net' || host === 'www.diagrams.net') {
    const viewer = new URL('https://viewer.diagrams.net/')
    viewer.hash = `U${encodeURIComponent(parsed.toString())}`
    return viewer.toString()
  }

  return undefined
}

export function isDiagramsNetEmbeddableUrl(rawUrl: string) {
  return !!buildDiagramsNetEmbedUrl(rawUrl)
}

export function buildFlatEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'flat.io')) return undefined

  if (parsed.pathname.includes('/embed/')) {
    return parsed.toString()
  }

  const scoreMatch = parsed.pathname.match(/\/scores?\/([^/]+)/)
  if (!scoreMatch) return undefined

  return `https://flat.io/embed/${scoreMatch[1]}`
}

export function isFlatEmbeddableUrl(rawUrl: string) {
  return !!buildFlatEmbedUrl(rawUrl) || hostEndsWith(toValidatedUrl(rawUrl)?.hostname || '', 'flat-embed.com')
}

export function buildNoteflightEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'noteflight.com')) return undefined

  if (parsed.pathname.includes('/embed/')) {
    return parsed.toString()
  }

  return undefined
}

export function isNoteflightEmbeddableUrl(rawUrl: string) {
  return !!buildNoteflightEmbedUrl(rawUrl)
}

export function buildSketchfabEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'sketchfab.com')) return undefined

  if (parsed.pathname.includes('/embed')) {
    return parsed.toString()
  }

  const modelMatch = parsed.pathname.match(/\/models\/([^/]+)/)
  if (!modelMatch) return undefined

  parsed.pathname = `/models/${modelMatch[1]}/embed`
  return parsed.toString()
}

export function isSketchfabEmbeddableUrl(rawUrl: string) {
  return !!buildSketchfabEmbedUrl(rawUrl)
}
