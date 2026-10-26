import { cloneDeep, defaultsDeep } from 'lodash-es'
import { v4 as uuid } from 'uuid'
import { ComponentPolicy } from '../models/access.model.js'
import { NumberFormatConfig } from '../models/blocks.model.js'
import { Component, ComponentFull, CTypes, LoadingStates } from '../models/component.model.js'
import {
  languageObjects,
  MutationWrapperAsync,
  type DeepPartial,
  type LanguageKey,
  type MaybePromise,
  type Nullable,
  type Something,
  type TimeoutId,
  type Tuple,
} from '../models/general.model.js'

export const localSessionIds = ['local_user_id', 'local_userPersonal_id']
export const SYSTEM_USER_ID = '171d5a59-de75-4b75-926b-04978b4af9ba'

export const STANDARD_SYNC_INTERVAL = 5000
export const STANDARD_CONSECUTIVE_SYNC_INTERVAL = 1000
export const STANDARD_NUMBER_OF_ELEMENTS_TO_SYNC = 15
export const ID_LIST_BATCH_SIZE_PORTAL = 100

export const DEFAULT_NUMBER_OF_DECIMALS = 2
export const DEFAULT_NUMBER_PROGRESS_STEPS = 10
export const DEFAULT_INTL_LOCALE = 'en-US'

export const INPUT_PROCESSING_TEXT_SIZE_LIMIT = 200000

export const S3_PROBE_URL = 'https://s3.eu-central-1.amazonaws.com/'

/** decodeURIComponent that returns the input unchanged when the value is not valid URI encoding. */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function createRandomString(
  length: number,
  additionalCharacters: string | undefined = undefined,
  allowedCharacters: string | undefined = undefined
) {
  let result = ''
  const characters = allowedCharacters
    ? allowedCharacters
    : '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' +
      (additionalCharacters ? additionalCharacters : '')

  const charactersLength = characters.length
  for (let i = 0; i < length; i++) {
    const randomPosition = Math.floor(Math.random() * charactersLength)
    result += characters.substring(randomPosition, randomPosition + 1)
  }
  return result
}

export function addHypensToUuid(i: string) {
  return (
    i.substring(0, 8) +
    '-' +
    i.substring(8, 12) +
    '-' +
    i.substring(12, 16) +
    '-' +
    i.substring(16, 20) +
    '-' +
    i.substring(20)
  )
}

export function removeHypensFromUuid(i: string) {
  return i.replace(/-/g, '')
}

export function t(key: string) {
  return key
}

export function isValidEmail(email: string) {
  return !!email.match(
    /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  )
}

