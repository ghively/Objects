import { hostEndsWith, toValidatedUrl } from './shared.js'

export function buildTallyEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'tally.so')) return undefined

  if (parsed.pathname.startsWith('/embed/')) {
    return parsed.toString()
  }

  const formMatch = parsed.pathname.match(/^\/r\/([^/]+)/)
  if (!formMatch) return undefined

  parsed.pathname = `/embed/${formMatch[1]}`
  return parsed.toString()
}

export function isTallyEmbeddableUrl(rawUrl: string) {
  return !!buildTallyEmbedUrl(rawUrl)
}

export function isAirtableEmbeddableUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'airtable.com')) return false
  return parsed.pathname.startsWith('/embed/')
}

export function isTypeformEmbeddableUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'typeform.com')) return false
  return parsed.hostname.startsWith('form.') || parsed.pathname.includes('/to/')
}

export function isCalendlyEmbeddableUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'calendly.com')) return false
  return parsed.pathname.length > 1
}

export function isTableauEmbeddableUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'tableau.com')) return false
  return (
    parsed.hostname.startsWith('public.') || parsed.search.includes(':embed=yes') || parsed.pathname.includes('/views/')
  )
}

export function isArchiveOrgEmbeddableUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'archive.org')) return false
  return parsed.pathname.includes('/embed/')
}

export function isDatawrapperEmbeddableUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed) return false
  return hostEndsWith(parsed.hostname, 'datawrapper.dwcdn.net') || parsed.pathname.includes('/embed/')
}

export function isClickUpFormEmbeddableUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'clickup.com')) return false
  return parsed.pathname.includes('/f/') || parsed.hostname.startsWith('forms.')
}

export function isExcalidrawEmbeddableUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'excalidraw.com')) return false
  return parsed.hash.includes('room=') || parsed.hash.includes('json=') || parsed.searchParams.has('embed')
}

export function isLucidEmbeddableUrl(rawUrl: string) {
  return rawUrl.includes('lucid.app/embed')
}

export function isXmindEmbeddableUrl(rawUrl: string) {
  return /xmind\.(ai|net)\/embed/.test(rawUrl)
}
