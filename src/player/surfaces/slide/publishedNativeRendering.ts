import type {
  NativeElementContent,
  NativeLayerItem,
} from '../../../shared/contracts/course-project-v9/types'
import type {
  FormulaNode,
  ImageNode,
  NativeRenderInput,
  ReadonlyNativeRenderInput,
  ShapeNode,
  TextNode,
} from '../../../shared/contracts/native-v1/types'
import type { PublishedNativeLayerItem } from '../../../shared/contracts/published-course-v2/types'
import { renderShapeCanvas } from '../../../shared/canvasShapeRenderer'
import { renderImageNodeCanvas } from '../../../shared/imageEffects'
import { registerPublishedCaptureResource } from '../publishedCapture'
import { paintPublishedFormula } from '../publishedFormula'
import { paintPublishedNativeText } from '../publishedNativeText'

export type PublishedNativeRenderInput = ReadonlyNativeRenderInput
export type PublishedTeacherControllerInput = Extract<
  PublishedNativeRenderInput,
  { readonly type: 'teacher-controller' }
>

export type NativePaintAssetResolver = (assetId: string) => string | undefined

export interface NativePaintPorts {
  readonly resolveAsset: NativePaintAssetResolver
  readonly mountTeacherController?: (
    wrap: HTMLElement,
    input: PublishedTeacherControllerInput,
  ) => void
}

export interface NativePaintOptions {
  readonly staticCapture?: boolean
}

export type NativeLayerRenderSource = {
  readonly layerItemId: string
  readonly label?: string
  readonly frame: NativeLayerItem['frame']
  readonly order?: number
  readonly visible: boolean
  readonly locked?: boolean
  readonly rotation: number
  readonly opacity: number
  readonly hitPolicy?: NativeLayerItem['hitPolicy']
  readonly playbackInitialVisibility: NativeLayerItem['playbackInitialVisibility']
  readonly paperSpace?: NativeLayerItem['paperSpace']
  readonly kind: 'native'
  readonly content: NativeElementContent
}

function freezeRenderSnapshot<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRenderSnapshot(child)
  }
  return Object.freeze(value)
}

function nativeLayout(item: NativeLayerRenderSource) {
  return {
    id: item.layerItemId,
    name: item.label ?? item.layerItemId,
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    rotation: item.rotation,
    opacity: item.opacity,
    visible: item.visible,
    locked: item.locked ?? false,
    playbackInitialVisibility: item.playbackInitialVisibility,
  } as const
}

/** Forward-only Published/V9 Native item → paint input. Not an authoring conversion. */
export function nativeRenderInputFromLayerItem(
  item: NativeLayerRenderSource,
): PublishedNativeRenderInput {
  const layout = nativeLayout(item)
  switch (item.content.nativeType) {
    case 'text':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'text' as const,
      })
    case 'formula':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'formula' as const,
      })
    case 'image':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'image' as const,
      })
    case 'video':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'video' as const,
      })
    case 'shape':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'shape' as const,
      })
    case 'teacher-controller':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'teacher-controller' as const,
      })
  }
}

export function readonlyNativeRenderInputFromPublishedItem(
  item: PublishedNativeLayerItem,
): PublishedNativeRenderInput {
  return nativeRenderInputFromLayerItem(item)
}

/** Transitional mutable type for export consumers; the snapshot is frozen. */
export function nativeRenderInputFromPublishedItem(
  item: PublishedNativeLayerItem,
): NativeRenderInput {
  return readonlyNativeRenderInputFromPublishedItem(item) as NativeRenderInput
}

export function readonlyNativeRenderInputFromV9Item(
  item: NativeLayerItem,
): PublishedNativeRenderInput {
  return nativeRenderInputFromLayerItem(item)
}

/**
 * Legacy export/measurement compatibility. The returned object is still a
 * detached, recursively frozen snapshot; only the transitional type is mutable.
 */
export function nativeRenderInputFromV9Item(item: NativeLayerItem): NativeRenderInput {
  return readonlyNativeRenderInputFromV9Item(item) as NativeRenderInput
}