export function isValidHttpUrl(value: string | undefined, isStrict = false, isHttpOnly = false): URL | undefined {
  let _value = value

  if (!_value) return undefined
  if (!isStrict) _value = _value.trim()
  if (!isStrict && !/^http(s?)\:\/\//.test(_value)) _value = `${isHttpOnly ? 'http' : 'https'}://${_value}`

  // if contains whitespace or linebreak, return
  if (/(\s)|(\n)/g.test(_value)) return undefined

  let url: URL | undefined = undefined

  try {
    url = new URL(_value)
  } catch {
    return undefined
  }

  if ((url.protocol === 'http:' && !isHttpOnly) || url.protocol === 'https:') return url
  else return undefined
}

export function transformToValidUserName(username: string) {
  return username.replace(/[!"#$%&'()*+,./:;<=>?@§\[\\\]\^\_\`\{\|\}\~]/g, '')
}

export function getDefaultSpacePolicies(spacePolicies: ComponentPolicy[]): ComponentPolicy[] {
  return spacePolicies.filter((el) => el.name === 'write')
}

export async function loadAndGetC(
  componentInfo: { id: string; type: CTypes | undefined },
  getC: (id: string) => MaybePromise<Component | undefined>,
  mutationWrapperAsync: MutationWrapperAsync<any>,
  onlyAcceptFull: true
): Promise<ComponentFull | undefined>
export async function loadAndGetC(
  componentInfo: { id: string; type: CTypes | undefined },
  getC: (id: string) => MaybePromise<Component | undefined>,
  mutationWrapperAsync: MutationWrapperAsync<any>,
  onlyAcceptFull: false
): Promise<Component | undefined>
export async function loadAndGetC(
  componentInfo: { id: string; type: CTypes | undefined },
  getC: (id: string) => MaybePromise<Component | undefined>,
  mutationWrapperAsync: MutationWrapperAsync<any>,
  onlyAcceptFull: boolean
): Promise<Component | undefined> {
  let component = await getC(componentInfo.id)
  if (!component || (onlyAcceptFull && component.loadingState !== LoadingStates.Full)) {
    await mutationWrapperAsync([componentInfo], () => {})
    component = await getC(componentInfo.id)
  }
  if (!component || (onlyAcceptFull && component.loadingState !== LoadingStates.Full)) component = undefined
  return component
}

export async function loadAndGetCShell(
  componentInfo: { id: string; type: CTypes | undefined },
  onlyAcceptFull: true
): Promise<ComponentFull | undefined>
export async function loadAndGetCShell(
  componentInfo: { id: string; type: CTypes | undefined },
  onlyAcceptFull: false
): Promise<Component | undefined>
export async function loadAndGetCShell(
  componentInfo: { id: string; type: CTypes | undefined },
  onlyAcceptFull: boolean
): Promise<Component | undefined> {
  return undefined
}

export type LoadAndGetCFunction = typeof loadAndGetCShell

export const getCToLoadAndGetCConverter = (
  getC: (id: string) => MaybePromise<Component | undefined>
): LoadAndGetCFunction => {
  return async ({ id }, onlyAcceptFull) => {
    const c = await getC(id)
    if (!c || (onlyAcceptFull && c.loadingState !== LoadingStates.Full)) return undefined
    return c as ComponentFull
  }
}

export function heavyComputation(baseNumber = 12) {
  console.info('heavyComputation start')
  console.time('heavyComputation')
  let result = 0
  for (let i = Math.pow(baseNumber, 7); i >= 0; i--) {
    result += Math.atan(i) * Math.tan(i)
  }
  console.timeEnd('heavyComputation')
}

export function loadingLabelDepth(type: CTypes | undefined) {
  let depth = 1
  if (type === 'UserPersonal') {
    depth = 4
  } else if (type === 'RootSpace') {
    depth = 3
  } else if (type === 'RootDatabase') {
    depth = 1
  }
  return depth
}

export function isPrintableKeyEvent(event: KeyboardEvent) {
  const codeUnit = event.key.charCodeAt(0)
  return (
    !(event.altKey || event.metaKey || event.ctrlKey) &&
    (event.key.length == 1 || (event.key.length == 2 && codeUnit >= 0xd800 && codeUnit <= 0xdfff))
  )
}

export function generateDefaultNumberFormatConfig(): NumberFormatConfig {
  const config: NumberFormatConfig = {
    type: 'number',
    options: {
      decimals: undefined,
      separators: undefined,
    },
  }

  return config
}

export function sleep<_T extends undefined>(ms: number, result?: undefined): Promise<undefined>
export function sleep<T>(ms: number, result: T): Promise<T>
export function sleep<T>(ms: number, result: T): Promise<T> {
  return new Promise<T>((resolve) => setTimeout(() => resolve(result), ms))
}

/**
 * Run `fn` over `items` with at most `concurrency` in-flight calls.
 * Results stay in input order. Empty input returns [].
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

type TillOptions = {
  tries: number
  signal: AbortSignal | null
}

export async function till(
  predicate: () => Promise<boolean> | boolean,
  interval: number = 500,
  options?: Partial<TillOptions>
): Promise<boolean> {
  const _options = defaults(options, { tries: Infinity, signal: null })

  return new Promise(async (resolve, reject) => {
    let count = 0
    let timeout: ReturnType<typeof setInterval> | null = null

    function cleanup() {
      if (!timeout) return
      clearInterval(timeout)
    }

    async function check(): Promise<boolean> {
      try {
        if (_options.signal?.aborted ?? false) {
          cleanup()
          resolve(false)
          return true
        }

        if (await Promise.resolve(predicate())) {
          cleanup()
          resolve(true)
          return false
        }

        count++

        if (count >= _options.tries) {
          cleanup()
          resolve(false)
          return false
        }
      } catch (error) {
        cleanup()
        reject(error)
        return false
      }

      return true
    }

    if (!(await check())) return
    timeout = setInterval(check, interval)
  })
}

export async function expect<T = Promise<unknown> | unknown>(
  candidate: T,
  predicate: (result: T) => Promise<boolean> | boolean
): Promise<typeof candidate> {
  return new Promise(async (resolve, reject) => {
    try {
      const result = await candidate

      if (await Promise.resolve(predicate(result))) {
        resolve(result)
      } else {
        reject(result)
      }
    } catch (e) {
      reject(e)
    }
  })
}

export function split<T extends Array<unknown>>(
  array: T,
  predicate: (value: T[number], index: number, array: T) => boolean
): [Array<T[number]>, Array<T[number]>] {
  return [
    array.filter(predicate as Parameters<typeof Array.prototype.filter>[0]) as Array<T[number]>,
    array.filter(
      (item, index) => !(predicate as Parameters<typeof Array.prototype.filter>[0])(item, index, array)
    ) as Array<T[number]>,
  ] as const
}

export function pipe<T, R>(value: T, handler: (value: T) => R): R {
  return handler(value)
}

export function min<T extends Array<unknown>>(
  array: T,
  predicate: (value: T[number], index: number, array: T) => boolean,
  min: number
): boolean {
  let count = 0
  let index = 0

  if (min === 0) return true
  if (min < 0) return false
  if (array.length < min) return false

  for (const item of array) {
    if (predicate(item, index++, array)) {
      if (++count >= min) return true
    }
  }

  return false
}

export function max<T extends Array<unknown>>(
  array: T,
  predicate: (value: T[number], index: number, array: T) => boolean,
  max: number
): boolean {
  let count = 0
  let index = 0

  if (max === 0) return true
  if (max < 0) return false
  if (array.length < max) return true

  for (const item of array) {
    if (predicate(item, index++, array)) {
      if (++count > max) return false
    }
  }

  return true
}

export function map<A extends string, B extends Record<A, unknown>>(key: A, map: B): B[A] {
  return map[key]
}

export function probability(p: number): boolean {
  return Math.random() < p
}

export function transform<T, O>(value: T, transformer: (value: T) => O): O {
  return transformer(value)
}

type RepeatOptions<T extends number> = {
  pause: number | Tuple<number, T>
  delay: number
}

export function repeat<T extends number>(handler: () => void, times: T, options?: Partial<RepeatOptions<T>>) {
  const _options = defaults(options, {
    pause: 0,
    delay: 0,
  })

  let waited = 0

  for (let i = 0; i < times; i++) {
    const pause = Array.isArray(_options.pause) ? ((<number[]>_options.pause)[i] ?? 0) : _options.pause
    setTimeout(handler, waited + _options.delay)
    waited += pause
  }
}

export function count<T>(array: T[], predicate: (value: T, index: number, array: T[]) => boolean): number {
  return array.reduce((acc, value, index) => (predicate(value, index, array) ? acc + 1 : acc), 0)
}

export function defaults<T extends Something>(value: DeepPartial<T> | Partial<T> | T | undefined, defaults: T): T {
  return defaultsDeep(cloneDeep(value) ?? {}, cloneDeep(defaults))
}

export function truncate(text: string, max: number, suffix: string = ' [...]'): string {
  if (text.length <= max) return text
  return text.slice(0, max) + suffix
}

export function match<T extends Record<string, unknown>, K extends keyof T>(map: T, value: K): T[K] {
  return map[value]
}

const timeouts = new Map<TimeoutId, ReturnType<typeof setTimeout>>()
const MAXIMUM_TIMEOUT_DELAY = 2 ** 31 - 1

export const timeout = {
  has: (id: TimeoutId): boolean => {
    return timeouts.has(id)
  },

  clear: (id: TimeoutId): void => {
    const ref = timeouts.get(id)
    if (!ref) return
    clearTimeout(ref)
    timeouts.delete(id)
  },

  set: (callback: () => void, ms: number = 0, id?: string): TimeoutId => {
    const _id = <TimeoutId>(id ?? uuid())

    const delay = Math.min(ms, MAXIMUM_TIMEOUT_DELAY)
    const remaining = ms - delay

    timeouts.set(
      _id,
      setTimeout(() => {
        timeout.clear(_id)

        if (remaining <= 0) {
          try {
            callback()
          } catch {}
        } else {
          timeout.set(callback, remaining, _id)
        }
      }, delay)
    )

    return _id
  },

  wait: <T>(ms: number, result: T): Promise<T> => {
    return new Promise<T>((resolve) => {
      timeout.set(() => resolve(result), ms)
    })
  },
}

export class Measurement {
  #id: string
  #count = 1
  #last = performance.now()

  constructor(id?: Nullable<string>) {
    this.#id = id ?? uuid().slice(0, 4)
  }

  measure(label?: Nullable<number | string>) {
    const now = performance.now()
    console.info(
      `[${this.#id}] ${typeof label === 'undefined' ? `measure ${this.#count}` : label}: ${now - this.#last}`
    )
    this.#count += 1
    this.#last = now
  }

  get id(): string {
    return this.#id
  }
}

export function isNonNullableArray<T extends NonNullable<unknown>>(array: Nullable<T>[]): array is T[] {
  return array.every((value): value is T => value !== null && typeof value !== 'undefined')
}

export function sample<T extends readonly unknown[]>(array: T): T[number] | null {
  return array.at(Math.floor(Math.random() * array.length))
}

export function enumerate<T extends readonly unknown[]>(array: T): [T[number], number][] {
  return array.map((value, index) => <const>[value, index])
}

export function assign<T, R extends Record<string, (value: T) => boolean>>(value: T, record: R): keyof R | undefined {
  return <keyof R | undefined>Object.entries(record).find(([_, predicate]) => predicate(value))?.[0]
}

export async function silent<T = void>(fn: () => MaybePromise<T>): Promise<MaybePromise<T>> {
  const previous = {
    warn: console.warn,
    error: console.error,
    info: console.info,
    log: console.log,
    debug: console.debug,
  }

  console.warn = () => {}
  console.error = () => {}
  console.info = () => {}
  console.log = () => {}
  console.debug = () => {}

  let result: MaybePromise<T>

  try {
    result = await fn()
  } finally {
    console.warn = previous.warn
    console.error = previous.error
    console.info = previous.info
    console.log = previous.log
    console.debug = previous.debug
  }

  return result
}

export function toTitleCase(text: string, language: LanguageKey): string {
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' })
  const segments = [...segmenter.segment(text)]
  const indexOfFirstWord = segments.findIndex(({ isWordLike }) => isWordLike)

  return segments
    .map(({ segment, isWordLike }, index) => {
      if (!isWordLike) return segment

      const lower = segment.toLocaleLowerCase(language)

      if (index !== indexOfFirstWord && languageObjects[language].connectorWords.has(lower)) {
        return lower
      }

      const chars = [...segment]
      return chars[0].toLocaleUpperCase(language) + chars.slice(1).join('').toLocaleLowerCase(language)
    })
    .join('')
}

export function mergeAbortSignals(...signals: (AbortSignal | null | undefined)[]): AbortSignal {
  const controller = new AbortController()

  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort()
      break
    }

    signal.addEventListener('abort', () => controller.abort())
  }

  return controller.signal
}

export function isSpecialSidepanelEntryId(entryId: string) {
  return (
    entryId === 'graphView' ||
    entryId === 'objectsInside' ||
    entryId === 'notes' ||
    entryId === 'backlinks' ||
    entryId === 'relatedContent' ||
    entryId === 'notes' ||
    entryId === 'explore' ||
    entryId.startsWith('aiAssistantChat_') ||
    entryId.startsWith('localSpaceQuery_')
  )
}

export function isNotNullable<T>(value: T | null | undefined): value is NonNullable<typeof value> {
  return value !== null && typeof value !== 'undefined'
}

export async function probeUrl(
  url: string,
  options: { mode: 'cors' | 'no-cors'; credentials?: RequestCredentials; timeout?: number }
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 4000)

  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: options.mode,
      cache: 'no-store',
      credentials: options.credentials ?? 'omit',
      signal: controller.signal,
    })

    return options.mode === 'no-cors' ? true : res.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
