import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Storage } from '../models/storage.model.js'

export class ElectronStorage implements Storage {
  folder: string

  constructor() {
    this.folder = path.join(app.getPath('userData'), 'settings')
    if (!fs.existsSync(this.folder)) fs.mkdirSync(this.folder, { recursive: true })
  }

  write(name: string, value: string): void {
    const file = path.join(this.folder, `${name}.data`)

    try {
      fs.writeFileSync(file, value, { flag: 'w+' })
    } catch {
      this.clear(name)
    }
  }

  read(name: string): string | undefined {
    const file = path.join(this.folder, `${name}.data`)
    if (!fs.existsSync(file)) return undefined

    try {
      return fs.readFileSync(file, 'utf-8')
    } catch {
      this.clear(name)
      return undefined
    }
  }

  clear(name: string): void {
    const file = path.join(this.folder, `${name}.data`)
    if (!fs.existsSync(file)) return

    try {
      fs.unlinkSync(file)
    } catch {}
  }
}
