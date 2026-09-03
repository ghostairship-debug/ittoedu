import type { PlayerApp } from '../../player/PlayerApp'
import { bytesToBase64 } from './base64'
import {
  assertParsedPublishedCourseV2,
  PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR,
  type CoursePlayer,
} from '../../player/surfaces/CoursePlayer'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '../../player/surfaces/publishedDynamicHosts'
import type {
  SurfaceCapture,
  SurfaceCaptureRequest,
} from '../../player/surfaces/SurfaceHost'

const DEFAULT_CAPTURE_TIMEOUT_MS = 10_000

function waitUntil(
  isReady: () => boolean,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      action()
    }
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error(timeoutMessage)))
    }, timeoutMs)
    const check = () => {
      if (settled) return
      try {
        if (isReady()) {
          finish(() => resolve())
          return
        }
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))))
        return
      }
      requestAnimationFrame(check)
    }
    check()
  })
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

export function waitForPlayerScene(
  player: PlayerApp,
  expectedIndex: number,
  timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
): Promise<void> {
  return waitUntil(
    () => player.getCurrentSceneIndex() === expectedIndex,
    timeoutMs,
    `静态导出播放器切换到第 ${expectedIndex + 1} 页超时`,
  )
}

export function waitForPlayerLoaderIdle(
  player: PlayerApp,
  timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
): Promise<void> {
  return waitUntil(
    () => {
      const scene = player.game.scene.getScene('courseware-player')
      return !scene?.load?.isLoading()
    },
    timeoutMs,
    '静态导出等待场景素材加载超时',
  )
}

export function settleCaptureFrames(milliseconds = 120): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    window.setTimeout(finish, milliseconds + 80)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.setTimeout(finish, milliseconds))
    })
  })
}

/**
 * PlayerApp exposes waitForCaptureReady() after runtime and component capture
 * hooks plus ctx.capture.waitUntil() promises settle. Export and preview use
 * the same current PlayerApp contract.
 */
export async function waitForPlayerCaptureReady(
  player: PlayerApp,
  timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
): Promise<void> {
  await waitForPlayerLoaderIdle(player, timeoutMs)
  // Let layout, fonts and the ordinary render loop settle before asking each
  // runtime/component to draw its deterministic capture frame. Waiting after
  // prepareCapture() could clear or overwrite a WebGL canvas created with
  // preserveDrawingBuffer=false.
  await settleCaptureFrames()
  await withTimeout(
    player.waitForCaptureReady(),
    timeoutMs,
    '自由运行时静态捕获等待超时',
  )
}

interface DomCaptureContext {
  context: CanvasRenderingContext2D
  stageRect: DOMRect
  imageCache: Map<string, Promise<HTMLImageElement>>
  /** Immediate copies keep WebGL canvases readable after prepareCapture(). */
  canvasCache: WeakMap<HTMLCanvasElement, HTMLCanvasElement>
}

function numericCss(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boundedOpacity(value: string, fallback = 1): number {
  return Math.max(0, Math.min(1, numericCss(value, fallback)))
}

function isTransparentColor(value: string): boolean {
  const compact = value.replace(/\s+/g, '').toLowerCase()
  if (compact === '' || compact === 'transparent') return true

  const functional = compact.match(/^[a-z]+\((.*)\)$/)
  if (!functional) return false
  const body = functional[1] ?? ''
  const slashIndex = body.lastIndexOf('/')
  const parts = body.split(',')
  const alphaToken = slashIndex >= 0
    ? body.slice(slashIndex + 1)
    : parts.length === 4
      ? parts.at(-1) ?? ''
      : ''
  if (!alphaToken) return false
  const alpha = Number.parseFloat(alphaToken)
  return Number.isFinite(alpha) && alpha <= 0
}

function roundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const boundedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  if (boundedRadius <= 0) {
    context.rect(x, y, width, height)
    return
  }
  context.roundRect(x, y, width, height, boundedRadius)
}

function localRectangle(rect: DOMRect, stageRect: DOMRect): DOMRect {
  return new DOMRect(
    rect.left - stageRect.left,
    rect.top - stageRect.top,
    rect.width,
    rect.height,
  )
}

