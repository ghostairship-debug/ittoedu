import { z } from 'zod'
import type { CourseProjectDocument, FlowBlock, LayerItem } from '../../shared/courseProjectTypes'
import { nativeContentInputSchemaByType } from '../../shared/contracts/native-v1/schema'

export const imageReplacementInputSchema = z.object({ assetId: nativeContentInputSchemaByType.image.shape.assetId, fit: nativeContentInputSchemaByType.image.shape.fit.optional() }).strict()
export const flowImageReplacementInputSchema = imageReplacementInputSchema.omit({ fit: true })
export const imageFitSchema = nativeContentInputSchemaByType.image.shape.fit

/** Preserves every unrequested Native field; the canonical Driver validates the resulting data and owner. */
export function nativeMediaReplacementData(document: CourseProjectDocument, item: LayerItem | undefined, input: z.infer<typeof imageReplacementInputSchema>) {
  const value = imageReplacementInputSchema.parse(input)
  if (item?.kind !== 'native' || !['image', 'video'].includes(item.content.nativeType)) throw new Error('媒体替换只接受 Native 图片或视频')
  const nativeType = item.content.nativeType
  if (document.assets[value.assetId]?.kind !== nativeType) throw new Error('素材类型必须与现有 Native 图片或视频一致')
  if (nativeType === 'video' && value.fit !== undefined) throw new Error('Native 视频不支持图片 fit 属性')
  return { assetId: value.assetId, ...(nativeType === 'image' && value.fit !== undefined ? { fit: value.fit, preserveAspectRatio: value.fit !== 'stretch' } : {}) }
}

/** Existing manual image adapter keeps its image-only contract. */
export function nativeImageReplacementData(document: CourseProjectDocument, item: LayerItem | undefined, input: z.infer<typeof imageReplacementInputSchema>) {
  if (item?.kind !== 'native' || item.content.nativeType !== 'image') throw new Error('图片窄编辑只接受 Native 图片')
  return nativeMediaReplacementData(document, item, input)
}

export function replaceFlowMedia(document: CourseProjectDocument, block: FlowBlock, assetId: string): FlowBlock {
  if (block.type !== 'media' || document.assets[assetId]?.kind !== block.mediaKind) throw new Error('素材类型必须与现有 Flow 媒体块一致')
  return { ...block, assetId }
}

/** Existing manual Flow image adapter remains image-only. */
export function replaceFlowImage(document: CourseProjectDocument, block: FlowBlock, assetId: string): FlowBlock {
  if (block.type !== 'media' || block.mediaKind !== 'image') throw new Error('正文图片窄编辑需要图片块')
  return replaceFlowMedia(document, block, assetId)
}

/** Flow and backgrounds retain their formal rendering policy instead of adopting Native crop/stretch. */
export function assertImagePlacementFit(placement: 'native' | 'flow' | 'background', fit?: z.infer<typeof imageFitSchema>): void {
  if (placement !== 'native' && fit && fit !== 'contain') throw new Error('当前正文图片与背景保持完整比例，不支持 cover/stretch；请使用 contain 或省略 fit')
}
