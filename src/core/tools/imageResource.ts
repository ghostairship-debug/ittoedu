import type { ImageAssetResource } from './imageAssetMetadata'
import type { AssetSource } from '../../shared/contracts/media-v1'

/** Host supplies admitted bytes, never a model path or model-provided asset identity. */
export interface HostImageInput { bytes: Uint8Array; mimeType: string; filename: string; source?: AssetSource }
/** The host adapter must fully decode pixels and verify actual MIME before returning metadata and bytes. */
export type PrepareImageResourcePort = (input: HostImageInput, createId: () => string) => Promise<ImageAssetResource>
