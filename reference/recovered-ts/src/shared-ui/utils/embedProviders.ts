import { isYoutubeUrl } from './youtubeEmbed.js'
import { isGoogleMapsUrl } from './googleMapsEmbed.js'
import { hostEndsWith } from './embedTransforms/shared.js'
import { isBandcampEmbeddableUrl, isSoundCloudEmbeddableUrl, isSpotifyEmbeddableUrl } from './embedTransforms/audio.js'
import {
  isCanvaEmbeddableUrl,
  isDesmosEmbeddableUrl,
  isDiagramsNetEmbeddableUrl,
  isFigmaEmbeddableUrl,
  isFlatEmbeddableUrl,
  isMiroEmbeddableUrl,
  isNoteflightEmbeddableUrl,
  isSketchfabEmbeddableUrl,
  isTldrawEmbeddableUrl,
} from './embedTransforms/design.js'
import { isCodepenEmbeddableUrl, isCodesandboxEmbeddableUrl, isReplitEmbeddableUrl } from './embedTransforms/dev.js'
import {
  isAirtableEmbeddableUrl,
  isArchiveOrgEmbeddableUrl,
  isCalendlyEmbeddableUrl,
  isClickUpFormEmbeddableUrl,
  isDatawrapperEmbeddableUrl,
  isExcalidrawEmbeddableUrl,
  isLucidEmbeddableUrl,
  isTableauEmbeddableUrl,
  isTallyEmbeddableUrl,
  isTypeformEmbeddableUrl,
  isXmindEmbeddableUrl,
} from './embedTransforms/forms.js'
import { isGoogleCalendarEmbeddableUrl, isGoogleSlidesEmbeddableUrl } from './embedTransforms/googleDocs.js'
import { isLoomEmbeddableUrl, isTellaEmbeddableUrl, isVimeoEmbeddableUrl } from './embedTransforms/video.js'
import { toValidatedUrl } from './embedTransforms/shared.js'

export type EmbedProvider = {
  id: string
  hostSuffixes: string[]
  sandbox: string[]
  allow: string[]
  allowWindowRedirectTo: string[]
  referrerPolicy?: 'strict-origin-when-cross-origin' | 'no-referrer'
  isEmbeddableUrl?: (url: string) => boolean
  requiresManualEmbedUrl?: boolean
}

const videoSandbox = ['allow-scripts', 'allow-same-origin', 'allow-popups']
const videoAllow = ['fullscreen', 'picture-in-picture', 'accelerometer', 'encrypted-media', 'gyroscope']

const audioSandbox = ['allow-same-origin', 'allow-scripts']
const audioAllow = ['fullscreen', 'encrypted-media']

const designSandbox = ['allow-scripts', 'allow-same-origin']
const designAllow = ['fullscreen']

const formSandbox = ['allow-same-origin', 'allow-scripts', 'allow-forms']
const formAllow = ['fullscreen']

const devSandbox = ['allow-scripts', 'allow-same-origin', 'allow-popups']
const devAllow = ['fullscreen']

