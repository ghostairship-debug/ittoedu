import { createHash } from 'node:crypto'
import { openAIImagesEndpoint, supportsChatGPTOAuthImages, type ImageGenerationRequest, type ImageRequestProvenance } from '../../../shared/workbench/images'
import type { ImageProviderReference } from './ImageProviderPort'

export type ImageRoute = 'chatgpt-oauth' | 'openai-images-api'

export function imageRoute(request: ImageGenerationRequest): ImageRoute {
  const connection = request.selection.connection
  if (supportsChatGPTOAuthImages(connection)) return 'chatgpt-oauth'
  openAIImagesEndpoint(connection, request.operation)
  return 'openai-images-api'
}

export function imageProvenance(request: ImageGenerationRequest, references: readonly ImageProviderReference[] = []): ImageRequestProvenance {
  const route = imageRoute(request), { connection, imageModel } = request.selection
  const endpoint = route === 'chatgpt-oauth'
    ? `https://chatgpt.com/backend-api/codex/images/${request.operation === 'edit' ? 'edits' : 'generations'}`
    : openAIImagesEndpoint(connection, request.operation)
  return { executor: route === 'chatgpt-oauth' ? 'guoling-direct-chatgpt-images' : 'guoling-openai-images-api',
    endpoint, connectionId: connection.id,
    connectionRevision: connection.revision, accountId: connection.accountId, authKind: connection.auth.kind,
    billing: structuredClone(connection.billing), requestedImageModel: imageModel, querySupport: 'unavailable', charge: 'unknown',
    references: references.map(ref => ({ referenceId: ref.referenceId, digest: createHash('sha256').update(ref.bytes).digest('hex'),
      mimeType: ref.mimeType, byteLength: ref.bytes.byteLength })) }
}