function intersectsStage(rect: DOMRect, stageRect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0
    && rect.right > stageRect.left && rect.bottom > stageRect.top
    && rect.left < stageRect.right && rect.top < stageRect.bottom
}

function topLevelParts(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '(') {
      depth += 1
    } else if (character === ')') {
      depth = Math.max(0, depth - 1)
    } else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

function gradientCoordinates(
  direction: string,
  rect: DOMRect,
): [number, number, number, number] {
  const normalized = direction.trim().toLowerCase()
  if (normalized.startsWith('to ')) {
    const horizontal = normalized.includes('right')
      ? 1
      : normalized.includes('left') ? -1 : 0
    const vertical = normalized.includes('bottom')
      ? 1
      : normalized.includes('top') ? -1 : 0
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    return [
      centerX - horizontal * rect.width / 2,
      centerY - vertical * rect.height / 2,
      centerX + horizontal * rect.width / 2,
      centerY + vertical * rect.height / 2,
    ]
  }
  if (normalized.endsWith('deg')) {
    const degrees = numericCss(normalized, 180)
    const radians = (degrees - 90) * Math.PI / 180
    const horizontal = Math.cos(radians)
    const vertical = Math.sin(radians)
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    const extent = Math.abs(horizontal) * rect.width / 2
      + Math.abs(vertical) * rect.height / 2
    return [
      centerX - horizontal * extent,
      centerY - vertical * extent,
      centerX + horizontal * extent,
      centerY + vertical * extent,
    ]
  }
  return [rect.x, rect.y, rect.x, rect.bottom]
}

function linearGradient(
  context: CanvasRenderingContext2D,
  cssValue: string,
  rect: DOMRect,
): CanvasGradient | null {
  const match = /^linear-gradient\((.*)\)$/i.exec(cssValue.trim())
  if (!match) return null
  const values = topLevelParts(match[1] ?? '')
  if (values.length < 2) return null
  const hasDirection = /^(?:to\s|[-+.\d]+deg)/i.test(values[0] ?? '')
  const direction = hasDirection ? values.shift() ?? '' : 'to bottom'
  if (values.length < 2) return null
  const gradient = context.createLinearGradient(
    ...gradientCoordinates(direction, rect),
  )
  values.forEach((stop, index) => {
    const positionMatch = /\s+([-+.\d]+)%\s*$/.exec(stop)
    const color = positionMatch
      ? stop.slice(0, positionMatch.index).trim()
      : stop.trim()
    const offset = positionMatch
      ? Math.max(0, Math.min(1, numericCss(positionMatch[1] ?? '', 0) / 100))
      : index / Math.max(1, values.length - 1)
    try {
      gradient.addColorStop(offset, color)
    } catch {
      // Ignore an invalid authored stop and retain the remaining gradient.
    }
  })
  return gradient
}

async function embeddableImageUrl(source: string): Promise<string> {
  if (source.startsWith('data:')) return source
  const response = await fetch(source)
  if (!response.ok) throw new Error(`DOM 快照素材读取失败（${response.status}）`)
  const blob = await response.blob()
  const mimeType = blob.type || 'application/octet-stream'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

function loadCaptureImage(
  source: string,
  capture: DomCaptureContext,
): Promise<HTMLImageElement> {
  const cached = capture.imageCache.get(source)
  if (cached) return cached
  const loading = (async () => {
    const image = new Image()
    const embedded = await embeddableImageUrl(source)
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('DOM 快照图片解码失败'))
      image.src = embedded
    })
    return image
  })()
  capture.imageCache.set(source, loading)
  return loading
}

function drawReplacedImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  rect: DOMRect,
  fit: string,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
    return
  }
  if (fit === 'contain') {
    const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight)
    const width = sourceWidth * scale
    const height = sourceHeight * scale
    context.drawImage(
      image,
      rect.x + (rect.width - width) / 2,
      rect.y + (rect.height - height) / 2,
      width,
      height,
    )
    return
  }
  if (fit === 'cover') {
    const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight)
    const sourceCropWidth = rect.width / scale
    const sourceCropHeight = rect.height / scale
    context.drawImage(
      image,
      (sourceWidth - sourceCropWidth) / 2,
      (sourceHeight - sourceCropHeight) / 2,
      sourceCropWidth,
      sourceCropHeight,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    )
    return
  }
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
}

