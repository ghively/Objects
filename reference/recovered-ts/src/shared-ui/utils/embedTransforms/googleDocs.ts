import { hostEndsWith, toValidatedUrl } from './shared.js'

export function isGoogleSlidesUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'google.com')) return false
  return parsed.pathname.includes('/presentation')
}

export function buildGoogleSlidesEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !isGoogleSlidesUrl(rawUrl)) return undefined

  if (parsed.pathname.match(/\/embed\/?$/)) {
    return parsed.toString()
  }

  if (!parsed.pathname.match(/\/pub\/?$/)) return undefined

  parsed.pathname = parsed.pathname.replace(/\/pub\/?$/, '/embed')
  parsed.search = ''
  return parsed.toString()
}

export function isGoogleSlidesEmbeddableUrl(rawUrl: string) {
  return !!buildGoogleSlidesEmbedUrl(rawUrl)
}

export function isGoogleCalendarUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !hostEndsWith(parsed.hostname, 'google.com')) return false
  return parsed.pathname.includes('/calendar')
}

export function buildGoogleCalendarEmbedUrl(rawUrl: string) {
  const parsed = toValidatedUrl(rawUrl)
  if (!parsed || !isGoogleCalendarUrl(rawUrl)) return undefined

  if (parsed.pathname.match(/\/calendar\/embed/)) {
    return parsed.toString()
  }

  const cid = parsed.searchParams.get('cid')
  if (!cid) return undefined

  const embed = new URL(parsed.origin)
  embed.pathname = '/calendar/embed'
  embed.searchParams.set('src', cid)
  return embed.toString()
}

export function isGoogleCalendarEmbeddableUrl(rawUrl: string) {
  return !!buildGoogleCalendarEmbedUrl(rawUrl)
}
