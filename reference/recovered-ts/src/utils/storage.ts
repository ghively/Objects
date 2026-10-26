import type { Storage } from '../models/storage.model.js'

function browserLocalStorage(): globalThis.Storage | undefined {
  try {
    const storage = globalThis.localStorage
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function'
    ) {
      return storage
    }
  } catch {
    // Accessing localStorage can throw (privacy mode, sandboxed iframes).
  }
  return undefined
}

export class LocalStorage implements Storage {
  write: (name: string, value: string) => void = (name, value) => {
    browserLocalStorage()?.setItem(name, value)
  }

  read: (name: string) => string | undefined = (name) => {
    const value = browserLocalStorage()?.getItem(name)
    if (value == null) return undefined
    return value
  }

  clear: (name: string) => void = (name) => {
    browserLocalStorage()?.removeItem(name)
  }
}

export class PseudoStorage implements Storage {
  write: (name: string, value: string) => void = (_name, _value) => {
    return
  }

  read: (name: string) => string | undefined = (_name) => {
    return undefined
  }

  clear: (name: string) => void = (_name) => {
    return
  }
}
