import { mediaFilesRequestSchema, type MediaFilesRequest, type MediaFileSnapshot } from '../../shared/workbench/mediaFiles'
import { documentHost } from './documentHost'
import { MediaFilesService } from './mediaFiles/MediaFilesService'
import { assertAuthorizedWorkspacePath, operateWorkspaceFiles } from './workspaceFilesDesktopService'

export async function operateMediaFiles(request: MediaFilesRequest): Promise<MediaFileSnapshot> {
  const input = mediaFilesRequestSchema.parse(request)
  const host = documentHost()
  const service = new MediaFilesService(host.artifacts)
  if (input.type === 'media-file.open') {
    const entry = await operateWorkspaceFiles({ type: 'resolve', workspaceId: input.workspaceId, entryId: input.entryId })
    if (entry.kind !== 'file') throw new Error('只能打开普通媒体文件')
    return service.open(await host.artifacts.bind(entry.resolvedPath))
  }
  if (input.type === 'media-file.open-path') return service.open(await host.artifacts.bind(await assertAuthorizedWorkspacePath(input.path)))
  await assertAuthorizedWorkspacePath(input.binding.path)
  if (input.type === 'media-file.reload') return service.open(await host.artifacts.bind(input.binding.path))
  if (input.type === 'media-file.preview') return service.preview(input.binding, input.operations)
  return service.save(input.binding, input.operations)
}
