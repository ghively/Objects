import { tryOnScopeDispose, watchThrottled } from '@vueuse/core'
import awayback from 'awayback'
import { cloneDeep, defaultsDeep, isEmpty } from 'lodash-es'
import { v4 as uuid } from 'uuid'
import { onUnmounted, ref, toValue, type Ref } from 'vue'
import { z } from 'zod'
import type { Encrypter } from '../models/encrypter.model.js'
import type { Storage } from '../models/storage.model.js'
import type { Paths } from '../shared-logic/models/general.model.js'
import { defaults } from '../shared-logic/util/general.js'
import { apply, diff, type Delta } from '../shared-ui/utils/diff.js'
import { primitives, PrimitiveSerializer, type Serializer, type ValuesOf } from '../utils/serializer.js'
import { LocalStorage } from '../utils/storage.js'
import { PseudoEncrypter } from '~/utils/encrypter.js'

export type UseStoreOptions = {
  storage: Storage
  encrypter: Encrypter
  serializer: Serializer<ValuesOf<typeof primitives>>

  watcher: {
    deep: boolean
    throttle: number
    leading: boolean
    trailing: boolean
  }
}

export type UseStoreObserveOptions = {
  deep: boolean
}

export type Values = Extract<ValuesOf<typeof primitives>, Record<string, unknown>>

const events = awayback<{
  adopt: (target: string, origin: string) => void
}>()

export function useStore<T extends Values>(
  key: string,
  schema: z.ZodType<T, any>,
  options?: Partial<UseStoreOptions>,
  isSilent: boolean = false
) {
  const id = uuid()
  const fallback = schema.parse({})
  if (!schema.safeParse(fallback).success) throw new Error('Initial value does not match schema')

  const _options = defaults<UseStoreOptions>(options, {
    storage: new LocalStorage(),
    encrypter: new PseudoEncrypter(),
    serializer: new PrimitiveSerializer(primitives),

    watcher: {
      deep: true,
      throttle: 0,
      leading: true,
      trailing: true,
    },
  })

  const { storage, encrypter, serializer } = _options

  const cached: Delta[] = []

  const observers: Map<
    string,
    {
      id: string
      path: string
      callback: (delta: Delta) => void
      options: UseStoreObserveOptions
    }
  > = new Map()

  let isPaused = false

  function read(): T {
    flow: {
      const content = storage.read(key)
      if (!content) break flow

      try {
        return schema.parse(defaultsDeep(serializer.deserialize(encrypter.decrypt(content)), fallback) as T)
      } catch {
        break flow
      }
    }

    return cloneDeep(fallback)
  }

  function write(value: T, deltas: Delta[]): boolean {
    try {
      storage.write(key, encrypter.encrypt(serializer.serialize(value)))

      deltas.forEach((delta) => {
        const destination = delta.path.join('.')

        observers.forEach(({ path, callback, options }) => {
          if ((!destination.startsWith(path) || !options.deep) && destination !== path) return
          callback(delta)
        })
      })

      events.emit('adopt', key, id)
      return true
    } catch {
      return false
    }
  }

  const store = ref(read()) as Ref<T>

  const stop = watchThrottled(
    store,
    () => {
      try {
        const previous = read()
        const current = schema.parse(toValue(store))
        const deltas = diff(previous, current)

        if (isEmpty(deltas)) return

        if (isPaused) {
          cached.push(...deltas)
          return
        }

        write(current, deltas)
      } catch {}
    },
    _options.watcher
  )

  function adopt(target: string, origin: string) {
    if (target !== key || origin === id) return

    const previous = read()
    const current = toValue(store)

    const deltas = [cached, diff(previous, current)].flat()
    if (isEmpty(deltas)) return

    isPaused = true

    try {
      store.value = apply(current, deltas)
    } catch {
      store.value = read()
    } finally {
      isPaused = false
      cached.length = 0
    }

    write(toValue(store), deltas)
  }

  function observe(
    path: Paths<T>,
    callback: (delta: Delta) => void,
    options?: Partial<UseStoreObserveOptions>
  ): string {
    const _options = defaults<UseStoreObserveOptions>(options, {
      deep: false,
    })

    const id = uuid()
    observers.set(id, { id, path, callback, options: _options })

    return id
  }

  function unobserve(id: string) {
    observers.delete(id)
  }

  function destroy() {
    observers.clear()
    events.remove('adopt', adopt)
    stop()
  }

  tryOnScopeDispose(destroy)
  if (!isSilent) onUnmounted(destroy)

  events.on('adopt', adopt)

  return { store, clear: storage.clear, destroy, observe, unobserve, events }
}