async function drawBackgroundImage(
  style: CSSStyleDeclaration,
  rect: DOMRect,
  capture: DomCaptureContext,
): Promise<void> {
  const backgroundImage = style.backgroundImage.trim()
  if (!backgroundImage || backgroundImage === 'none') return
  const gradient = linearGradient(capture.context, backgroundImage, rect)
  if (gradient) {
    capture.context.fillStyle = gradient
    capture.context.fillRect(rect.x, rect.y, rect.width, rect.height)
    return
  }
  const urlMatch = /^url\(["']?(.*?)["']?\)$/i.exec(backgroundImage)
  if (!urlMatch?.[1]) return
  const image = await loadCaptureImage(urlMatch[1], capture)
  const fit = style.backgroundSize === 'contain'
    ? 'contain'
    : style.backgroundSize === 'cover' ? 'cover' : 'fill'
  drawReplacedImage(
    capture.context,
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    rect,
    fit,
  )
}

async function paintElementBox(
  style: CSSStyleDeclaration,
  rect: DOMRect,
  opacity: number,
  capture: DomCaptureContext,
): Promise<void> {
  if (rect.width <= 0 || rect.height <= 0) return
  const context = capture.context
  const radius = Math.max(
    numericCss(style.borderTopLeftRadius),
    numericCss(style.borderTopRightRadius),
    numericCss(style.borderBottomRightRadius),
    numericCss(style.borderBottomLeftRadius),
  )
  context.save()
  context.globalAlpha = opacity
  roundedRectangle(context, rect.x, rect.y, rect.width, rect.height, radius)
  context.clip()
  if (!isTransparentColor(style.backgroundColor)) {
    context.fillStyle = style.backgroundColor
    context.fillRect(rect.x, rect.y, rect.width, rect.height)
  }
  await drawBackgroundImage(style, rect, capture)
  context.restore()

  const widths = [
    numericCss(style.borderTopWidth),
    numericCss(style.borderRightWidth),
    numericCss(style.borderBottomWidth),
    numericCss(style.borderLeftWidth),
  ]
  const colors = [
    style.borderTopColor,
    style.borderRightColor,
    style.borderBottomColor,
    style.borderLeftColor,
  ]
  const styles = [
    style.borderTopStyle,
    style.borderRightStyle,
    style.borderBottomStyle,
    style.borderLeftStyle,
  ]
  if (widths.every((width) => width <= 0)) return
  context.save()
  context.globalAlpha = opacity
  if (
    widths.every((width) => Math.abs(width - widths[0]!) < 0.1)
    && colors.every((color) => color === colors[0])
    && styles.every((borderStyle) => borderStyle !== 'none')
  ) {
    const width = widths[0] ?? 0
    context.lineWidth = width
    context.strokeStyle = colors[0] ?? '#000000'
    roundedRectangle(
      context,
      rect.x + width / 2,
      rect.y + width / 2,
      Math.max(0, rect.width - width),
      Math.max(0, rect.height - width),
      Math.max(0, radius - width / 2),
    )
    context.stroke()
  } else {
    const edges: Array<[number, number, number, number]> = [
      [rect.left, rect.top, rect.right, rect.top],
      [rect.right, rect.top, rect.right, rect.bottom],
      [rect.right, rect.bottom, rect.left, rect.bottom],
      [rect.left, rect.bottom, rect.left, rect.top],
    ]
    edges.forEach(([x1, y1, x2, y2], index) => {
      if ((widths[index] ?? 0) <= 0 || styles[index] === 'none') return
      context.beginPath()
      context.lineWidth = widths[index] ?? 0
      context.strokeStyle = colors[index] ?? '#000000'
      context.moveTo(x1, y1)
      context.lineTo(x2, y2)
      context.stroke()
    })
  }
  context.restore()
}

function transformedCharacter(character: string, transform: string): string {
  if (transform === 'uppercase') return character.toUpperCase()
  if (transform === 'lowercase') return character.toLowerCase()
  if (transform === 'capitalize') return character.toUpperCase()
  return character
}

function paintTextNode(
  node: Text,
  style: CSSStyleDeclaration,
  opacity: number,
  capture: DomCaptureContext,
): void {
  if (!node.data || isTransparentColor(style.color)) return
  const context = capture.context
  const fontSize = Math.max(1, numericCss(style.fontSize, 16))
  context.save()
  context.globalAlpha = opacity
  context.fillStyle = style.color
  context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  context.direction = style.direction === 'rtl' ? 'rtl' : 'ltr'

  const range = document.createRange()
  let offset = 0
  for (const character of node.data) {
    const nextOffset = offset + character.length
    range.setStart(node, offset)
    range.setEnd(node, nextOffset)
    const clientRect = range.getBoundingClientRect()
    offset = nextOffset
    if (!intersectsStage(clientRect, capture.stageRect) || /^\s$/u.test(character)) {
      continue
    }
    const rect = localRectangle(clientRect, capture.stageRect)
    const baseline = rect.top + Math.max(
      fontSize * 0.8,
      (rect.height - fontSize) / 2 + fontSize * 0.82,
    )
    context.fillText(
      transformedCharacter(character, style.textTransform),
      rect.left,
      baseline,
    )
    if (style.textDecorationLine.includes('underline')) {
      context.beginPath()
      context.lineWidth = Math.max(1, fontSize / 14)
      context.strokeStyle = style.color
      context.moveTo(rect.left, baseline + Math.max(1, fontSize / 14))
      context.lineTo(rect.right, baseline + Math.max(1, fontSize / 14))
      context.stroke()
    }
  }
  range.detach()
  context.restore()
}

function paintControlValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  style: CSSStyleDeclaration,
  rect: DOMRect,
  opacity: number,
  capture: DomCaptureContext,
): void {
  const value = element instanceof HTMLSelectElement
    ? element.selectedOptions[0]?.textContent ?? ''
    : element.value
  if (!value || element.childNodes.length > 0) return
  const context = capture.context
  const fontSize = Math.max(1, numericCss(style.fontSize, 16))
  context.save()
  context.globalAlpha = opacity
  context.fillStyle = style.color
  context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  context.textBaseline = 'middle'
  context.fillText(
    value,
    rect.x + numericCss(style.paddingLeft, 4),
    rect.y + rect.height / 2,
    Math.max(0, rect.width - numericCss(style.paddingLeft) - numericCss(style.paddingRight)),
  )
  context.restore()
}

async function paintReplacedElement(
  element: Element,
  style: CSSStyleDeclaration,
  rect: DOMRect,
  opacity: number,
  capture: DomCaptureContext,
): Promise<boolean> {
  let image: CanvasImageSource | null = null
  let sourceWidth = 0
  let sourceHeight = 0
  if (element instanceof HTMLImageElement) {
    const loaded = await loadCaptureImage(element.currentSrc || element.src, capture)
    image = loaded
    sourceWidth = loaded.naturalWidth || loaded.width
    sourceHeight = loaded.naturalHeight || loaded.height
  } else if (element instanceof HTMLCanvasElement) {
    const cached = capture.canvasCache.get(element) ?? element
    image = cached
    sourceWidth = cached.width
    sourceHeight = cached.height
  } else if (element instanceof HTMLVideoElement) {
    image = element
    sourceWidth = element.videoWidth
    sourceHeight = element.videoHeight
  } else if (element instanceof SVGSVGElement) {
    const clone = element.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const serialized = new XMLSerializer().serializeToString(clone)
    const source = `data:image/svg+xml;base64,${bytesToBase64(
      new TextEncoder().encode(serialized),
    )}`
    const loaded = await loadCaptureImage(source, capture)
    image = loaded
    sourceWidth = loaded.naturalWidth || rect.width
    sourceHeight = loaded.naturalHeight || rect.height
  }
  if (!image) return false

  const context = capture.context
  const radius = Math.max(
    numericCss(style.borderTopLeftRadius),
    numericCss(style.borderTopRightRadius),
    numericCss(style.borderBottomRightRadius),
    numericCss(style.borderBottomLeftRadius),
  )
  context.save()
  context.globalAlpha = opacity
  roundedRectangle(context, rect.x, rect.y, rect.width, rect.height, radius)
  context.clip()
  drawReplacedImage(
    context,
    image,
    sourceWidth,
    sourceHeight,
    rect,
    style.objectFit || 'fill',
  )
  context.restore()
  return true
}

async function paintNode(
  node: Node,
  inheritedOpacity: number,
  capture: DomCaptureContext,
): Promise<void> {
  if (node instanceof Text) {
    const parent = node.parentElement
    if (parent) paintTextNode(node, getComputedStyle(parent), inheritedOpacity, capture)
    return
  }
  if (!(node instanceof Element)) return
  if (node instanceof HTMLStyleElement || node instanceof HTMLScriptElement) return

  const style = getComputedStyle(node)
  if (style.display === 'none' || style.contentVisibility === 'hidden') return
  const opacity = inheritedOpacity * boundedOpacity(style.opacity)
  if (opacity <= 0.001) return
  const visible = style.visibility !== 'hidden' && style.visibility !== 'collapse'
  const clientRect = node.getBoundingClientRect()
  const rect = localRectangle(clientRect, capture.stageRect)
  const intersects = intersectsStage(clientRect, capture.stageRect)
  if (visible && intersects) {
    await paintElementBox(style, rect, opacity, capture)
    const replaced = await paintReplacedElement(node, style, rect, opacity, capture)
    if (replaced) return
    if (
      node instanceof HTMLInputElement
      || node instanceof HTMLTextAreaElement
      || node instanceof HTMLSelectElement
    ) {
      paintControlValue(node, style, rect, opacity, capture)
    }
  }

  if (node instanceof HTMLSlotElement) {
    for (const assigned of node.assignedNodes({ flatten: true })) {
      await paintNode(assigned, opacity, capture)
    }
    return
  }
  const children = node.shadowRoot?.childNodes ?? node.childNodes
  for (const child of children) await paintNode(child, opacity, capture)
}

function snapshotDomCanvases(
  stage: HTMLElement,
  preparedSnapshot?: (
    source: HTMLCanvasElement,
  ) => HTMLCanvasElement | undefined,
): WeakMap<HTMLCanvasElement, HTMLCanvasElement> {
  const cache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()
  const canvases = new Set<HTMLCanvasElement>()
  const collect = (node: Node): void => {
    if (node instanceof HTMLCanvasElement) canvases.add(node)
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true })
      const composedChildren = assigned.length > 0
        ? assigned
        : [...node.childNodes]
      composedChildren.forEach(collect)
      return
    }
    if (node instanceof Element && node.shadowRoot) {
      collect(node.shadowRoot)
      return
    }
    node.childNodes.forEach(collect)
  }
  collect(stage)
  for (const source of canvases) {
    const prepared = preparedSnapshot?.(source)
    if (prepared) {
      cache.set(source, prepared)
      continue
    }
    const copy = document.createElement('canvas')
    copy.width = source.width
    copy.height = source.height
    const context = copy.getContext('2d')
    if (!context || copy.width <= 0 || copy.height <= 0) continue
    context.drawImage(source, 0, 0)
    cache.set(source, copy)
  }
  return cache
}

