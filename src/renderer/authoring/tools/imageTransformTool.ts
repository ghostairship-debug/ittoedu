import { imageTransformInputSchema, type ImageTransformInput } from '../../../shared/imageTransformContract'
import { resolveEffectiveLayerTarget } from '../../course/effectiveLayerCommands'
import { carrierForFlowBlock, findFlowBlockRecursive, makeFlowBlockAuthoringAddress } from '../../course/flowDocumentModel'
import { commitCourseProjectMutation } from '../../course/courseProjectMutation'
import { createImageAssetImport } from '../../project/assetManager'
import { applyCourseAssetImports } from '../../project/v9AssetAdapter'
import { ImageTransformSourceError, transformImageAsset } from '../../project/imageTransform'
import { flowAuthoringTool } from './flowAuthoringTool'
import { nativeAuthoringTool } from './nativeAuthoringTool'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { AuthoringToolFailure, type AuthoringToolDefinition } from './executeAuthoringTool'

export const imageTransformTool: AuthoringToolDefinition<ImageTransformInput> = {
  name: 'asset.image.transform', usesResources: true, inputSchema: imageTransformInputSchema,
  description: '读取 sourceAssetId 的原始图片字节，经确定性像素变换后只替换 update 目标图片实例（Native image 或 Flow media image）。保留未选共享实例和源资产；保留 alpha，输出无损 PNG。replace-color 必须 sourceColor，默认 targetColor=#22c55e、RGB 欧式容差=32；region 与逐行 0/1 mask 使用当前图片像素坐标。crop/resize 使用整数像素，resize 仅 nearest-neighbor，最多 1600 万像素。仅支持静态 8 位 PNG/JPEG/WebP；不支持语义擦除、重绘、动画或 16 位精度转换。模型只输出意图，禁止生成替代 base64 或纯色遮盖。',
  async plan({ document, destination, value, resources, signal }) {
    if (destination.kind !== 'update') throw new Error('图片变换需要所选图片实例的完整 update target')
    const { surface } = resolveAuthoringToolScope(document, destination)
    const found = surface.type === 'flow' ? findFlowBlockRecursive(surface.blocks, destination.target.itemId)?.block : undefined
    const block = found && destination.target.authoringAddress === makeFlowBlockAuthoringAddress({ projectId: document.id,
      surfaceId: surface.id, blockId: found.id, carrier: carrierForFlowBlock(found) }) ? found : undefined
    const native = block ? undefined : resolveEffectiveLayerTarget(document, destination.target).item
    const content = native?.kind === 'native' && native.content.nativeType === 'image' ? native.content : undefined
    const sourceAssetId = block?.type === 'media' && block.mediaKind === 'image' ? block.assetId : content?.data.assetId
    if (!sourceAssetId) throw new Error('所选目标不是可直接变换的图片实例，请明确图片对象或 Flow 图片块')
    if (sourceAssetId !== value.sourceAssetId) throw new Error('所选图片已不再引用本次原图，请重新观察')
    const source = document.assets[sourceAssetId], bytes = resources?.assetFiles[sourceAssetId]
    if (!source || source.kind !== 'image' || !bytes || bytes.length !== source.byteLength) throw new Error('当前原图资产与实际字节不完整')
    const transformed = await transformImageAsset(bytes, source.mimeType, value, signal).catch((error: unknown) => {
      if (error instanceof ImageTransformSourceError) throw new AuthoringToolFailure([{
        code: error.code, path: ['input', 'sourceAssetId'], message: `原图资产 ${sourceAssetId}：${error.message}`,
      }])
      throw error
    })
    if (!transformed.changed) return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: document, resourceChanges: {} }, affected: [] }
    const asset = createImageAssetImport({ name: `${source.filename.replace(/\.[^.]+$/, '')}-edited.png`, mimeType: 'image/png', bytes: transformed.bytes },
      { dimensions: { width: transformed.width, height: transformed.height } })
    if (document.assets[asset.meta.id]) throw new Error('新图片资产身份冲突')
    const imported = commitCourseProjectMutation(document, draft => { applyCourseAssetImports(draft.assets, {}, [asset]) })
    const update = { ...destination, target: { ...destination.target, documentRevision: imported.revision } }
    const plan = block?.type === 'media' ? await flowAuthoringTool.plan({ document: imported, destination: update,
      value: { operation: 'replace', block: { ...block, assetId: asset.meta.id } } })
      : await nativeAuthoringTool.plan({ document: imported, destination: update,
        value: { operation: 'content', content: { ...content!, data: { ...content!.data, assetId: asset.meta.id } } } })
    return { ...plan, transaction: { ...plan.transaction, baseRevision: document.revision,
      nextDocument: { ...plan.transaction.nextDocument, revision: document.revision + 1 },
      resourceChanges: { assetFileChanges: [{ assetId: asset.meta.id, after: asset.bytes }] } },
      diagnostics: [{ code: 'image-transformed', message: JSON.stringify({ sourceAssetId, resultAssetId: asset.meta.id,
        width: transformed.width, height: transformed.height, alpha: 'preserve', format: 'png', effects: transformed.effects }), path: [] }] }
  },
}
