import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type AssetUrl = {
  url: string | null
  bytes: Uint8Array
  mimeType: string
  generations: number
}
type UrlGeneration = {
  urls: Record<string, string>
  assets: Readonly<Record<string, AssetUrl>>
  owner: boolean
  readers: number
  released: boolean
}
const generations = new WeakMap<Record<string, string>, UrlGeneration>()
const EMPTY_URLS: Record<string, string> = {}
function releaseGeneration(generation: UrlGeneration) {
  if (generation.owner || generation.readers || generation.released) return
  generation.released = true
  generations.delete(generation.urls)
  for (const asset of Object.values(generation.assets)) {
    asset.generations--
    if (!asset.generations && asset.url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(asset.url)
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
  return ids.length === Object.keys(generation.assets).length && ids.every(id =>
    generation.assets[id]?.bytes === files[id] && generation.assets[id]?.mimeType === (mimeTypes[id] ?? 'application/octet-stream'))
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
    const urls: Record<string, string> = {}, assets: Record<string, AssetUrl> = {}
    for (const [assetId, bytes] of Object.entries(files)) {
      const mimeType = mimeTypes[assetId] ?? 'application/octet-stream'
      const previous = latest.current?.assets[assetId]
      let asset: AssetUrl
      if (previous?.generations && previous.bytes === bytes && previous.mimeType === mimeType) asset = previous
      else {
        // Blob snapshots its input. A view avoids an extra canonical-byte copy;
        // SharedArrayBuffer input still needs the same independent copy as before.
        const buffer = bytes.buffer
        const blobBytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength) : Uint8Array.from(bytes)
        asset = { bytes, mimeType, generations: 0, url: typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(new Blob([blobBytes], { type: mimeType })) : null }
      }
      asset.generations++
      assets[assetId] = asset
      if (asset.url) urls[assetId] = asset.url
    }
    const next = { urls, assets, owner: true, readers: 0, released: false }
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
