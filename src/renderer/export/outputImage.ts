import { cropGeometry, type CropImage, type CropRect } from '../../shared/imageCrop'
import { transformPoint, type AffineMatrix } from '../../core/components/geometry'
import { flowImageDimensions } from './imageDimensions'
import { bytesToDataUrl } from './base64'

/** Output validates only the image it consumes; a broken asset never rejects its siblings. */
export async function outputImageDimensions(bytes: Uint8Array, mimeType: string) {
  const source = flowImageDimensions(bytes, mimeType)
  if (!source) throw new Error('图片字节不能解码为有效图像。')
  if (typeof Image !== 'undefined' && typeof Image.prototype.decode === 'function') {
    const image = new Image()
    image.src = bytesToDataUrl(bytes, mimeType)
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片没有可用像素。')
  }
  return source
}

/** Native pictures consume the same visible source rectangle as the author renderer. */
export function outputImageGeometry(image: CropImage): { shown: CropRect; sourceRect: CropRect } {
  const { shown, whole } = cropGeometry(image)
  return { shown, sourceRect: { x: (shown.x - whole.x) / whole.width, y: (shown.y - whole.y) / whole.height,
    width: shown.width / whole.width, height: shown.height / whole.height } }
}

export function isShearedOutputMatrix(matrix: AffineMatrix): boolean {
  return Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) > Math.hypot(matrix[0], matrix[1]) * Math.hypot(matrix[2], matrix[3]) * 1e-7
}

export function affineOutputBounds(frame: { width: number; height: number }, matrix: AffineMatrix): CropRect {
  const points = [[0, 0], [frame.width, 0], [0, frame.height], [frame.width, frame.height]]
    .map(([x, y]) => transformPoint(matrix, { x: x!, y: y! }))
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y))
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y }
}

/** Office cannot express shear. Project the actual local bitmap once into its authored AABB. */
export async function affineOutputPicture(dataUrl: string, frame: { width: number; height: number }, matrix: AffineMatrix) {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const bounds = affineOutputBounds(frame, matrix)
  if (!bounds.width || !bounds.height) throw new Error('输出变换没有可见面积。')
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(bounds.width)); canvas.height = Math.max(1, Math.ceil(bounds.height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建仿射图面输出画布。')
  context.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4] - bounds.x, matrix[5] - bounds.y)
  context.drawImage(image, 0, 0, frame.width, frame.height)
  const output = canvas.toDataURL('image/png')
  canvas.width = canvas.height = 1
  return { dataUrl: output, bounds }
}
