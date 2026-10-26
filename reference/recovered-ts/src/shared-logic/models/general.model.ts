import { z } from 'zod'
import type { Icon } from './blocks.model.js'
import {
  Component,
  ComponentError,
  ComponentFull,
  CTypes,
  RootDatabaseFull,
  RootDatabasePreview,
  RootStructureFull,
  type TaskPriority,
} from './component.model.js'
import type { DateResolution } from './date.model.js'
import type { LabelStatusCategory } from './property.model.js'

export const AUTH_UPDATE_COOKIE_PATHS = [
  {
    path: '/content/sync',
    method: 'PATCH',
  },
]
export const AUTH_COOKIE_PATHS = [
  ...AUTH_UPDATE_COOKIE_PATHS,
  {
    path: '/user/login',
    method: 'POST',
  },
  {
    path: '/user',
    method: 'POST',
  },
  {
    path: '/user/logout',
    method: 'POST',
  },
  {
    path: '/user/updatePassword',
    method: 'POST',
  },
]

/* INSTRUCTIONS FOR ADDING A NEW LANGUAGE:
1. Add the language key to the languageKeys array
2. Add the language object to the languageObjects record
3. Import locale in timeBackbone.ts
4. Add language to getDMYDateFormatter and getMDYDateFormatter in timeBackbone.ts
5. Add language to languages in main.ts in ai-translate
6. Add language to getChronoConfiguration in parseNaturalLanguageDate.ts
7. Add language to emojiDataLoaders and emojiMessagesLoaders in emoji.ts
8. Add language to Notion form for language suggestions
9. Add language to locales in i18n.ts
10. Add language to locales in i18n in portal
11. Add language to electron in 'i18n.next.config.ts' (import `locales/core/{lang}.json`)
12. Run `node locales/extract-core-locales.mjs` so `locales/core/{lang}.json` exists
*/
export const languageKeys = ['en', 'en-gb', 'de', 'fr', 'es', 'nl', 'pt-br', 'hu', 'it'] as const
export type LanguageKey = (typeof languageKeys)[number]

export const languageObjects: Record<
  LanguageKey,
  {
    name: string
    icon: Icon
    state: 'internal' | 'nightly' | 'experimental' | 'production'
    connectorWords: Set<string>
  }
