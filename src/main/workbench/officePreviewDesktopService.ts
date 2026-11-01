import path from 'node:path'
import { pptxPreviewRequestSchema, type PptxPreviewRequest, type PptxPreviewSnapshot } from '../../shared/workbench/officePreview'
import { documentHost } from './documentHost'
import { assertAuthorizedWorkspacePath } from './workspaceFilesDesktopService'

/** Preview has no writer: bind/read retains file authorization, relocation and disk CAS. */
export async function readPptxPreview(request: PptxPreviewRequest): Promise<PptxPreviewSnapshot> {
  const input = pptxPreviewRequestSchema.parse(request), artifacts = documentHost().artifacts
  const filename = input.type === 'pptx-preview.open' ? input.path : artifacts.resolveBinding(input.binding).path
  const authorized = await assertAuthorizedWorkspacePath(filename)
  if (path.extname(authorized).toLowerCase() !== '.pptx') throw new Error('此预览入口仅支持 PPTX 文件')
  const binding = await artifacts.bind(authorized)
  return { binding, bytes: await artifacts.read(binding) }
}
