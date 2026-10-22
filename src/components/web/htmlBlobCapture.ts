export interface HtmlBlobCaptureEntry {
  blob: Blob
  source: Promise<string>
  ready: Promise<string>
  revoked: boolean
  decorated?: string
  decorations: Set<string>
}

export interface HtmlBlobCapture {
  entries: Map<string, HtmlBlobCaptureEntry>
  nativeCreate: typeof URL.createObjectURL
  nativeRevoke: typeof URL.revokeObjectURL
  project(entry: HtmlBlobCaptureEntry, html: string): string
  release(entry: HtmlBlobCaptureEntry, url: string): void
  dispose(): void
}

/** Capture only new HTML Blobs owned by this realm; never fetch a URL. */
export function installHtmlBlobCapture(win: Window & typeof globalThis, decorate?: (html: string) => string): HtmlBlobCapture | undefined {
  const originalCreate = win.URL.createObjectURL, originalRevoke = win.URL.revokeObjectURL
  if (!originalCreate || !originalRevoke) return undefined
  const nativeCreate = originalCreate.bind(win.URL), nativeRevoke = originalRevoke.bind(win.URL)
  const entries = new Map<string, HtmlBlobCaptureEntry>()
  let disposed = false
  const release = (entry: HtmlBlobCaptureEntry, url: string) => {
    if (!entry.decorations.delete(url)) return
    nativeRevoke(url)
    if (entry.decorated === url) entry.decorated = undefined
  }
  const project = (entry: HtmlBlobCaptureEntry, html: string) => {
    const url = nativeCreate(new win.Blob([html], { type: 'text/html' }))
    entry.decorations.add(url)
    return url
  }
  const create: typeof URL.createObjectURL = blob => {
    const url = nativeCreate(blob)
    if (!disposed && blob instanceof win.Blob && /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(blob.type)) {
      const source = Promise.resolve().then(() => blob.text())
      // A consumer may need only the original URL. Keep rejection observable to
      // source readers without leaving an unused source promise unhandled.
      void source.catch(() => undefined)
      const entry: HtmlBlobCaptureEntry = { blob, source, ready: Promise.resolve(url), revoked: false, decorations: new Set() }
      if (decorate) entry.ready = source.then(html => {
        if (entry.revoked || disposed) return url
        const decorated = project(entry, decorate(html)); entry.decorated = decorated
        return decorated
      }).catch(() => url)
      entries.set(url, entry)
    }
    return url
  }
  const revoke: typeof URL.revokeObjectURL = url => {
    const entry = entries.get(url)
    if (entry) {
      entry.revoked = true
      for (const decoration of entry.decorations) release(entry, decoration)
      entries.delete(url)
    }
    nativeRevoke(url)
  }
  win.URL.createObjectURL = create
  win.URL.revokeObjectURL = revoke
  return { entries, nativeCreate, nativeRevoke, project, release,
    dispose() {
      if (disposed) return
      disposed = true
      for (const entry of entries.values()) {
        entry.revoked = true
        for (const decoration of entry.decorations) release(entry, decoration)
      }
      entries.clear()
      if (win.URL.createObjectURL === create) win.URL.createObjectURL = originalCreate
      if (win.URL.revokeObjectURL === revoke) win.URL.revokeObjectURL = originalRevoke
    },
  }
}
