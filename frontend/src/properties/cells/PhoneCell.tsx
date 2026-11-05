import { CONTACT_ERRORS, isValidPhone, telHref } from '../contact'
import { ContactCell, type ContactKind } from './ContactCell'
import type { CellProps } from './types'

const PHONE: ContactKind = {
  noun: 'phone',
  field: 'Phone number',
  placeholder: '+1 555 0100',
  inputType: 'tel',
  valid: isValidPhone,
  href: telHref,
  error: CONTACT_ERRORS.phone,
}

/** M12 `phone`: a phone number, opened with the OS phone handler (a `tel:` link). */
export function PhoneCell(props: CellProps<string | null>) {
  return <ContactCell kind={PHONE} {...props} />
}