> = {
  en: {
    name: 'English',
    icon: { type: 'emoji', val: '🇺🇸' },
    state: 'production',
    connectorWords: new Set([
      'a',
      'an',
      'and',
      'as',
      'at',
      'because',
      'but',
      'by',
      'en',
      'for',
      'if',
      'in',
      'neither',
      'nor',
      'of',
      'on',
      'only',
      'or',
      'over',
      'per',
      'so',
      'some',
      'than',
      'that',
      'the',
      'to',
      'up',
      'upon',
      'v',
      'versus',
      'via',
      'vs',
      'when',
      'with',
      'without',
      'yet',
      'from',
    ]),
  },
  'en-gb': {
    name: 'English (UK)',
    icon: { type: 'emoji', val: '🇬🇧' },
    state: 'production',
    connectorWords: new Set([
      'a',
      'an',
      'and',
      'as',
      'at',
      'because',
      'but',
      'by',
      'en',
      'for',
      'if',
      'in',
      'neither',
      'nor',
      'of',
      'on',
      'only',
      'or',
      'over',
      'per',
      'so',
      'some',
      'than',
      'that',
      'the',
      'to',
      'up',
      'upon',
      'v',
      'versus',
      'via',
      'vs',
      'when',
      'with',
      'without',
      'yet',
      'from',
    ]),
  },
  de: {
    name: 'Deutsch',
    icon: { type: 'emoji', val: '🇩🇪' },
    state: 'production',
    connectorWords: new Set([
      'ein',
      'eine',
      'und',
      'als',
      'bei',
      'weil',
      'aber',
      'durch',
      'en',
      'für',
      'wenn',
      'in',
      'weder',
      'noch',
      'von',
      'auf',
      'nur',
      'oder',
      'über',
      'pro',
      'so',
      'einige',
      'als',
      'dass',
      'die',
      'zu',
      'auf',
      'bei',
      'v',
      'gegen',
      'über',
      'vs',
      'via',
      'vs',
      'wenn',
      'mit',
      'ohne',
      'noch',
      'von',
    ]),
  },
  fr: {
    name: 'Français',
    icon: { type: 'emoji', val: '🇫🇷' },
    state: 'production',
    connectorWords: new Set([
      'à',
      'au',
      'aux',
      'avec',
      'car',
      'ce',
      'ces',
      'comme',
      'dans',
      'de',
      'des',
      'du',
      'en',
      'et',
      'la',
      'le',
      'les',
      'mais',
      'ni',
      'ou',
      'par',
      'pour',
      'que',
      'qui',
      'sans',
      'si',
      'sur',
      'un',
      'une',
      'vers',
      'via',
      'vs',
    ]),
  },
  es: {
    name: 'Español',
    icon: { type: 'emoji', val: '🇪🇸' },
    state: 'production',
    connectorWords: new Set([
      'a',
      'al',
      'con',
      'de',
      'del',
      'el',
      'en',
      'entre',
      'la',
      'las',
      'los',
      'o',
      'para',
      'por',
      'que',
      'sin',
      'sobre',
      'tras',
      'un',
      'una',
      'uno',
      'unos',
      'unas',
      'y',
      'via',
      'vs',
    ]),
  },
  nl: {
    name: 'Dutch',
    icon: { type: 'emoji', val: '🇳🇱' },
    state: 'production',
    connectorWords: new Set([
      'aan',
      'als',
      'bij',
      'dan',
      'dat',
      'de',
      'den',
      'der',
      'des',
      'door',
      'een',
      'en',
      'het',
      'in',
      'maar',
      'met',
      'naar',
      'noch',
      'of',
      'om',
      'onder',
      'op',
      'over',
      'per',
      'te',
      'ter',
      'tot',
      'uit',
      'van',
      'via',
      'voor',
      'vs',
      'wanneer',
      'zonder',
      'zodat',
    ]),
  },
  'pt-br': {
    name: 'Português (BR)',
    icon: { type: 'emoji', val: '🇧🇷' },
    state: 'production',
    connectorWords: new Set([
      'a',
      'ao',
      'aos',
      'as',
      'com',
      'da',
      'das',
      'de',
      'do',
      'dos',
      'e',
      'em',
      'entre',
      'mas',
      'na',
      'nas',
      'nem',
      'no',
      'nos',
      'o',
      'os',
      'ou',
      'para',
      'pela',
      'pelas',
      'pelo',
      'pelos',
      'por',
      'que',
      'sem',
      'sob',
      'sobre',
      'um',
      'uma',
      'via',
      'vs',
    ]),
  },
  hu: {
    name: 'Magyar',
    icon: { type: 'emoji', val: '🇭🇺' },
    state: 'production',
    connectorWords: new Set([
      'a',
      'az',
      'és',
      'vagy',
      'de',
      'ha',
      'hogy',
      'is',
      'mint',
      'nem',
      'csak',
      'már',
      'még',
      'át',
      'be',
      'ki',
      'le',
      'fel',
      'meg',
      'el',
      'rá',
      'szerint',
      'által',
      'után',
      'között',
      'miatt',
    ]),
  },
  it: {
    name: 'Italian',
    icon: { type: 'emoji', val: '🇮🇹' },
    state: 'production',
    connectorWords: new Set([
      'a',
      'al',
      'con',
      'di',
      'del',
      'lui',
      'in',
      'fra',
      'il',
      'o',
      'per',
      'di',
      'quello',
      'senza',
      'di',
      'dopo',
      'un',
      'uno',
      'alcuni',
      'unghia',
      'e',
      'via',
      'contro',
    ]),
  },
} as const

export type DatabaseTree = {
  defaultDatabase: RootDatabaseFull
  structure: RootStructureFull | undefined
  collections: (RootDatabaseFull | RootDatabasePreview)[]
}[]