/** Image, video and optional poster assets required by one formal Native input. */
export function nativeMediaAssetIds(input: PublishedNativeRenderInput): string[] {
  if (input.type === 'image') return [input.assetId]
  if (input.type === 'video') {
    const ids = [input.assetId]
    if (input.poster.assetId) ids.push(input.poster.assetId)
    return ids
  }
  return []
}

export function paintPublishedNativeRenderInput(
  wrap: HTMLElement,
  input: PublishedNativeRenderInput,
  ports: NativePaintPorts,
  options: NativePaintOptions = {},
): void {
  wrap.dataset.nativeType = input.type
  const staticCapture = options.staticCapture === true
  switch (input.type) {
    case 'teacher-controller':
      ports.mountTeacherController?.(wrap, input)
      return
    case 'text':
      paintPublishedNativeText(
        wrap,
        {
          text: input.text,
          runs: structuredClone(input.runs) as TextNode['runs'],
          style: structuredClone(input.style),
        },
        { width: input.width, height: input.height },
      )
      return
    case 'video':
      paintPublishedNativeVideo(wrap, input, ports.resolveAsset, staticCapture)
      return
    case 'formula':
      wrap.style.boxSizing = 'border-box'
      wrap.style.overflow = 'hidden'
      paintPublishedFormula(wrap, {
        formulaId: input.formulaId,
        accessibleText: input.accessibleText,
        ast: structuredClone(input.ast) as FormulaNode['ast'],
        style: input.style,
        width: Math.max(1, input.width),
        height: Math.max(1, input.height),
      })
      return
    case 'shape':
      paintPublishedNativeShape(wrap, input)
      return
    case 'image':
      paintPublishedNativeImage(wrap, input, ports.resolveAsset)
      return
  }
}

function paintPublishedNativeVideo(
  wrap: HTMLElement,
  input: Extract<PublishedNativeRenderInput, { readonly type: 'video' }>,
  resolveAsset: NativePaintAssetResolver,
  staticCapture: boolean,
): void {
  if (staticCapture) {
    Object.assign(wrap.style, {
      overflow: 'hidden',
      background: '#0b1120',
    })
    const posterId = input.poster.mode === 'image'
      ? input.poster.assetId
      : undefined
    const posterUrl = posterId ? resolveAsset(posterId) : undefined
    if (posterUrl) {
      const poster = wrap.ownerDocument.createElement('img')
      poster.src = posterUrl
      poster.alt = ''
      Object.assign(poster.style, {
        width: '100%',
        height: '100%',
        objectFit: input.fit,
      })
      wrap.appendChild(poster)
    } else {
      const url = resolveAsset(input.assetId)
      if (url) {
        const video = wrap.ownerDocument.createElement('video')
        video.src = url
        video.muted = true
        video.preload = 'auto'
        Object.assign(video.style, {
          width: '100%',
          height: '100%',
          objectFit: input.fit,
        })
        const targetTime = input.poster.mode === 'video-frame'
          ? input.poster.time
          : input.startTime
        const ready = new Promise<void>((resolve, reject) => {
          let settled = false
          const finish = (action: () => void) => {
            if (settled) return
            settled = true
            video.removeEventListener('loadedmetadata', seek)
            video.removeEventListener('loadeddata', complete)
            video.removeEventListener('seeked', complete)
            video.removeEventListener('error', fail)
            action()
          }
          const complete = () => finish(() => {
            video.pause()
            resolve()
          })
          const fail = () => finish(() => reject(new Error(
            `视频“${input.id}”的静态封面无法解码`,
          )))
          const seek = () => {
            try {
              video.currentTime = Math.max(0, targetTime)
              if (
                video.readyState >= 2
                && Math.abs(video.currentTime - Math.max(0, targetTime)) < 0.001
              ) {
                complete()
              }
            } catch (cause) {
              finish(() => reject(cause))
            }
          }
          video.addEventListener('loadedmetadata', seek)
          video.addEventListener('loadeddata', complete)
          video.addEventListener('seeked', complete)
          video.addEventListener('error', fail)
          if (video.readyState >= 1) seek()
        })
        registerPublishedCaptureResource(wrap, {
          waitForCaptureReady: () => ready,
        })
        wrap.appendChild(video)
      }
    }
    const play = wrap.ownerDocument.createElement('span')
    play.textContent = '▶'
    Object.assign(play.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      color: '#f8fafc',
      font: '48px/1 sans-serif',
    })
    wrap.appendChild(play)
    return
  }
  const url = resolveAsset(input.assetId)
  if (!url) return
  const video = wrap.ownerDocument.createElement('video')
  video.src = url
  video.controls = input.showControls
  video.loop = input.loop
  video.muted = input.muted
  try {
    video.volume = Number.isFinite(input.volume)
      ? Math.max(0, Math.min(1, input.volume))
      : 1
  } catch {
    // A synthetic element may reject volume assignment; playback still mounts.
  }
  try {
    video.playbackRate = Number.isFinite(input.playbackRate)
      ? Math.max(0.25, Math.min(4, input.playbackRate))
      : 1
  } catch {
    // Keep the default rate when the element rejects the authored value.
  }
  video.playsInline = true
  video.preload = 'auto'
  video.dataset.videoNodeId = input.id
  video.style.width = '100%'
  video.style.height = '100%'
  video.style.objectFit = input.fit === 'stretch' ? 'fill' : input.fit
  video.style.pointerEvents = 'auto'
  wrap.appendChild(video)
}

