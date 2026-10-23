import type { ComponentAsset } from '../../../shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { assetBytesSha256 } from '../../project/assetManager'
import { imageDerivativePlan, imageDerivativeTraits, type ImageDerivativeDemand } from '../../../shared/imageDerivative'
export type { ImageDerivativeDemand } from '../../../shared/imageDerivative'

type DeliveryImage = { bytes: Uint8Array; mimeType: string; width: number; height: number }
interface Derivative {
  key: string
  promise: Promise<DeliveryImage | undefined>
  pending: boolean
  refs: number
}
interface ImageOwner {
  assets: Readonly<Record<string, ComponentAsset>>
  assetIds: Set<string>
  revision: number
  used: Map<string, Derivative>
}
interface ImageCache { entries: Map<string, Derivative>; owners: Map<string, ImageOwner> }
const derivatives = new WeakMap<Document, ImageCache>()
const ownerKey = (identity: Pick<DocumentSnapshot, 'documentId' | 'epoch'>) => JSON.stringify([identity.documentId, identity.epoch])
function cacheFor(dom: Document): ImageCache {
  let cache = derivatives.get(dom)
  if (!cache) { cache = { entries: new Map(), owners: new Map() }; derivatives.set(dom, cache) }
  return cache
}
function release(cache: ImageCache, entry: Derivative) {
  entry.refs--
  if (!entry.refs && !entry.pending && cache.entries.get(entry.key) === entry) cache.entries.delete(entry.key)
}
function retain(cache: ImageCache, owner: ImageOwner, used: Map<string, Derivative>) {
  const before = new Set(owner.used.values()), after = new Set(used.values())
  for (const entry of after) if (!before.has(entry)) entry.refs++
  for (const entry of before) if (!after.has(entry)) release(cache, entry)
  owner.used = used
}

/** Consume the existing open-document inventory; hidden tabs remain live owners. */
export function setDeliveryImageDocuments(dom: Document, documents: readonly Pick<DocumentSnapshot, 'documentId' | 'epoch' | 'model'>[]) {
  const cache = cacheFor(dom), live = new Set<string>()
  for (const snapshot of documents) {
    if (snapshot.model.kind !== 'course-v10') continue
    const key = ownerKey(snapshot), assets = snapshot.model.project.assets
    live.add(key)
    let owner = cache.owners.get(key)
    if (!owner) {
      owner = { assets, assetIds: new Set(Object.keys(assets)), revision: -1, used: new Map() }
      cache.owners.set(key, owner)
    } else if (owner.assets !== assets) {
      owner.assets = assets; const assetIds = owner.assetIds = new Set(Object.keys(assets))
      retain(cache, owner, new Map([...owner.used].filter(([id]) => assetIds.has(id))))
    }
  }
  for (const [key, owner] of cache.owners) if (!live.has(key)) {
    cache.owners.delete(key)
    retain(cache, owner, new Map())
  }
}

/** A build pins its own work; only a still-open document retains completed work. */
export function beginDeliveryImageEncoding(dom: Document, identity?: Pick<DocumentSnapshot, 'documentId' | 'epoch' | 'revision'>) {
  const cache = cacheFor(dom), key = identity ? ownerKey(identity) : undefined
  const owner = key ? cache.owners.get(key) : undefined
  const pinned = new Set<Derivative>(), used = new Map<string, Derivative>()
  let finished = false
  return {
    encode: (asset: Readonly<ComponentAsset>, bytes: Uint8Array, signal?: AbortSignal, demand?: ImageDerivativeDemand) => encodeForBuild(asset, bytes, dom, cache, entry => {
      if (finished) return
      used.set(asset.id, entry)
      if (!pinned.has(entry)) { pinned.add(entry); entry.refs++ }
    }, signal, demand),
    finish(success = false) {
      if (finished) return
      finished = true
      if (success && identity && owner && key && cache.owners.get(key) === owner && identity.revision >= owner.revision) {
        const next = identity.revision === owner.revision ? new Map(owner.used) : new Map<string, Derivative>()
        for (const [id, entry] of used) if (owner.assetIds.has(id) && cache.entries.get(entry.key) === entry) next.set(id, entry)
        retain(cache, owner, next)
        owner.revision = identity.revision
      }
      for (const entry of pinned) release(cache, entry)
      pinned.clear(); used.clear()
    },
  }
}

async function encode(bytes: Uint8Array, mimeType: string, dom: Document, demand?: ImageDerivativeDemand): Promise<DeliveryImage | undefined> {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
  const image = new dom.defaultView!.Image()
  try {
    image.src = url
    await image.decode()
    const plan = imageDerivativePlan({ width: image.naturalWidth, height: image.naturalHeight }, mimeType, imageDerivativeTraits(bytes, mimeType), demand)
    if (!plan.encode) return
    const canvas = dom.createElement('canvas')
    canvas.width = plan.width
    canvas.height = plan.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, plan.width, plan.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, plan.outputMimeType, plan.quality))
    if (!blob || blob.type !== plan.outputMimeType || blob.size >= bytes.length) return
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type, width: plan.width, height: plan.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Keep editor originals; only runtime display demand may reduce their resolution. */
async function encodeForBuild(asset: Readonly<ComponentAsset>, bytes: Uint8Array, dom: Document, cache: ImageCache, use: (entry: Derivative) => void, signal?: AbortSignal, demand?: ImageDerivativeDemand): Promise<(DeliveryImage & { filename?: string }) | undefined> {
  signal?.throwIfAborted()
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType ?? '') || demand?.quality === 'original') return
  const traits = imageDerivativeTraits(bytes, asset.mimeType!)
  if (traits.animated || asset.mimeType === 'image/webp' && traits.lossy && !demand) return
  const key = JSON.stringify([asset.mimeType, demand?.width, demand?.height, demand?.dpr ?? 2, demand?.fit ?? 'contain',
    demand?.crop?.width ?? 1, demand?.crop?.height ?? 1, demand?.quality, await assetBytesSha256(bytes)])
  signal?.throwIfAborted()
  let entry = cache.entries.get(key)
  if (!entry) {
    // Cancellation belongs to each export, not to another export sharing this
    // same encoding. Failed decodes can be retried after their cause is fixed.
    entry = { key, pending: true, refs: 0, promise: Promise.resolve(undefined) }
    const created = entry
    created.promise = encode(bytes, asset.mimeType!, dom, demand).then(result => {
      created.pending = false
      if (!created.refs && cache.entries.get(key) === created) cache.entries.delete(key)
      return result
    }, error => {
      created.pending = false
      if (cache.entries.get(key) === created) cache.entries.delete(key)
      throw error
    })
    cache.entries.set(key, created)
  }
  use(entry)
  const result = await entry.promise
  signal?.throwIfAborted()
  if (!result) return
  const extension = result.mimeType === 'image/png' ? 'png' : 'webp'
  return { ...result, ...(asset.filename ? { filename: `${asset.filename.replace(/\.[^.]+$/, '')}.${extension}` } : {}) }
}

/** Standalone calls have no document owner and release their work when settled. */
export async function encodeDeliveryImage(asset: Readonly<ComponentAsset>, bytes: Uint8Array, dom: Document, signal?: AbortSignal, demand?: ImageDerivativeDemand) {
  const job = beginDeliveryImageEncoding(dom)
  try { return await job.encode(asset, bytes, signal, demand) }
  finally { job.finish() }
}
