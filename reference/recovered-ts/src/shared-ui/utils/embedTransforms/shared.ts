export function toValidatedUrl(rawUrl: string) {
  try {
    return new URL(rawUrl)
  } catch {
    return undefined
  }
}

export function hostEndsWith(hostname: string, suffix: string) {
  const host = hostname.toLowerCase()
  const normalizedSuffix = suffix.toLowerCase().replace(/^\./, '')
  return host === normalizedSuffix || host.endsWith(`.${normalizedSuffix}`)
}
