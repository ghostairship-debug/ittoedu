import sharp from 'sharp'
import type { ImageAssetResource } from '../../../../core/tools/imageAssetMetadata'
import { prepareImageResource } from '../../admittedImageResource'
import { extractHtmlResources } from '../../htmlImport/extractHtmlResources'
import type { ExtractedResource, ExtractHtmlResourcesInput, ExtractHtmlResourcesResult } from '../../htmlImport/types'

/** A preview seed, not a screenshot or a claim that the content has rendered. */
export async function createContentPreviewResource(filename: string, createId: () => string): Promise<ImageAssetResource> {
  const bytes = await sharp({
    create: { width: 1, height: 1, channels: 4, background: '#ffffff' },
  }).png().toBuffer()
  return prepareImageResource({ bytes, mimeType: 'image/png', filename }, createId)
}

export interface PreparedContentResource extends ExtractedResource {
  /** Image identity and dimensions come from the existing host decoder. */
  image?: ImageAssetResource['meta']
}

export interface PreparedContentResources extends Omit<ExtractHtmlResourcesResult, 'resources'> {
  resources: PreparedContentResource[]
  /** Original bytes remain available for repair; these are not admitted image assets. */
  unresolvedResources: ExtractedResource[]
}

const imageExtension: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg',
}

/**
 * Resource preparation only: no document write, capture, network fetch or resource database.
 * The existing extractor handles HTML/CSS/inline references. Missing references stay in
 * the source with their local diagnostics, so usable content can still be applied.
 * Files must already have been read through the caller's authorized resource boundary.
 */
export async function prepareContentResources(input: ExtractHtmlResourcesInput, createId: () => string): Promise<PreparedContentResources> {
  return prepareExtractedContentResources(extractHtmlResources(input), createId)
}

/** Also accepts the existing confined readHtmlClosure result without extracting rewritten URLs again. */
export async function prepareExtractedContentResources(extracted: ExtractHtmlResourcesResult, createId: () => string): Promise<PreparedContentResources> {
  const resources: PreparedContentResource[] = []
  const unresolvedResources: ExtractedResource[] = []
  const diagnostics = [...extracted.diagnostics]
  for (const resource of extracted.resources) {
    if (!resource.mediaType.startsWith('image/')) {
      resources.push(resource)
      continue
    }
    try {
      const image = await prepareImageResource({
        bytes: resource.bytes,
        mimeType: resource.mediaType,
        filename: `${resource.key}.${imageExtension[resource.mediaType] ?? 'bin'}`,
      }, createId)
      resources.push({ ...resource, bytes: image.bytes, image: image.meta })
    } catch (error) {
      unresolvedResources.push(resource)
      // Keep each originating reference: one shared image can occur at several positions.
      for (const origin of resource.origins) diagnostics.push({
        level: 'warning', code: 'image-resource-unavailable', reference: origin.reference,
        message: `图片资源无法使用，已保留原始字节和待修复引用：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  return { ...extracted, resources, unresolvedResources, diagnostics }
}

// Program content and HTML content use the same existing host admission service.
export { prepareImageResource }
