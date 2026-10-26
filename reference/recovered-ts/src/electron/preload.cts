/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer, webFrame } = require('electron') as typeof import('electron')

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector: string, text: string | undefined) => {
    const element = document.getElementById(selector)
    if (element && text) element.innerText = text
  }

  for (const dependency of ['chrome', 'node', 'electron']) {
    replaceText(`${dependency}-version`, process.versions[dependency])
  }
})

contextBridge.exposeInMainWorld('electronAPI', {
  // GENERAL COMMUNICATION
  toMainIpc: (data: any) => ipcRenderer.invoke('renderer-to-main-request', data),
  onMainToRenderRequest: (callback: any) => {
    ipcRenderer.on('main-to-render-request', callback)
    return () => ipcRenderer.removeListener('main-to-render-request', callback)
  },
  toMainMainFromRenderResponse: (data: any) => ipcRenderer.invoke('main-to-render-response', data),
  // CACHE
  clearCache: () => {
    webFrame.clearCache()
  },
  // BLOB HANDLING
  openBlob: async ({ blob, name }: { blob: Blob; name: string }) => {
    const buffer = Buffer.from(await blob.arrayBuffer())
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-512', buffer)))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const response = (await ipcRenderer.invoke('open-media-request', {
      name,
      size: blob.size,
      type: blob.type,
      checksum,
    })) as { id: string; parts: number } | undefined

    if (!response) return

    const { id, parts } = response
    const PART_SIZE = Math.floor(blob.size / parts)

    for (let i = 0; i < parts; i++) {
      const start = i * PART_SIZE
      const end = i === parts - 1 ? blob.size : (i + 1) * PART_SIZE
      const part: Uint8Array = buffer.subarray(start, end)

      const isSuccess = (await ipcRenderer.invoke('open-media-part', { id, buffer: part })) as boolean
      if (!isSuccess) return
    }

    ipcRenderer.invoke('open-media-done', { id })
  },
  storeExport: async ({
    schedule,
    blob,
    name,
  }: {
    schedule: { id: string; title: string; keep: number }
    blob: Blob
    name: string
  }) => {
    try {
      if (!blob.size) return { ok: false, code: 'export_build_failed' }

      const response = (await ipcRenderer.invoke('store-export-request', {
        schedule,
        name,
        size: blob.size,
        type: blob.type || 'application/zip',
      })) as { ok: true; id: string; parts: number } | { ok: false; code: string }

      if (!response || !response.ok) {
        return response?.ok === false ? response : { ok: false, code: 'write_failed' }
      }

      const { id, parts } = response
      const PART_SIZE = Math.ceil(blob.size / Math.max(parts, 1))

      let offset = 0

      while (offset < blob.size) {
        const slice = blob.slice(offset, offset + PART_SIZE)
        const buffer = Buffer.from(await slice.arrayBuffer())

        const partResult = (await ipcRenderer.invoke('store-export-part', { id, buffer })) as
          { ok: true } | { ok: false; code: string }
        if (!partResult?.ok) {
          return partResult?.ok === false ? partResult : { ok: false, code: 'write_failed' }
        }

        offset += PART_SIZE
      }

      const done = (await ipcRenderer.invoke('store-export-done', { id })) as { ok: true } | { ok: false; code: string }
      if (!done?.ok) return done?.ok === false ? done : { ok: false, code: 'write_failed' }
      return { ok: true }
    } catch {
      return { ok: false, code: 'write_failed' }
    }
  },
})
