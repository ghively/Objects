import { hostEndsWith, toValidatedUrl } from './shared.js'

export function buildCodepenEmbedUrl(rawUrl: string) {
  const match = rawUrl.match(/https:\/\/codepen\.io\/([^/]+)\/pen\/([^/?#]+)/)
  if (!match) return undefined
  return `https://codepen.io/${match[1]}/embed/${match[2]}`
}

export function isCodepenEmbeddableUrl(rawUrl: string) {
  return !!buildCodepenEmbedUrl(rawUrl) || /codepen\.io\/[^/]+\/embed\//.test(rawUrl)
}

export function buildCodesandboxEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'codesandbox.io')) return undefined

  if (parsed.pathname.startsWith('/embed/')) {
    return parsed.toString()
  }

  const sandboxMatch = parsed.pathname.match(/\/s\/([^/]+)/)
  if (sandboxMatch) {
    return `https://codesandbox.io/embed/${sandboxMatch[1]}`
  }

  const projectMatch = parsed.pathname.match(/\/p\/sandbox\/([^/?#]+)/)
  if (projectMatch) {
    return parsed.toString()
  }

  return undefined
}

export function isCodesandboxEmbeddableUrl(rawUrl: string) {
  return !!buildCodesandboxEmbedUrl(rawUrl)
}

export function buildReplitEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'replit.com')) return undefined

  if (!parsed.pathname.match(/^\/@[^/]+\/[^/]+/)) return undefined

  if (parsed.searchParams.get('embed') === 'true') {
    return parsed.toString()
  }

  parsed.searchParams.set('embed', 'true')
  return parsed.toString()
}

export function isReplitEmbeddableUrl(rawUrl: string) {
  return !!buildReplitEmbedUrl(rawUrl)
}
