import { useEffect, useId, useState } from 'react'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

export interface ImagePickerProps {
  /** The current image's space-relative path. */
  value: string | null | undefined
  onChange(next: string | null): void
}

/** The space's images to pick from, "Upload" (imports a file into the space) and "Remove". */
export function ImagePicker({ value, onChange }: ImagePickerProps) {
  const [images, setImages] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  useEffect(() => {
    let alive = true
    api
      .images()
      .then((list) => {
        if (alive) setImages(list.map((i) => i.path))
      })
      .catch(() => {
        if (alive) setImages([])
      })
    return () => {
      alive = false
    }
  }, [])

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const { path } = await api.importImage(file.name, file)
      setImages((list) => (list && !list.includes(path) ? [path, ...list] : list))
      if (path !== value) onChange(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-80 flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <label
          htmlFor={inputId}
          className={cn(
            'cursor-pointer rounded px-2 py-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg',
            busy && 'pointer-events-none opacity-50',
          )}
        >
          Upload
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void upload(file)
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-auto rounded px-2 py-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-[13px] text-[var(--tag-text-red,#f05d5d)]">{error}</p>}
      <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
        {images?.map((path) => (
          <button
            key={path}
            type="button"
            aria-label={path}
            title={path}
            aria-pressed={path === value}
            onClick={() => {
              if (path !== value) onChange(path)
            }}
            className={cn(
              'aspect-video overflow-hidden rounded border-2 border-transparent hover:border-fg-muted',
              path === value && 'border-fg',
            )}
          >
            <img src={api.fileUrl(path)} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
        {images && images.length === 0 && (
          <p className="col-span-3 py-2 text-center text-[13px] text-fg-muted">No images in this space yet</p>
        )}
      </div>
    </div>
  )
}
