// M12: the light format checks of the email and phone kinds, as the server applies them (it
// answers 422 otherwise), so a cell can say what's wrong before saving.

/** One `@` with text on both sides and no spaces. */
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(s)
}

/** Digits, spaces and `+ - ( ) .` only, with at least 3 digits. */
export function isValidPhone(s: string): boolean {
  return /^[\d\s+\-().]+$/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 3
}

/** A phone number as a `tel:` target: the `+` and the digits only. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/** An email address as a `mailto:` target. */
export function mailtoHref(email: string): string {
  // `?` and `#` would start a query or fragment; `%` would read as an escape.
  return `mailto:${email.replace(/[%?#]/g, (c) => encodeURIComponent(c))}`
}

/** The inline errors (our strings). */
export const CONTACT_ERRORS = {
  email: 'Enter an email address like name@example.com.',
  phone: 'Enter a phone number: digits, spaces and + - ( ) . only, with at least 3 digits.',
}
