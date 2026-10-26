import type { Encrypter } from '~/models/encrypter.model.js'

export class PseudoEncrypter implements Encrypter {
  encrypt(value: string): string {
    return value
  }

  decrypt(value: string): string {
    return value
  }
}