function paintPublishedNativeShape(
  wrap: HTMLElement,
  input: Extract<PublishedNativeRenderInput, { readonly type: 'shape' }>,
): void {
  const canvas = wrap.ownerDocument.createElement('canvas')
  canvas.width = Math.max(1, Math.round(input.width))
  canvas.height = Math.max(1, Math.round(input.height))
  Object.assign(canvas.style, {
    display: 'block',
    width: '100%',
    height: '100%',
  })
  const context = canvas.getContext('2d')
  if (context) {
    renderShapeCanvas(context, {
      ...structuredClone(input) as ShapeNode,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      visible: true,
    }, canvas.width, canvas.height)
  }
  wrap.appendChild(canvas)
}

function paintPublishedNativeImage(
  wrap: HTMLElement,
  input: Extract<PublishedNativeRenderInput, { readonly type: 'image' }>,
  resolveAsset: NativePaintAssetResolver,
): void {
  const url = resolveAsset(input.assetId)
  if (!url) return
  const image = wrap.ownerDocument.createElement('img')
  image.alt = ''
  image.hidden = true
  const pending = wrap.ownerDocument.createElement('canvas')
  pending.width = Math.max(1, Math.round(input.width))
  pending.height = Math.max(1, Math.round(input.height))
  Object.assign(pending.style, {
    display: 'block',
    width: '100%',
    height: '100%',
  })
  wrap.append(image, pending)

  const node = {
    ...structuredClone(input) as ImageNode,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    visible: true,
  }
  const showImageFallback = (): void => {
    if (pending.parentElement !== wrap || image.parentElement !== wrap) return
    pending.remove()
    image.hidden = false
    Object.assign(image.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: node.fit,
    })
  }
  const render = (): void => {
    if (pending.parentElement !== wrap || image.parentElement !== wrap) return
    try {
      const rendered = renderImageNodeCanvas(
        image,
        image.naturalWidth,
        image.naturalHeight,
        node,
        input.width,
        input.height,
        Math.min(2, wrap.ownerDocument.defaultView?.devicePixelRatio || 1),
      )
      Object.assign(rendered.style, {
        display: 'block',
        width: '100%',
        height: '100%',
      })
      rendered.setAttribute('aria-hidden', 'true')
      pending.replaceWith(rendered)
    } catch {
      showImageFallback()
    }
  }
  image.addEventListener('load', render, { once: true })
  image.addEventListener('error', showImageFallback, { once: true })
  image.src = url
  if (image.complete && image.naturalWidth > 0) render()
}
