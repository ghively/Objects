import crypto from 'node:crypto'
import type { Encrypter } from '../models/encrypter.model.js'

export class NodeEncrypter implements Encrypter {
  private algorithm: string
  private key: Buffer

  constructor(key: string) {
    this.algorithm = 'aes-192-cbc'
    this.key = crypto.scryptSync(key, 'salt', 24)
  }

  encrypt(value: string) {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv)
    const encrypted = cipher.update(value, 'utf8', 'hex')

    return [encrypted + cipher.final('hex'), Buffer.from(iv).toString('hex')].join('|')
  }

  decrypt(value: string): string {
    const [encrypted, iv] = value.split('|', 2)
    if (typeof encrypted === 'undefined' || typeof iv === 'undefined') throw new Error('Invalid encrypted value')

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, Buffer.from(iv, 'hex'))
    const decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')

    return decrypted
  }
}