export type DatabaseTreeFrontend = {
  defaultDatabase: RootDatabaseFull
  structure: RootStructureFull
  collections: (RootDatabaseFull | RootDatabasePreview)[]
}[]

export type MutationWrapperAsync<T> = (
  componentIdentifiers: { id: string; type: CTypes | undefined }[],
  cb: (createdComponentIdentifiers: { id: string; type: CTypes | undefined }[]) => T | Promise<T>
) => Promise<T | undefined>

export type MutationWrapperSync<T> = (
  componentIdentifiers: { id: string; type: CTypes | undefined }[],
  cb: (createdComponentIdentifiers: { id: string; type: CTypes | undefined }[]) => T
) => T | undefined

export type DeviceInfo = {
  deviceId: string
  platform: string
  release: string
}

export type DeviceConfig = {}

export type InAppState = {
  loggedIn: boolean
  isAdmin: boolean
  isCapacitiesTeam: boolean
}

export type SpacesStore = Map<string, Map<string, Component>>

export enum SyncGlobalStates {
  Idle = 'idle',
  Syncing = 'syncing',
}

export enum SyncComponentStates {
  Idle = 'idle',
  Blocked = 'blocked',
  Error = 'error',
}

export interface SyncComponentStore {
  state: SyncComponentStates
  lastUsedSpaceId: string
  cachedComponent: ComponentFull | ComponentError | undefined
}

export interface GlobalSyncStore {
  state: SyncGlobalStates
  globalErrorCounter: number
  notInSync: boolean
  waitForComponentLoads: string[]
  openComponentMutations: { componentId: string; runId: string }[]
  componentsClosePending: string[]
  componentsClosed: string[]
  componentStores: Map<string, SyncComponentStore>
  backendStateCache: Map<string, ComponentFull | ComponentError>
}

// !! needs to be reflected in express and backend
export const versionStatePlatformSchema = z.enum([
  'web',
  'desktop',
  'ios',
  'android',
  'landing',
  'webextension',
  'publicapi',
])
export type VersionState = {
  platform: z.infer<typeof versionStatePlatformSchema>
  version: string
  build?: 'nightly' | undefined
}

export type CreateNewObjectSearchParams = {
  spaceId: string | undefined
  type: string | undefined
  title: string | undefined
  content: string | undefined
}

export type AppendToDailyNoteSearchParams = {
  spaceId: string | undefined
  content: string | undefined
}

export type ChecklistKey = 'getStarted' | 'goCrossPlatform' | 'usefulKeyboardShortcuts' | 'discoverPro'

export const serverContextDto = z.object({
  maintenance: z
    .object({
      id: z.string(),
      start: z.iso.datetime(),
      end: z.iso.datetime(),
    })
    .optional(),
  on1: z.boolean().optional(),
  on2: z.boolean().optional(),
})
export type ServerContextDto = z.infer<typeof serverContextDto>

export type SpaceElementMetadata = {
  databaseIds: string[]
  tagIds: string[]
  icon?: Icon
  readwiseId?: string
  isTemplate?: boolean
  isDefaultDatabase?: boolean
  /** Derived in the worker from a parent's `media_previewImage`; never persisted. */
  isPreviewImage?: boolean
  aliases?: string[] | undefined
  task?:
    | {
        statusId?: string | undefined
        statusCategory?: LabelStatusCategory | undefined
        priority?: TaskPriority | undefined
      }
    | undefined
  dailyNote?:
    | {
        reviewed?: boolean | undefined
      }
    | undefined
}

export type SpaceElement = {
  id: string
  spaceId: string
  structureId: string
  title: string | undefined
  createdAt: string
  lastUpdated?: string
  dateResolution?: DateResolution
  startTime?: string
  endTime?: string
} & SpaceElementMetadata

export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

export type LastOfUnion<U> =
  UnionToIntersection<U extends unknown ? (x: U) => void : never> extends (x: infer L) => void ? L : never

export type UnionToTuple<U, L = LastOfUnion<U>> = [U] extends [never] ? [] : [...UnionToTuple<Exclude<U, L>>, L]

