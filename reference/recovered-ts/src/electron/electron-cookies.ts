import { session } from 'electron'
import { reportError } from './electron-utils.js'

// !! CHANGE EVERYWHERE
const SESSION_EXPIRATION = 60 * 60 * 24 * 365 // seconds
const COOKIE_EXPIRATION = SESSION_EXPIRATION * 2 // seconds

function getExpirationDate() {
  return new Date(Date.now() + 1000 * COOKIE_EXPIRATION)
}

export async function getCookie(value: Electron.CookiesGetFilter) {
  try {
    const cookies = await session.defaultSession.cookies.get(value)
    if (cookies.length) return cookies[0]
  } catch (e) {
    if (e instanceof Error) reportError(e)
    return undefined
  }
}

export async function setCookie(value: Electron.CookiesSetDetails) {
  session.defaultSession.cookies.set({ expirationDate: getExpirationDate().getTime(), ...value }).then(
    () => {},
    (e) => {
      if (e instanceof Error) reportError(e)
    }
  )
}

export async function deleteCookie({ url, name }: { url: string; name: string }) {
  try {
    await session.defaultSession.cookies.remove(url, name)
  } catch (e) {
    if (e instanceof Error) reportError(e)
  }
}
