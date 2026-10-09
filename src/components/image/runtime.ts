import type { ComponentFrame, ComponentInstance, ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import type { ImageNode } from '../../shared/contracts/native-v1/types'
import { renderImageNodeCanvas } from '../../shared/imageEffects'
import { clampCrop, cropGeometry } from '../../shared/imageCrop'
import { imageDataSchema, type ImageData } from './data'

export interface ResolvedImageAsset {
  url: string
  /** Required before feathering: do not silently flatten animated or uninspected content. */
  animated?: boolean
}
export type ResolveImageAsset = (assetId: string) => ResolvedImageAsset | undefined
export type ImageDiagnostic = { code: string; assetId: string; message: string }

/** URLs and animation metadata are supplied by the host resource service, never by Main/fs imports. */
export function createImageRuntimeImplementation(
  resolveAsset: ResolveImageAsset,
  report: (diagnostic: ImageDiagnostic) => void = () => {},
): ComponentRuntimeImplementation<ImageData> {
  return {
    mount({ root, instance, scope }) {
      if (!root) throw new Error('图片组件需要 DOM 容器')
      const host = root.ownerDocument.createElement('div')
      const image = root.ownerDocument.createElement('img')
      Object.assign(host.style, { position: 'relative', overflow: 'hidden', width: '100%', height: '100%' })
      Object.assign(image.style, { position: 'absolute', maxWidth: 'none', maxHeight: 'none', transformOrigin: '0 0' })
      image.draggable = false
      host.append(image)
      root.append(host)
      let current = instance, frame = instance.frame, activeAsset: ResolvedImageAsset | undefined
      let disposed = false, canvas: HTMLCanvasElement | undefined
      const live = () => !disposed && scope.isActive() && !scope.signal.aborted
      const diagnostic = (code: string, message: string) => {
        host.dataset.imageDiagnostic = code
        report({ code, assetId: current.data.assetId, message })
      }
      const draw = () => {
        if (!live() || !image.complete || !image.naturalWidth) return
        const data = current.data
        const width = frame?.width ?? (host.clientWidth || image.naturalWidth)
        const height = frame?.height ?? (width * image.naturalHeight / image.naturalWidth)
        host.style.height = `${height}px`
        host.style.borderRadius = `${data.cornerRadius}px`
        const filters = data.filters
        host.style.filter = `brightness(${filters.brightness}) contrast(${filters.contrast}) saturate(${filters.saturation}) grayscale(${filters.grayscale}) blur(${filters.blur}px)`
        const geometry = cropGeometry({ ...data, frame: { width, height },
          source: { width: image.naturalWidth, height: image.naturalHeight } }).whole
        const crop = clampCrop(data.crop)
        Object.assign(image.style, { left: `${geometry.x}px`, top: `${geometry.y}px`, width: `${geometry.width}px`, height: `${geometry.height}px`,
          // Clip the discarded source pixels before the existing flip transform; contain margins remain empty.
          clipPath: `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`,
          transform: `translate(${data.flipX ? '100%' : '0'}, ${data.flipY ? '100%' : '0'}) scale(${data.flipX ? -1 : 1}, ${data.flipY ? -1 : 1})` })
        canvas?.remove(); canvas = undefined; image.hidden = false
        delete host.dataset.imageDiagnostic
        if (data.feather.amount <= 0) return
        if (activeAsset?.animated !== false) {
          diagnostic('image-feather-needs-static-source', '当前图片为动画或尚未确认帧信息；保留原件和羽化参数，显示原图，未静态化。')
          return
        }
        // Temporary projection into the existing pixel algorithm; no Native object is persisted.
        const node: ImageNode = { ...data, id: current.id, name: data.alt, type: 'image', x: 0, y: 0,
          width, height, rotation: 0, opacity: 1, visible: true, locked: false,
          playbackInitialVisibility: 'inherit', preserveAspectRatio: data.preserveAspectRatio, safeAreas: [] }
        try {
          canvas = renderImageNodeCanvas(image, image.naturalWidth, image.naturalHeight, node)
          Object.assign(canvas.style, { width: `${width}px`, height: `${height}px`, display: 'block' })
          canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', data.alt)
          host.append(canvas); image.hidden = true
        } catch (error) {
          diagnostic('image-feather-unavailable', `图片羽化未能运行，保留原件和参数：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const update = (next: ComponentInstance<ImageData>) => {
        if (!live()) return
        if (next.id !== instance.id) throw new Error('图片更新目标与挂载实例不一致')
        current = { ...next, data: imageDataSchema.parse(next.data) }; frame = next.frame
        image.alt = current.data.alt
        activeAsset = resolveAsset(current.data.assetId)
        if (!activeAsset) {
          image.removeAttribute('src'); canvas?.remove(); canvas = undefined
          diagnostic('image-resource-missing', `图片资源 ${current.data.assetId} 缺失，原引用已保留。`)
          return
        }
        if (image.getAttribute('src') !== activeAsset.url) image.src = activeAsset.url
        else draw()
      }
      image.onload = draw
      image.onerror = () => { if (live()) diagnostic('image-resource-decode-failed', '图片无法显示，请修复资源；原引用已保留。') }
      const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(draw)
      observer?.observe(root)
      const dispose = () => { if (disposed) return; disposed = true; observer?.disconnect(); image.onload = null; image.onerror = null; host.remove() }
      scope.cleanup(dispose)
      update(instance)
      return { update, updatePlacement(next: ComponentFrame | undefined) { frame = next; draw() }, dispose }
    },
  }
}