function stageHasCompositedDom(stage: HTMLElement): boolean {
  return stage.querySelector([
    '.lesson-runtime-mount',
    '.lesson-component-mount',
    '[data-courseware-runtime-root]',
    '[data-courseware-component-root]',
  ].join(',')) !== null
}

function phaserSnapshot(player: PlayerApp): Promise<string> {
  return new Promise((resolve, reject) => {
    player.game.renderer.snapshot((snapshot) => {
      if (snapshot instanceof HTMLImageElement) {
        resolve(snapshot.src)
        return
      }
      reject(new Error('渲染器未返回可导出的页面图像'))
    }, 'image/png', 0.96)
  })
}

/**
 * Composes the actual Phaser snapshot with the live DOM runtime roots. DOM is
 * painted with origin-clean Canvas primitives instead of SVG foreignObject,
 * because Office and PDF engines do not consistently render foreignObject.
 * The result is always an ordinary PNG that both export formats can embed.
 */
export async function capturePlayerStage(
  player: PlayerApp,
  root: HTMLElement,
  width: number,
  height: number,
): Promise<string> {
  const stage = root.querySelector<HTMLElement>('.lesson-stage')
  if (!stage) throw new Error('静态导出找不到播放器舞台')
  // Capture players are created at the project's exact logical dimensions.
  // Phaser can still schedule a FIT realignment while changing scenes; pinning
  // these DOM layers here prevents a stale transient transform from clipping a
  // persistent global runtime on later pages.
  for (const layer of stage.querySelectorAll<HTMLElement>(
    ':scope > .lesson-runtime-layer',
  )) {
    Object.assign(layer.style, {
      left: '0',
      top: '0',
      width: `${width}px`,
      height: `${height}px`,
      transform: 'none',
      transformOrigin: '0 0',
    })
  }
  const initialStageStyle = getComputedStyle(stage)
  if (
    !stageHasCompositedDom(stage) &&
    isTransparentColor(initialStageStyle.backgroundColor)
  ) {
    return phaserSnapshot(player)
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width))
    canvas.height = Math.max(1, Math.round(height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建播放器合成画布')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'

    const capture: DomCaptureContext = {
      context,
      stageRect: stage.getBoundingClientRect(),
      imageCache: new Map(),
      // Copy immediately, before the asynchronous Phaser snapshot can allow a
      // Three/WebGL renderer with preserveDrawingBuffer=false to clear again.
      canvasCache: snapshotDomCanvases(
        stage,
        typeof player.getPreparedCanvasSnapshot === 'function'
          ? player.getPreparedCanvasSnapshot.bind(player)
          : undefined,
      ),
    }
    const stageStyle = initialStageStyle
    if (!isTransparentColor(stageStyle.backgroundColor)) {
      context.fillStyle = stageStyle.backgroundColor
      context.fillRect(0, 0, width, height)
    }

    const canvasHost = stage.querySelector<HTMLElement>(
      ':scope > .lesson-canvas-host',
    )
    const canvasZIndex = canvasHost
      ? numericCss(getComputedStyle(canvasHost).zIndex, 2)
      : 2
    const layers = [...stage.querySelectorAll<HTMLElement>(
      ':scope > .lesson-runtime-layer',
    )]
      .map((layer, index) => ({
        layer,
        index,
        zIndex: numericCss(getComputedStyle(layer).zIndex),
      }))
      .sort((left, right) => left.zIndex - right.zIndex || left.index - right.index)

    for (const { layer, zIndex } of layers) {
      if (zIndex < canvasZIndex) await paintNode(layer, 1, capture)
    }
    const baseSnapshot = await phaserSnapshot(player)
    const baseImage = await loadCaptureImage(baseSnapshot, capture)
    context.drawImage(baseImage, 0, 0, width, height)

    // Phaser DOM Elements share a fixed plane above the Phaser canvas. Paint
    // only that DOM container, never the already snapshotted main canvas.
    if (canvasHost) {
      for (const child of canvasHost.children) {
        if (child === player.game.canvas || child instanceof HTMLCanvasElement) continue
        await paintNode(child, 1, capture)
      }
    }
    for (const { layer, zIndex } of layers) {
      if (zIndex >= canvasZIndex) await paintNode(layer, 1, capture)
    }
    return canvas.toDataURL('image/png')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`播放器 DOM 与 Canvas 合成快照失败：${reason}`, {
      cause: error,
    })
  }
}

