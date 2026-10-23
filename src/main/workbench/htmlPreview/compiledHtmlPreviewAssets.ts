import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { restoreSerializedResourcePool, type SerializedResourcePool } from '../../../shared/serializedResourcePool'

export interface CompiledHtmlPreviewAsset {
  readonly contentType: string
  /** Decoded only when the lease's protocol actually serves this asset. */
  readonly bytes: Uint8Array
}

export interface CompiledHtmlPreviewProjection {
  source: string
  assets: ReadonlyMap<string, CompiledHtmlPreviewAsset>
}

/** Project the existing compiled export's passive asset addresses into its
 * preview lease. The source document and its embedded runtime stay authoritative. */
export function projectCompiledHtmlPreviewAssets(source: string,
  assetUrl: (canonicalAssetId: string) => string): CompiledHtmlPreviewProjection {
  const unchanged = (): CompiledHtmlPreviewProjection => ({ source, assets: new Map() })
  if (!/compiled-course-v[12]/.test(source) || !source.includes('course-data')) return unchanged()
  const tokens = scanHtmlSource(source).tokens
  const entries = tokens.flatMap((token, index) => token.kind === 'start-tag' && token.name === 'script'
    && token.attributes?.some(attribute => attribute.name === 'id' && attribute.decodedValue === 'course-data') ? [index] : [])
  if (entries.length !== 1) return unchanged()
  const start = tokens[entries[0]!]!, body = tokens[entries[0]! + 1]
  if (!start.attributes?.some(attribute => attribute.name === 'type' && attribute.decodedValue?.trim().toLowerCase() === 'application/json')
    || body?.kind !== 'raw-text' || body.rawKind !== 'script') return unchanged()
  let data: { format?: unknown; course?: { assets?: unknown } }
  const poolEntries = tokens.flatMap((token, index) => token.kind === 'start-tag' && token.name === 'script'
    && token.attributes?.some(attribute => attribute.name === 'id' && attribute.decodedValue === 'course-resource-pool') ? [index] : [])
  if (poolEntries.length > 1) return unchanged()
  let poolSpan: { start: number; end: number } | undefined
  try {
    let pool: SerializedResourcePool | undefined
    if (poolEntries.length) {
      const poolStart = tokens[poolEntries[0]!]!, poolBody = tokens[poolEntries[0]! + 1], poolEnd = tokens[poolEntries[0]! + 2]
      if (poolBody?.kind !== 'raw-text' || poolBody.rawKind !== 'script' || poolEnd?.kind !== 'end-tag' || poolEnd.name !== 'script') return unchanged()
      pool = JSON.parse(source.slice(poolBody.span.start, poolBody.span.end))
      poolSpan = { start: poolStart.span.start, end: poolEnd.span.end }
    }
    data = restoreSerializedResourcePool(JSON.parse(source.slice(body.span.start, body.span.end)), pool) as typeof data
  }
  catch { return unchanged() }
  if (!data || !['compiled-course-v1', 'compiled-course-v2'].includes(String(data.format)) || !data.course || !data.course.assets
    || typeof data.course.assets !== 'object' || Array.isArray(data.course.assets)) return unchanged()
  const recordEntries = tokens.flatMap((token, index) => token.kind === 'start-tag' && token.name === 'script'
    && token.attributes?.some(attribute => attribute.name === 'id' && attribute.decodedValue === 'cw-html-authoring-records') ? [index] : [])
  const retainedImageUrls = new Set<string>()
  if (recordEntries.length > 1) return unchanged()
  if (recordEntries.length) {
    const region = tokens[recordEntries[0]! + 1]
    if (region?.kind !== 'raw-text' || region.rawKind !== 'script') return unchanged()
    try {
      const value = JSON.parse(source.slice(region.span.start, region.span.end))
      if (value?.version !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) return unchanged()
      for (const record of Object.values(value.records) as Array<{ kind?: unknown; binding?: { baseline?: unknown } } | null>) {
        if (record?.kind === 'image' && typeof record.binding?.baseline === 'string') retainedImageUrls.add(record.binding.baseline)
      }
    } catch { return unchanged() }
  }
  const entriesById = data.course.assets as Record<string, unknown>
  const urls = new Map<string, string>(), assets = new Map<string, CompiledHtmlPreviewAsset>()
  for (const id of Object.keys(entriesById).sort()) {
    const asset = entriesById[id]
    if (!asset || typeof asset !== 'object' || Array.isArray(asset) || !('url' in asset) || typeof asset.url !== 'string') continue
    const original = asset.url
    // Existing saved image records may use their original data URI as the DOM
    // baseline. Keep that carrier so their authored overrides still rebind.
    if (retainedImageUrls.has(original)) continue
    // Compiled exports encode their binary assets this way. Other user-authored
    // URL forms keep their original carrier instead of being rejected or guessed.
    const comma = original.indexOf(',')
    if (!original.startsWith('data:') || comma < 0 || !/;base64$/i.test(original.slice(0, comma))) continue
    const contentType = original.slice(5, comma).replace(/;base64$/i, '')
    const mediaType = contentType.split(';', 1)[0]!.toLowerCase()
    if (!/^(?:image|audio|video|font)\//.test(mediaType) && !['application/font-woff', 'application/vnd.ms-fontobject'].includes(mediaType)) continue
    const payload = original.slice(comma + 1)
    if (!/^[a-zA-Z0-9+/=\s]*$/.test(payload)) continue
    let projected = urls.get(original)
    if (!projected) {
      projected = assetUrl(id)
      urls.set(original, projected)
      let bytes: Uint8Array | undefined
      assets.set(id, { contentType, get bytes() { return bytes ??= new Uint8Array(Buffer.from(payload, 'base64')) } })
    }
    asset.url = projected
  }
  if (!assets.size) return unchanged()
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  // This projection now contains ordinary decoded course JSON. Remove the
  // transport pool so bootstrap cannot replay its original string offsets.
  const edits = [{ start: body.span.start, end: body.span.end, text: json }, ...(poolSpan ? [{ ...poolSpan, text: '' }] : [])]
  let projected = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) projected = projected.slice(0, edit.start) + edit.text + projected.slice(edit.end)
  return { source: projected, assets }
}
