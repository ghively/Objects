import { findBaseProvider, findEmbeddableProvider, providerToWeblinkConfig } from './embedProviders.js'

export const allowedEmbedMediaHosts = [
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'wikipedia.org',
  'miro.com',
  'ourworldindata.org',
  'vimeo.com',
  'player.vimeo.com',
  'spotify.com',
  'open.spotify.com',
  'soundcloud.com',
  'w.soundcloud.com',
  'google.com',
  'todoist.com',
  'readymag.com',
  'viewer.diagrams.net',
  'embed.diagrams.net',
  'diagrams.net',
  'draw.io',
  'figma.com',
  'tldraw.com',
  'sharing.ia.net',
  'excalidraw.com',
  'loom.com',
  'tella.tv',
  'xmind.ai',
  'xmind.net',
  'lucid.app',
  'canva.com',
  'sketchfab.com',
  'desmos.com',
  'codepen.io',
  'codesandbox.io',
  'replit.com',
  'calendly.com',
  'airtable.com',
  'typeform.com',
  'tally.so',
  'tableau.com',
  'archive.org',
  'clickup.com',
  'bandcamp.com',
  'flat.io',
  'noteflight.com',
  'pitch.com',
  'substack.com',
  'behance.net',
  'artstation.com',
  'autodesk.com',
  'onshape.com',
  'wolframalpha.com',
  'kaggle.com',
  'kagglestatic.com',
  'savvycal.com',
  'anchor.fm',
  'datawrapper.de',
  'datawrapper.dwcdn.net',
] as const

export type AllowedEmbedMediaHost = (typeof allowedEmbedMediaHosts)[number]

export const notAllowedSandboxValues = [] as const
export const notAllowedAllowValues = [] as const

type WeblinkEmbedConfig = {
  sandbox: string[]
  allow: string[]
  allowWindowRedirectTo: string[]
  customIframeUrlChecks?: (url: string) => boolean
  showAddEmbedButton?: boolean
  referrerPolicy?: 'strict-origin-when-cross-origin' | 'no-referrer' | undefined
}

const standardWeblinkEmbedConfig: WeblinkEmbedConfig = {
  sandbox: ['allow-scripts', 'allow-forms'],
  allow: ['fullscreen'],
  allowWindowRedirectTo: [],
}

export function getMediaHost(urlString: string | undefined) {
  if (!urlString) return undefined
  try {
    const url = new URL(urlString)
    return url?.host
  } catch (e) {}
  return undefined
}

export function getBaseEmbedConfig(url: string): WeblinkEmbedConfig | undefined {
  const provider = findBaseProvider(url)
  if (!provider) return undefined

  return providerToWeblinkConfig(provider, url)
}

export function getSpecialEmbedConfig(url: string, iframeUrl: string | undefined): WeblinkEmbedConfig | undefined {
  const provider = findEmbeddableProvider(url, iframeUrl)
  if (!provider) return undefined

  const checkUrl = iframeUrl?.length ? iframeUrl : url
  return providerToWeblinkConfig(provider, checkUrl)
}

export function getWeblinkEmbedConfig(url: string | undefined, iframeUrl: string | undefined): WeblinkEmbedConfig {
  if (!url) return standardWeblinkEmbedConfig
  const config = getSpecialEmbedConfig(url, iframeUrl)
  if (!config) return standardWeblinkEmbedConfig

  const foundSandbox = config.sandbox.find((el) => notAllowedSandboxValues.find((item) => item === el))
  config.sandbox = config.sandbox.filter((el) => !notAllowedSandboxValues.find((item) => item === el))
  if (foundSandbox) {
    console.error('not allowed sandbox value found')
  }
  const foundAllowed = config.allow.find((el) => notAllowedAllowValues.find((item) => item === el))
  config.allow = config.allow.filter((el) => !notAllowedAllowValues.find((item) => item === el))
  if (foundAllowed) {
    console.error('not allowed allow value found')
  }
  return config
}

export function embedAllowWindowRedirectTo(url: string, toUrl: string) {
  const config = getBaseEmbedConfig(url)
  if (!config) return false
  return !!config.allowWindowRedirectTo.find((el) => getMediaHost(toUrl)?.endsWith(el))
}
