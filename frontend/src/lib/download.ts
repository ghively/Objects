/**
 * Start a browser download of a same-origin URL (M9 export): an `<a href download>` clicked
 * once, never `fetch`, so the file streams straight from our own server to the Downloads folder.
 */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
  }
}