export const embedProviders: EmbedProvider[] = [
  {
    id: 'youtube',
    hostSuffixes: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'],
    sandbox: videoSandbox,
    allow: videoAllow,
    allowWindowRedirectTo: [],
    referrerPolicy: 'strict-origin-when-cross-origin',
    isEmbeddableUrl: (url) => isYoutubeUrl(url) || url.includes('embed'),
  },
  {
    id: 'google-maps',
    hostSuffixes: ['google.com', 'maps.google.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: (url) => isGoogleMapsUrl(url) || url.includes('/maps/embed'),
  },
  {
    id: 'google-slides',
    hostSuffixes: ['google.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isGoogleSlidesEmbeddableUrl,
  },
  {
    id: 'google-calendar',
    hostSuffixes: ['google.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isGoogleCalendarEmbeddableUrl,
  },
  {
    id: 'vimeo',
    hostSuffixes: ['vimeo.com', 'player.vimeo.com'],
    sandbox: audioSandbox,
    allow: ['fullscreen'],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isVimeoEmbeddableUrl,
  },
  {
    id: 'spotify',
    hostSuffixes: ['spotify.com'],
    sandbox: audioSandbox,
    allow: audioAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isSpotifyEmbeddableUrl,
  },
  {
    id: 'soundcloud',
    hostSuffixes: ['soundcloud.com', 'w.soundcloud.com'],
    sandbox: audioSandbox,
    allow: [],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isSoundCloudEmbeddableUrl,
  },
  {
    id: 'bandcamp',
    hostSuffixes: ['bandcamp.com'],
    sandbox: audioSandbox,
    allow: [],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isBandcampEmbeddableUrl,
    requiresManualEmbedUrl: true,
  },
  {
    id: 'loom',
    hostSuffixes: ['loom.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isLoomEmbeddableUrl,
  },
  {
    id: 'tella',
    hostSuffixes: ['tella.tv'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isTellaEmbeddableUrl,
  },
  {
    id: 'figma',
    hostSuffixes: ['figma.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isFigmaEmbeddableUrl,
  },
  {
    id: 'miro',
    hostSuffixes: ['miro.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isMiroEmbeddableUrl,
  },
  {
    id: 'canva',
    hostSuffixes: ['canva.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isCanvaEmbeddableUrl,
  },
  {
    id: 'tldraw',
    hostSuffixes: ['tldraw.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isTldrawEmbeddableUrl,
  },
  {
    id: 'excalidraw',
    hostSuffixes: ['excalidraw.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isExcalidrawEmbeddableUrl,
  },
  {
    id: 'diagrams-net',
    hostSuffixes: ['diagrams.net', 'draw.io', 'viewer.diagrams.net', 'embed.diagrams.net', 'app.diagrams.net'],
    sandbox: devSandbox,
    allow: videoAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isDiagramsNetEmbeddableUrl,
  },
  {
    id: 'lucid',
    hostSuffixes: ['lucid.app'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isLucidEmbeddableUrl,
  },
  {
    id: 'xmind',
    hostSuffixes: ['xmind.ai', 'xmind.net'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isXmindEmbeddableUrl,
  },
  {
    id: 'sketchfab',
    hostSuffixes: ['sketchfab.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isSketchfabEmbeddableUrl,
  },
  {
    id: 'flat',
    hostSuffixes: ['flat.io', 'flat-embed.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isFlatEmbeddableUrl,
  },
  {
    id: 'noteflight',
    hostSuffixes: ['noteflight.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isNoteflightEmbeddableUrl,
  },
  {
    id: 'desmos',
    hostSuffixes: ['desmos.com'],
    sandbox: ['allow-scripts'],
    allow: ['fullscreen'],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isDesmosEmbeddableUrl,
  },
  {
    id: 'codepen',
    hostSuffixes: ['codepen.io'],
    sandbox: devSandbox,
    allow: devAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isCodepenEmbeddableUrl,
  },
  {
    id: 'codesandbox',
    hostSuffixes: ['codesandbox.io'],
    sandbox: devSandbox,
    allow: devAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isCodesandboxEmbeddableUrl,
  },
  {
    id: 'replit',
    hostSuffixes: ['replit.com'],
    sandbox: devSandbox,
    allow: devAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isReplitEmbeddableUrl,
  },
  {
    id: 'wikipedia',
    hostSuffixes: ['wikipedia.org'],
    sandbox: [],
    allow: [],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: () => true,
  },
  {
    id: 'calendly',
    hostSuffixes: ['calendly.com'],
    sandbox: formSandbox,
    allow: formAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isCalendlyEmbeddableUrl,
  },
  {
    id: 'airtable',
    hostSuffixes: ['airtable.com'],
    sandbox: formSandbox,
    allow: formAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isAirtableEmbeddableUrl,
  },
  {
    id: 'typeform',
    hostSuffixes: ['typeform.com'],
    sandbox: formSandbox,
    allow: formAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isTypeformEmbeddableUrl,
  },
  {
    id: 'tally',
    hostSuffixes: ['tally.so'],
    sandbox: formSandbox,
    allow: formAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isTallyEmbeddableUrl,
  },
  {
    id: 'todoist',
    hostSuffixes: ['todoist.com'],
    sandbox: ['allow-same-origin', 'allow-scripts', 'allow-forms', 'allow-popups'],
    allow: ['fullscreen'],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: () => true,
  },
  {
    id: 'readymag',
    hostSuffixes: ['readymag.com'],
    sandbox: designSandbox,
    allow: [],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: () => true,
  },
  {
    id: 'sharing-ia',
    hostSuffixes: ['sharing.ia.net'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: () => true,
  },
  {
    id: 'datawrapper',
    hostSuffixes: ['datawrapper.de', 'datawrapper.dwcdn.net'],
    sandbox: ['allow-scripts'],
    allow: ['fullscreen'],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isDatawrapperEmbeddableUrl,
    requiresManualEmbedUrl: true,
  },
  {
    id: 'tableau',
    hostSuffixes: ['tableau.com'],
    sandbox: ['allow-scripts', 'allow-same-origin'],
    allow: ['fullscreen'],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isTableauEmbeddableUrl,
  },
  {
    id: 'archive-org',
    hostSuffixes: ['archive.org'],
    sandbox: ['allow-scripts', 'allow-same-origin'],
    allow: ['fullscreen'],
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isArchiveOrgEmbeddableUrl,
  },
  {
    id: 'clickup',
    hostSuffixes: ['clickup.com'],
    sandbox: formSandbox,
    allow: formAllow,
    allowWindowRedirectTo: [],
    isEmbeddableUrl: isClickUpFormEmbeddableUrl,
  },
  {
    id: 'ourworldindata',
    hostSuffixes: ['ourworldindata.org'],
    sandbox: ['allow-scripts'],
    allow: [],
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'pitch',
    hostSuffixes: ['pitch.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'substack',
    hostSuffixes: ['substack.com'],
    sandbox: designSandbox,
    allow: [],
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'behance',
    hostSuffixes: ['behance.net'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'artstation',
    hostSuffixes: ['artstation.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'autodesk',
    hostSuffixes: ['autodesk.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'onshape',
    hostSuffixes: ['onshape.com'],
    sandbox: designSandbox,
    allow: designAllow,
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'wolframalpha',
    hostSuffixes: ['wolframalpha.com'],
    sandbox: ['allow-scripts'],
    allow: ['fullscreen'],
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'kaggle',
    hostSuffixes: ['kagglestatic.com', 'kaggle.com'],
    sandbox: devSandbox,
    allow: devAllow,
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'savvycal',
    hostSuffixes: ['savvycal.com'],
    sandbox: formSandbox,
    allow: formAllow,
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
  {
    id: 'anchor',
    hostSuffixes: ['anchor.fm'],
    sandbox: audioSandbox,
    allow: audioAllow,
    allowWindowRedirectTo: [],
    requiresManualEmbedUrl: true,
  },
]

function matchProvider(hostname: string) {
  let bestMatch: EmbedProvider | undefined
  let bestLength = 0

  for (const provider of embedProviders) {
    for (const suffix of provider.hostSuffixes) {
      if (hostEndsWith(hostname, suffix) && suffix.length > bestLength) {
        bestMatch = provider
        bestLength = suffix.length
      }
    }
  }

  return bestMatch
}

export function findEmbedProvider(url: string) {
  const parsed = toValidatedUrl(url)
  if (!parsed) return undefined
  return matchProvider(parsed.hostname)
}

export function findMatchingProviders(url: string) {
  const parsed = toValidatedUrl(url)
  if (!parsed) return []

  return embedProviders.filter((provider) =>
    provider.hostSuffixes.some((suffix) => hostEndsWith(parsed.hostname, suffix))
  )
}

export function findEmbeddableProvider(url: string, iframeUrl?: string) {
  const checkUrl = iframeUrl?.length ? iframeUrl : url
  const matching = findMatchingProviders(url)

  for (const provider of matching) {
    if (provider.requiresManualEmbedUrl && !provider.isEmbeddableUrl) continue
    if (!provider.isEmbeddableUrl || provider.isEmbeddableUrl(checkUrl)) {
      return provider
    }
  }

  for (const provider of matching) {
    if (provider.requiresManualEmbedUrl && provider.isEmbeddableUrl?.(checkUrl)) {
      return provider
    }
  }

  return undefined
}

export function findBaseProvider(url: string) {
  const matching = findMatchingProviders(url)
  if (!matching.length) return undefined

  return findEmbeddableProvider(url) || matching.find((provider) => provider.requiresManualEmbedUrl) || matching[0]
}

export function providerToWeblinkConfig(provider: EmbedProvider, url?: string) {
  const isEmbeddable =
    url && provider.isEmbeddableUrl ? provider.isEmbeddableUrl(url) : !provider.requiresManualEmbedUrl

  return {
    sandbox: provider.sandbox,
    allow: provider.allow,
    allowWindowRedirectTo: provider.allowWindowRedirectTo,
    customIframeUrlChecks: provider.isEmbeddableUrl,
    showAddEmbedButton: !!provider.requiresManualEmbedUrl && !isEmbeddable,
    referrerPolicy: provider.referrerPolicy,
  }
}
