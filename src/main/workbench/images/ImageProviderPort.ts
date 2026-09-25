import type { HostImageInput } from '../../../core/tools/imageResource'
import type { ImageGenerationRequest, ImageJobTimingMark, ImageRequestProvenance } from '../../../shared/workbench/images'
import type { ModelFailure } from '../../../shared/workbench/modelProvider'

export interface ImageProviderReference extends HostImageInput { referenceId: string }
export type ImageProviderResult = { status: 'completed'; images: HostImageInput[]; provenance: ImageRequestProvenance }
  | { status: 'failed'; failure: ModelFailure; provenance: ImageRequestProvenance }
export type ImageProviderTimingStage = Extract<ImageJobTimingMark['stage'], 'image.provider.prepared' | 'image.fetch.invoked' | 'image.response.headers'>
export interface ImageProviderRunOptions { signal?: AbortSignal; onTiming?(stage: ImageProviderTimingStage, detail?: ImageJobTimingMark['detail']): void }
export interface ImageProviderPort {
  generate(request: ImageGenerationRequest, references: readonly ImageProviderReference[], options?: ImageProviderRunOptions): Promise<ImageProviderResult>
}