export type Tuple<T, N extends number, R extends readonly T[] = []> = R['length'] extends N ? R : Tuple<T, N, [...R, T]>
export type AtLeastN<T, N extends number> = [...Tuple<T, N>, ...T[]]
export type NonEmptyArray<T> = AtLeastN<T, 1>
export type AtMostN<T, N extends number, R extends readonly T[] = []> = R['length'] extends N
  ? R
  : R | AtMostN<T, N, [...R, T]>

export type ArrayBetween<
  T,
  Min extends number,
  Max extends number,
  R extends readonly T[] = Tuple<T, Min>,
> = R['length'] extends Max ? R : R | ArrayBetween<T, Min, Max, [...R, T]>

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type DeepPartialPick<T, F extends keyof T> = Omit<T, F> & DeepPartial<Pick<T, F>>
export type DeepNonNullable<T> = {
  [P in keyof T]: T[P] extends object ? DeepNonNullable<T[P]> : NonNullable<T[P]>
}
export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P]
}

export type PartialPick<T, F extends keyof T> = Omit<T, F> & Partial<Pick<T, F>>

export type Values<T extends Record<string | number | symbol, unknown>> = T[keyof T]
export type RequiredPick<T, F extends keyof T> = Omit<T, F> & Required<Pick<T, F>>
export type NonNullablePick<T, F extends keyof T> = Omit<T, F> & DeepNonNullable<Pick<T, F>>

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Something = {}
export type Writeable<T> = { -readonly [P in keyof T]: T[P] }
export type MaybePromise<T> = T | Promise<T>
export type MaybeReadonly<T> = T | Readonly<T>

export type Paths<T> = T extends object
  ? {
      [K in keyof T]-?: K extends string | number
        ? T[K] extends Array<infer U>
          ? `${K}` | `${K}.${number}` | `${K}.${number}.${Paths<U>}`
          : string extends keyof T[K]
            ? `${K}` | `${K}.${string}` | `${K}.${string}.${Paths<T[K][string]>}`
            : number extends keyof T[K]
              ? `${K}` | `${K}.${number}` | `${K}.${number}.${Paths<T[K][number]>}`
              : T[K] extends object
                ? `${K}` | `${K}.${Paths<T[K]>}`
                : `${K}`
        : never
    }[keyof T]
  : never

export type DeepReadonly<T> =
  T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends WeakMap<infer K, infer V>
        ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends Set<infer U>
          ? ReadonlySet<DeepReadonly<U>>
          : T extends ReadonlySet<infer U>
            ? ReadonlySet<DeepReadonly<U>>
            : T extends WeakSet<infer U>
              ? WeakSet<DeepReadonly<U>>
              : T extends Promise<infer U>
                ? Promise<DeepReadonly<U>>
                : T extends Function
                  ? T
                  : T extends Something
                    ? {
                        readonly [K in keyof T]: DeepReadonly<T[K]>
                      }
                    : Readonly<T>

export type Entries<T> = {
  [K in keyof T]: [K, T[K]]
}[keyof T][]

export type MaybeArray<T> = T[] | T
export type Nullable<T> = T | null | undefined
export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

declare const _BrandSymbol: {
  readonly Glob: unique symbol
  readonly BulkImportId: unique symbol
  readonly TimeoutId: unique symbol
  readonly NormalizedPath: unique symbol
  readonly AbsolutePath: unique symbol
  readonly RelativePath: unique symbol
}

declare const __brand: unique symbol
type Brand<B extends symbol> = { readonly [__brand]: B }
export type Branded<T, B extends symbol> = T & Brand<B>

export type Glob = Branded<string, typeof _BrandSymbol.Glob>
export type BulkImportId = Branded<string, typeof _BrandSymbol.BulkImportId>
export type TimeoutId = Branded<string, typeof _BrandSymbol.TimeoutId>
export type NormalizedPath = Branded<string, typeof _BrandSymbol.NormalizedPath>
export type AbsolutePath = Branded<string, typeof _BrandSymbol.AbsolutePath>
export type RelativePath = Branded<string, typeof _BrandSymbol.RelativePath>