export function createHiddenPlayerRoot(
  width: number,
  height: number,
): HTMLDivElement {
  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  Object.assign(root.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    opacity: '0',
  })
  document.body.append(root)
  return root
}

export function sizeHiddenPlayerStage(
  root: HTMLElement,
  width: number,
  height: number,
): void {
  const shell = root.querySelector<HTMLElement>('.lesson-shell')
  const stage = root.querySelector<HTMLElement>('.lesson-stage')
  const canvasHost = root.querySelector<HTMLElement>('.lesson-canvas-host')
  if (shell) {
    Object.assign(shell.style, {
      position: 'relative',
      width: `${width}px`,
      height: `${height}px`,
      overflow: 'hidden',
      background: 'transparent',
    })
  }
  if (stage) {
    Object.assign(stage.style, {
      position: 'relative',
      display: 'block',
      width: `${width}px`,
      height: `${height}px`,
      minWidth: `${width}px`,
      minHeight: `${height}px`,
      overflow: 'hidden',
    })
  }
  if (canvasHost) {
    Object.assign(canvasHost.style, {
      position: 'absolute',
      inset: '0',
      width: `${width}px`,
      height: `${height}px`,
    })
  }
}

export {
  assertParsedPublishedCourseV2,
  PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR,
}

export interface PublishedCourseV2CaptureHandle {
  readonly session: PublishedCourseSession
  readonly player: CoursePlayer
  capture(request?: SurfaceCaptureRequest): Promise<string>
  destroy(): Promise<void>
}

