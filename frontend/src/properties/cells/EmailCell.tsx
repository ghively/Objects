import { CONTACT_ERRORS, isValidEmail, mailtoHref } from '../contact'
import { ContactCell, type ContactKind } from './ContactCell'
import type { CellProps } from './types'

const EMAIL: ContactKind = {
  noun: 'email',
  field: 'Email address',
  placeholder: 'name@example.com',
  inputType: 'email',
  valid: isValidEmail,
  href: mailtoHref,
  error: CONTACT_ERRORS.email,
}

/** M12 `email`: an email address, opened with the OS mail app (a `mailto:` link). */
export function EmailCell(props: CellProps<string | null>) {
  return <ContactCell kind={EMAIL} {...props} />
}
