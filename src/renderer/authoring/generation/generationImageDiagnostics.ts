import type { GenerationRequest } from '../../../shared/generationContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { inspectImageTransformSource, type ImageTransformSourceInspection } from '../../project/imageTransform'

type Resources = NonNullable<GenerationRequest['resourceFiles']>
type RecordValue = Record<string, unknown>
type Attachment = { status: 'attached'; kind: 'original' | 'derived'; path: string }
  | { status: 'unavailable' | 'unknown'; code: string; message?: string }
export interface GenerationImageDiagnostic {
  target: string
  assetId: string
  selected: boolean
  mediaType: string | null
  attachment: Attachment
  /** Readiness of source decoding only; never an operation or commit result. */
  transformSource: ImageTransformSourceInspection | { status: 'unknown'; code: 'image-source-not-inspected' }
    | { status: 'failed'; code: 'image-asset-missing' | 'image-bytes-missing' | 'image-byte-length-mismatch'; message: string }
}
const record = (value: unknown): RecordValue | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as RecordValue : undefined
const records = (value: unknown): RecordValue[] => Array.isArray(value)
  ? value.map(record).filter((value): value is RecordValue => value !== undefined) : []

function attachmentEvidence(observation: GenerationRequest['observation'], resources: Resources): RecordValue | undefined {
  const entry = observation?.files.find(file => file.fileId === 'current-structure' && file.role === 'structure')
  const file = entry && resources.find(file => file.path === entry.relativePath && file.role === 'structure'
    && file.mediaType === entry.mediaType && file.encoding === 'utf8')
  if (!file || !entry || new TextEncoder().encode(file.content).byteLength !== entry.byteLength) return
  try {
    const value = record(JSON.parse(file.content))
    if (value?.canonicalDocumentRevision === observation?.documentRevision && value?.source === observation?.source
      && value?.locationId === observation?.locationId && value?.surfaceId === observation?.surfaceId
      && value?.stateId === observation?.stateId) return value
  } catch { /* Absent or malformed evidence remains unknown. */ }
}

function imageAttachment(assetId: string, evidence: RecordValue | undefined,
  observation: GenerationRequest['observation'], resources: Resources): Attachment {
  if (!evidence) return { status: 'unknown', code: 'image-attachment-not-observed' }
  for (const [field, kind] of [['originalImages', 'original'], ['derivedImages', 'derived']] as const) {
    for (const reference of records(evidence[field])) {
      if (reference.assetId !== assetId || kind === 'original' && reference.attachmentRole !== 'image') continue
      const file = observation?.files.find(file => file.fileId === reference.fileId && file.relativePath === reference.relativePath
        && file.mediaType === reference.mediaType && file.role === 'image')
      const resource = file && resources.find(resource => resource.path === file.relativePath && resource.role === 'image'
        && resource.mediaType === file.mediaType && resource.encoding === 'base64')
      if (!file || !resource) continue
      const byteLength = resource.content.length * 3 / 4 - (resource.content.endsWith('==') ? 2 : resource.content.endsWith('=') ? 1 : 0)
      if (byteLength === file.byteLength && byteLength > 0) return { status: 'attached', kind, path: `resources/${file.relativePath}` }
    }
  }
  const failure = [...records(evidence.unavailableOriginalImages), ...records(evidence.unavailableDerivedImages)]
    .find(value => value.assetId === assetId && typeof value.code === 'string')
  if (failure) return { status: 'unavailable', code: failure.code as string,
    ...(typeof failure.message === 'string' ? { message: failure.message } : {}) }
  // A structure record alone (including an SVG original) is not an image attachment.
  return { status: 'unknown', code: 'image-attachment-not-verified' }
}

/** Projects actual attachment receipts without guessing from MIME, filenames or screenshots. */
export function generationImageDiagnostics(input: {
  pages: readonly unknown[]; assets: CourseProjectDocument['assets']
  observation?: GenerationRequest['observation']; resourceFiles?: Resources
}): GenerationImageDiagnostic[] {
  const resources = input.resourceFiles ?? [], evidence = attachmentEvidence(input.observation, resources)
  return input.pages.flatMap(page => {
    const value = record(page)
    return [...records(value?.items), ...records(value?.blocks)].flatMap(row => {
      const node = record(row.item ?? row.block), content = record(node?.content)
      const assetId = node?.kind === 'native' && content?.nativeType === 'image' ? record(content.data)?.assetId
        : node?.type === 'media' && node?.mediaKind === 'image' ? node.assetId : undefined
      if (typeof assetId !== 'string' || typeof row.target !== 'string') return []
      return [{ target: row.target, assetId, selected: row.selected === true,
        mediaType: input.assets[assetId]?.mimeType ?? null,
        attachment: imageAttachment(assetId, evidence, input.observation, resources),
        transformSource: { status: 'unknown' as const, code: 'image-source-not-inspected' as const } }]
    })
  })
}

/** Same immutable bytes and MIME retain valid source evidence across observation refreshes. */
export function createGenerationImageSourceInspector(inspect = inspectImageTransformSource) {
  const cached = new WeakMap<Uint8Array, Map<string, Promise<ImageTransformSourceInspection>>>()
  return async (request: GenerationRequest, assets: CourseProjectDocument['assets'],
    assetFiles: Readonly<Record<string, Uint8Array>>): Promise<GenerationRequest> => {
    const context = record(request.context), diagnostics = context?.imageDiagnostics as GenerationImageDiagnostic[] | undefined
    if (!diagnostics?.length) return request
    const focused = diagnostics.some(value => value.selected), next: GenerationImageDiagnostic[] = []
    for (const diagnostic of diagnostics) {
      if (focused && !diagnostic.selected) { next.push(diagnostic); continue }
      const asset = assets[diagnostic.assetId], bytes = assetFiles[diagnostic.assetId]
      let transformSource: GenerationImageDiagnostic['transformSource']
      if (!asset || asset.kind !== 'image') transformSource = { status: 'failed', code: 'image-asset-missing', message: '当前工程缺少原图元数据，尚未进行变换源解码。' }
      else if (!bytes) transformSource = { status: 'failed', code: 'image-bytes-missing', message: '当前工程缺少原图字节，尚未进行变换源解码。' }
      else if (bytes.byteLength !== asset.byteLength) transformSource = { status: 'failed', code: 'image-byte-length-mismatch', message: '原图字节长度与元数据不符，尚未进行变换源解码。' }
      else {
        let byMime = cached.get(bytes)
        if (!byMime) { byMime = new Map(); cached.set(bytes, byMime) }
        let result = byMime.get(asset.mimeType)
        if (!result) {
          result = inspect(bytes, asset.mimeType)
          byMime.set(asset.mimeType, result)
          result.catch(() => { if (byMime.get(asset.mimeType) === result) byMime.delete(asset.mimeType) })
        }
        transformSource = await result
      }
      next.push({ ...diagnostic, transformSource })
    }
    return { ...request, context: JSON.parse(JSON.stringify({ ...context, imageDiagnostics: next })) }
  }
}