function firstPublishedCapturableSurfaceId(payload: {
  surfaces: readonly { id: string; type: string }[]
}): string {
  const slide = payload.surfaces.find((surface) => surface.type === 'slide')
  const surface = slide ?? payload.surfaces[0]
  if (!surface) throw new Error('Published Course V2 没有可捕获的表面')
  return surface.id
}

/**
 * Mounts an already-parsed Published Course V2 onto CoursePlayer for capture.
 * Leftover player export envelopes and PlayerApp input fail before any host
 * is created.
 */
export async function mountPublishedCourseV2Capture(input: {
  payload: unknown
  container: HTMLElement
  locationId?: string
  includeGlobalLayerItems?: boolean
}): Promise<PublishedCourseV2CaptureHandle> {
  assertParsedPublishedCourseV2(input.payload)
  const session = createPublishedCourseSession(input.payload, {
    staticCapture: true,
    includeGlobalLayerItemsForStaticCapture: input.includeGlobalLayerItems === true,
    ...(input.locationId ? { initialLocationId: input.locationId } : {}),
  })
  try {
    await session.mount(input.container)
  } catch (cause) {
    try {
      await session.destroy()
    } catch {
      // The mount failure remains authoritative; teardown is best effort.
    }
    throw cause
  }
  return {
    session,
    player: session.player,
    async capture(request: SurfaceCaptureRequest = { purpose: 'export' }) {
      const result = await session.player.capturePublishedCourseV2Surface(
        input.payload,
        firstPublishedCapturableSurfaceId(input.payload as {
          surfaces: readonly { id: string; type: string }[]
        }),
        request,
      )
      if (!result.ok || result.value?.format !== 'data-url') {
        throw result.failure?.error ?? new Error('Published Course V2 捕获没有返回图片')
      }
      return result.value.content
    },
    destroy: () => session.destroy(),
  }
}

