import type { ComponentEdit, ComponentInstance } from '../../shared/contracts/component-platform'
import { cropForBox, type CropRect } from '../../renderer/editing/crop/imageCrop'
import { editImageDisplay, restoreImageOriginal, type ImageData, type ImageDisplayPatch } from './data'

export function imageDataEdit(instanceId: string, data: ImageData): ComponentEdit {
  return { type: 'data.set', instanceId, path: [], value: data }
}

export function editImage(instance: ComponentInstance<ImageData>, patch: ImageDisplayPatch): ComponentEdit {
  return imageDataEdit(instance.id, editImageDisplay(instance.data, patch))
}

export function restoreImage(instance: ComponentInstance<ImageData>): ComponentEdit {
  return imageDataEdit(instance.id, restoreImageOriginal(instance.data))
}

/** The kept box is in image-local coordinates; parent rotation/shear remain owned by frame. */
export function cropImage(
  instance: ComponentInstance<ImageData>,
  box: CropRect,
  source: { width: number; height: number },
): ComponentEdit[] {
  const frame = instance.frame
  if (!frame) throw new Error('当前图片没有自由 frame，请由 Flow 编辑器提交显示裁切参数')
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) {
    throw new Error('图片裁切框需要有限坐标及正尺寸')
  }
  const crop = cropForBox({ ...instance.data, frame, source }, box)
  const [a, b, c, d, e, f] = frame.transform
  return [imageDataEdit(instance.id, editImageDisplay(instance.data, { crop, fit: 'stretch', cropX: 0.5, cropY: 0.5 })),
    { type: 'frame.set', instanceId: instance.id, frame: { width: box.width, height: box.height,
      transform: [a, b, c, d, e + a * box.x + c * box.y, f + b * box.x + d * box.y] } }]
}

/** Unsupported HTML target kinds must be diagnosed instead of editing a neighboring img. */
export function imageTargetDiagnostic(kind: 'image' | 'background' | 'srcset'): string | undefined {
  return kind === 'image' ? undefined : kind === 'background'
    ? '背景图片不属于当前图片实例编辑范围，请由内容应用层绑定背景对象。'
    : '响应式 srcset 的候选集尚未接入此图片编辑器，原引用保留。'
}
