import { useLayoutEffect, useState } from 'react'

/** The committed effect owns both allocation and release, including StrictMode replay. */
export function useAssetObjectUrls(
  files: Readonly<Record<string, Uint8Array>>,
  mimeTypes: Readonly<Record<string, string>>,
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useLayoutEffect(() => {
    const next: Record<string, string> = {}
    if (typeof URL.createObjectURL === 'function') {
      for (const [assetId, bytes] of Object.entries(files)) {
        next[assetId] = URL.createObjectURL(
          new Blob([Uint8Array.from(bytes)], { type: mimeTypes[assetId] ?? 'application/octet-stream' }),
        )
      }
    }
    setUrls(next)
    return () => {
      if (typeof URL.revokeObjectURL !== 'function') return
      for (const url of Object.values(next)) URL.revokeObjectURL(url)
    }
  }, [files, mimeTypes])
  return urls
}