/**
 * One-shot V2 capture. 033/041–043 should call this instead of PlayerApp.
 * Leftover player payloads fail loudly without probing PlayerApp.
 */
export async function capturePublishedCourseV2Stage(input: {
  payload: unknown
  document?: Document
  locationId?: string
  surfaceId?: string
  layerItemId?: string
  includeGlobalLayerItems?: boolean
}): Promise<string> {
  assertParsedPublishedCourseV2(input.payload)
  const targetDocument = input.document ?? document
  const root = targetDocument.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  Object.assign(root.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '1280px',
    height: '720px',
    overflow: 'hidden',
    pointerEvents: 'none',
    opacity: '0',
  })
  targetDocument.body.append(root)
  let handle: PublishedCourseV2CaptureHandle | null = null
  try {
    handle = await mountPublishedCourseV2Capture({
      payload: input.payload,
      container: root,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      includeGlobalLayerItems: input.includeGlobalLayerItems,
    })
    const surfaceId = input.surfaceId ?? firstPublishedCapturableSurfaceId(input.payload)
    if (input.locationId) await handle.session.goToLocation(input.locationId)
    await settleCaptureFrames()
    const result = await handle.player.capturePublishedCourseV2Surface(
      input.payload,
      surfaceId,
      {
        purpose: 'export',
        ...(input.layerItemId ? { layerItemId: input.layerItemId } : {}),
      },
    )
    if (!result.ok || result.value?.format !== 'data-url') {
      throw result.failure?.error ?? new Error('Published Course V2 捕获没有返回图片')
    }
    return result.value.content
  } finally {
    try {
      await handle?.destroy()
    } finally {
      root.remove()
    }
  }
}

