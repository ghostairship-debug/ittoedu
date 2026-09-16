import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type UrlGeneration = {
  urls: Record<string, string>
  files: Readonly<Record<string, Uint8Array>>
  mimeTypes: Readonly<Record<string, string>>
  owner: boolean
  readers: number
}
const generations = new WeakMap<Record<string, string>, UrlGeneration>()
const EMPTY_URLS: Record<string, string> = {}
function releaseGeneration(generation: UrlGeneration) {
  if (generation.owner || generation.readers) return
  generations.delete(generation.urls)
  if (typeof URL.revokeObjectURL === 'function') {
    for (const url of Object.values(generation.urls)) URL.revokeObjectURL(url)
  }
}
/** A detached/asynchronously mounted consumer keeps its current sources until destroyed. */
export function retainAssetObjectUrls(urls: Record<string, string>): () => void {
  const generation = generations.get(urls)
  if (!generation) return () => {}
  generation.readers++
  let retained = true
  return () => {
    if (!retained) return
    retained = false
    generation.readers--
    releaseGeneration(generation)
  }
}
function sameSources(generation: UrlGeneration, files: Readonly<Record<string, Uint8Array>>, mimeTypes: Readonly<Record<string, string>>) {
  const ids = Object.keys(files)
  return ids.length === Object.keys(generation.files).length && ids.every(id =>
    generation.files[id] === files[id] && (generation.mimeTypes[id] ?? 'application/octet-stream') === (mimeTypes[id] ?? 'application/octet-stream'))
}
/** One URL owner; equivalent metadata does not replace live media sources. */
export function useAssetObjectUrls(
  files: Readonly<Record<string, Uint8Array>>,
  mimeTypes: Readonly<Record<string, string>>,
): Record<string, string> {
  const owned = useRef(new Set<UrlGeneration>())
  const latest = useRef<UrlGeneration | null>(null)
  const [generation, setGeneration] = useState<UrlGeneration | null>(null)
  useLayoutEffect(() => {
    if (latest.current?.owner && sameSources(latest.current, files, mimeTypes)) return
    const urls: Record<string, string> = {}
    if (typeof URL.createObjectURL === 'function') {
      for (const [assetId, bytes] of Object.entries(files)) {
        urls[assetId] = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeTypes[assetId] ?? 'application/octet-stream' }))
      }
    }
    const next = { urls, files, mimeTypes, owner: true, readers: 0 }
    generations.set(urls, next); owned.current.add(next); latest.current = next
    setGeneration(next)
  }, [files, mimeTypes])
  // The new map has committed to normal React consumers. NodeViews hold their own
  // leases until their asynchronous React roots are actually unmounted.
  useEffect(() => {
    if (!generation || !owned.current.has(generation)) return
    for (const old of owned.current) {
      if (old === generation) continue
      owned.current.delete(old); old.owner = false; releaseGeneration(old)
    }
  }, [generation])
  useEffect(() => () => {
    for (const old of owned.current) { old.owner = false; releaseGeneration(old) }
    owned.current.clear()
  }, [])
  return generation?.urls ?? EMPTY_URLS
}
