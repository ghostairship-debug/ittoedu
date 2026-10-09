import { mediaFileOperationSchema, type FileArtifactBinding, type MediaFileContent, type MediaFileOperation, type MediaFileSnapshot } from '../../../shared/workbench/mediaFiles'
import { editImageFile, inspectImageFile } from './imageFileEditing'
import { editPdfFile, inspectPdfFile } from './pdfFileEditing'

/** The existing file owner supplies authorization, binding/version checks, stopped-run checks and atomic publication. */
export interface MediaFileOwner {
  read(binding: FileArtifactBinding, signal?: AbortSignal): Promise<Uint8Array>
  replace(binding: FileArtifactBinding, bytes: Uint8Array, signal?: AbortSignal): Promise<FileArtifactBinding>
}
function isPdf(bytes: Uint8Array): boolean { return Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-')) }
async function inspect(bytes: Uint8Array): Promise<MediaFileContent> { return isPdf(bytes) ? inspectPdfFile(bytes) : inspectImageFile(bytes) }
export async function prepareMediaFileContent(bytes: Uint8Array, operations: readonly MediaFileOperation[], signal?: AbortSignal): Promise<MediaFileContent> {
  const parsed = operations.map(operation => mediaFileOperationSchema.parse(operation))
  signal?.throwIfAborted()
  const content = parsed.length ? isPdf(bytes) ? await editPdfFile(bytes, parsed, signal) : await editImageFile(bytes, parsed, signal) : await inspect(bytes)
  signal?.throwIfAborted()
  return content
}

/** Format mechanics have no filesystem writer and do not own another document history. */
export class MediaFilesService {
  constructor(private readonly owner: MediaFileOwner) {}
  async open(binding: FileArtifactBinding, signal?: AbortSignal): Promise<MediaFileSnapshot> {
    signal?.throwIfAborted()
    const content = await inspect(await this.owner.read(binding, signal))
    signal?.throwIfAborted()
    return { binding, content }
  }
  async preview(binding: FileArtifactBinding, operations: readonly MediaFileOperation[], signal?: AbortSignal): Promise<MediaFileSnapshot> {
    signal?.throwIfAborted()
    const bytes = await this.owner.read(binding, signal)
    const content = await prepareMediaFileContent(bytes, operations, signal)
    signal?.throwIfAborted()
    return { binding, content }
  }
  async save(binding: FileArtifactBinding, operations: readonly MediaFileOperation[], signal?: AbortSignal): Promise<MediaFileSnapshot> {
    const prepared = await this.preview(binding, operations, signal)
    if (!operations.length) return prepared
    signal?.throwIfAborted()
    const saved = await this.owner.replace(prepared.binding, prepared.content.bytes, signal)
    // Reopen the actual published file. Preview bytes alone never count as a save.
    return this.open(saved, signal)
  }
}