export interface PublishedCourseV2PrintCaptureSession {
  capturePage(input: {
    locationId: string
    surfaceId: string
    frameId?: string
    width?: number
    height?: number
  }): Promise<SurfaceCapture>
  destroy(): Promise<void>
}

function appendHiddenPublishedV2CaptureRoot(targetDocument: Document): HTMLElement {
  const root = targetDocument.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  Object.assign(root.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '1280px',
    height: '720px',
    overflow: 'visible',
    pointerEvents: 'none',
    opacity: '0',
  })
  targetDocument.body.append(root)
  return root
}

/**
 * PDF print capture over the r11-031 V2 seam: one CoursePlayer mount, then
 * goToLocation + capturePublishedCourseV2Surface. Leftover player envelopes
 * and PlayerApp fail before any host is created.
 */
export async function createPublishedCourseV2PrintCaptureSession(input: {
  payload: unknown
  includeGlobalLayerItems?: boolean
  document?: Document
}): Promise<PublishedCourseV2PrintCaptureSession> {
  assertParsedPublishedCourseV2(input.payload)
  const targetDocument = input.document ?? document
  const root = appendHiddenPublishedV2CaptureRoot(targetDocument)
  let handle: PublishedCourseV2CaptureHandle | null = null
  try {
    handle = await mountPublishedCourseV2Capture({
      payload: input.payload,
      container: root,
      includeGlobalLayerItems: input.includeGlobalLayerItems,
    })
  } catch (error) {
    root.remove()
    throw error
  }
  const mounted = handle
  let closing = false
  let queue: Promise<void> = Promise.resolve()
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(new Error('Published Course V2 打印捕获会话已销毁'))
    const scheduled = queue.then(work, work)
    queue = scheduled.then(() => undefined, () => undefined)
    return scheduled
  }
  return {
    capturePage(request) {
      return enqueue(async () => {
        assertParsedPublishedCourseV2(input.payload)
        if (request.width) root.style.width = `${request.width}px`
        if (request.height) root.style.height = `${request.height}px`
        await mounted.session.goToLocation(request.locationId)
        await settleCaptureFrames()
        const result = await mounted.player.capturePublishedCourseV2Surface(
          input.payload,
          request.surfaceId,
          {
            purpose: 'export',
            ...(request.frameId ? { frameId: request.frameId } : {}),
            ...(request.width ? { width: request.width } : {}),
            ...(request.height ? { height: request.height } : {}),
          },
        )
        if (!result.ok || result.value?.format !== 'data-url') {
          throw result.failure?.error ?? new Error('Published Course V2 捕获没有返回图片')
        }
        return result.value
      })
    },
    async destroy() {
      if (closing) {
        await queue
        return
      }
      closing = true
      await queue
      try {
        await mounted.destroy()
      } finally {
        root.remove()
      }
    },
  }
}

/**
 * V2 capture-ready wait. Passing PlayerApp / leftover player payload fails
 * immediately.
 */
export async function waitForPublishedCourseCaptureReady(
  host: unknown,
  _timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
): Promise<void> {
  assertParsedPublishedCourseV2Host(host)
  await settleCaptureFrames()
}

function assertParsedPublishedCourseV2Host(host: unknown): void {
  if (
    host
    && typeof host === 'object'
    && 'player' in host
    && (host as { player?: unknown }).player
    && typeof (host as { player: { capturePublishedCourseV2Surface?: unknown } }).player
      .capturePublishedCourseV2Surface === 'function'
  ) {
    return
  }
  if (
    host
    && typeof host === 'object'
    && typeof (host as { capturePublishedCourseV2Surface?: unknown })
      .capturePublishedCourseV2Surface === 'function'
  ) {
    return
  }
  throw new Error(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
}
