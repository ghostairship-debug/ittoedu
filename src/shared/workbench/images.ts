import type { ModelCapability, ModelConnectionSnapshot, ModelFailure, ModelJsonObject } from './modelProvider'

export interface ImageModelSelection {
  connection: ModelConnectionSnapshot
  /** Image endpoint model, frozen with its connection for this run. */
  imageModel: string
  capabilities?: { generate: ModelCapability; edit: ModelCapability; multipleReferences: ModelCapability; transparent: ModelCapability }
}

/** Images API uses the exact root explicitly saved with the API connection. */
export function openAIImagesEndpoint(connection: Pick<ModelConnectionSnapshot, 'protocol' | 'auth' | 'baseURL' | 'imageProtocol'>,
  operation: 'generate' | 'edit'): string {
  if (connection.protocol !== 'openai-chat' || connection.auth.kind !== 'api-key' || connection.imageProtocol !== 'openai-images')
    throw new Error('unsupported-image-connection')
  const root = new URL(connection.baseURL)
  if (root.protocol !== 'https:' || !root.hostname || root.username || root.password || root.search || root.hash
    || /%|\\/.test(root.pathname)) throw new Error('invalid-image-endpoint')
  return `${root.href.replace(/\/+$/, '')}/images/${operation === 'edit' ? 'edits' : 'generations'}`
}

export function supportsOpenAIImages(connection: Pick<ModelConnectionSnapshot, 'protocol' | 'auth' | 'baseURL' | 'imageProtocol'>): boolean {
  try { openAIImagesEndpoint(connection, 'generate'); return true } catch { return false }
}

export function supportsChatGPTOAuthImages(connection: Pick<ModelConnectionSnapshot, 'provider' | 'protocol' | 'auth' | 'baseURL'>): boolean {
  return connection.provider === 'openai' && connection.protocol === 'chatgpt-responses' && connection.auth.kind === 'oauth'
    && connection.baseURL === 'https://chatgpt.com/backend-api/codex'
}
export interface ImageGenerationRequest {
  jobId: string
  runId: string
  documentId: string
  operation: 'generate' | 'edit'
  prompt: string
  selection: ImageModelSelection
  referenceIds?: string[]
  output?: { size?: string; quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'; format?: 'png' | 'jpeg' | 'webp'; background?: 'auto' | 'opaque' | 'transparent'; moderation?: 'auto' | 'low' }
}
export interface ImageResourceReference {
  resourceId: string
  digest: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  byteLength: number
}
/** Main-process observations only. An absent stage means it was not observed; none imply provider first content. */
export interface ImageJobTimingMark {
  stage: 'image.references.started' | 'image.references.finished' | 'image.provider.started'
    | 'image.provider.prepared' | 'image.fetch.invoked' | 'image.response.headers' | 'image.provider.finished'
    | 'image.resources.started' | 'image.resources.finished'
  process: 'main'
  clock: 'performance.now'
  clockInstanceId: string
  timeOriginMs: number
  monotonicMs: number
  wallTimeMs: number
  detail?: { outcome?: string; referenceCount?: number; requestBytes?: number; httpStatus?: number; imageCount?: number }
}
export interface ImageRequestProvenance {
  executor: 'guoling-direct-chatgpt-images' | 'guoling-openai-images-api' | 'guoling-direct-teamorouter-images'
  endpoint: string
  connectionId: string
  connectionRevision: number
  accountId: string
  authKind: 'oauth' | 'api-key'
  billing: ModelConnectionSnapshot['billing']
  requestedImageModel: string
  /** Absent when the provider does not attest the image model; never inferred from the requested value. */
  actualImageModels?: string[]
  providerResponseId?: string
  providerRequestId?: string
  usage?: ModelJsonObject
  toolUsage?: ModelJsonObject
  resolvedOutput?: { size?: string; quality?: string; background?: string; format?: string }
  outputWarnings?: Array<'size-differs' | 'format-differs'>
  references: { referenceId: string; digest: string; mimeType: string; byteLength: number }[]
  requestBytes?: number
  requestDigest?: string
  querySupport: 'unavailable'
  charge: 'unknown'
}
export interface ImageJobSnapshot {
  version: 1
  jobId: string
  runId: string
  documentId: string
  requestDigest: string
  operation: 'generate' | 'edit'
  status: 'preparing' | 'running' | 'ready' | 'unapplied' | 'stopped' | 'unknown' | 'failed'
  stopped: boolean
  createdAt: string
  updatedAt: string
  provenance: ImageRequestProvenance
  resources: ImageResourceReference[]
  failure?: ModelFailure
  /** Optional for jobs persisted before timing was introduced. Never contains prompts, tokens, or raw responses. */
  timing?: ImageJobTimingMark[]
}
