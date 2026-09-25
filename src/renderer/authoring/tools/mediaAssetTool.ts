import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { createImageAssetImport, createMediaAssetImport, readImageDimensions, readMediaMetadata } from '../../project/assetManager'
import { applyCourseAssetImports } from '../../project/v9AssetAdapter'
import { commitCourseProjectMutation } from '../../../core/tools/courseProjectMutation'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.object({ kind: z.enum(['image', 'audio', 'video']), filename: z.string().min(1).max(500), mimeType: z.string().min(1).max(120),
  base64: z.string().min(1).max(90_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict()
export const mediaAssetTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'asset.media.import', inputSchema: schema,
  description: '导入素材依赖，使用 global owner + create parent:owner append。base64 为真实媒体字节。新 asset ID 从该步骤回执的 asset-id 引用获得，不能自行指定。',
  async plan({ document, destination, value }) {
    const { target } = resolveAuthoringToolScope(document, destination)
    if (target.owner !== 'global' || destination.kind !== 'create' || destination.scope.parent.kind !== 'owner' || destination.scope.insertion.kind !== 'append') throw new Error('素材导入需要 global owner 追加位置')
    const bytes = Uint8Array.from(atob(value.base64), character => character.charCodeAt(0))
    if (bytes.length > 64 * 1024 * 1024) throw new Error('单次工具素材导入不能超过 64 MiB')
    const input = { name: value.filename, mimeType: value.mimeType, bytes }
    const asset = value.kind === 'image' ? createImageAssetImport(input, { dimensions: await readImageDimensions(bytes, value.mimeType) })
      : createMediaAssetImport(input, value.kind, await readMediaMetadata(bytes, value.mimeType, value.kind))
    const nextDocument = commitCourseProjectMutation(document, draft => { applyCourseAssetImports(draft.assets, {}, [asset]) })
    return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: { assetFileChanges: [{ assetId: asset.meta.id, after: bytes }] } },
      affected: [{ id: asset.meta.id, operation: 'created', ownerKey: 'global', authoringAddress: makeAuthoringAddress({ projectId: document.id, scope: 'global', carrier: 'native', layerItemId: asset.meta.id, field: 'assets' }) }] }
  },
}
