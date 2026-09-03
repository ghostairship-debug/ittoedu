const DEFAULT_CAPTURE_TIMEOUT_MS = 10_000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function captureError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

/**
 * Tracks finite work registered through ctx.capture.waitUntil(). Rejections are
 * sticky: a promise that failed before capture was requested must still fail
 * the later export barrier instead of becoming an unhandled rejection or a
 * successful-looking stale frame.
 */
export class PublishedCaptureBarrier {
  readonly #pending = new Set<Promise<void>>()
  #failure: Error | null = null
  #destroyed = false

  waitUntil(promise: Promise<unknown>): void {
    if (this.#destroyed) return
    const tracked = Promise.resolve(promise).then(
      () => undefined,
      (cause: unknown) => {
        const error = captureError(cause)
        this.#failure ??= error
        throw error
      },
    )
    this.#pending.add(tracked)
    void tracked.then(
      () => this.#pending.delete(tracked),
      () => this.#pending.delete(tracked),
    )
    // Observe early rejection while retaining #failure for the capture call.
    void tracked.catch(() => undefined)
  }

  fail(cause: unknown): Error {
    const error = captureError(cause)
    this.#failure ??= error
    return error
  }

  async waitForReady(prepareCapture?: () => void | Promise<void>): Promise<void> {
    this.#assertAlive()
    await this.#drain()
    this.#assertAlive()
    if (this.#failure) throw this.#failure
    if (prepareCapture) {
      try {
        await prepareCapture()
      } catch (cause) {
        throw this.fail(cause)
      }
    }
    // prepareCapture may synchronously register another finite task.
    await this.#drain()
    this.#assertAlive()
    if (this.#failure) throw this.#failure
  }

  destroy(): void {
    this.#destroyed = true
    this.#pending.clear()
  }

  async #drain(): Promise<void> {
    while (this.#pending.size > 0) {
      const generation = [...this.#pending]
      try {
        await Promise.all(generation)
      } catch (cause) {
        throw this.fail(cause)
      }
      if (this.#failure) throw this.#failure
    }
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('捕获资源已销毁')
  }
}

export interface PublishedCaptureResource {
  waitForCaptureReady(): Promise<void>
  restoreAfterCapture?(): void
}

const captureResources = new WeakMap<Element, Set<PublishedCaptureResource>>()

/** Attach readiness to the stable authored wrapper, not an async inner host. */
export function registerPublishedCaptureResource(
  owner: Element,
  resource: PublishedCaptureResource,
): () => void {
  let resources = captureResources.get(owner)
  if (!resources) {
    resources = new Set()
    captureResources.set(owner, resources)
  }
  resources.add(resource)
  let active = true
  return () => {
    if (!active) return
    active = false
    resources?.delete(resource)
    if (resources?.size === 0) captureResources.delete(owner)
  }
}

function visitComposedElements(root: Element, visit: (element: Element) => void): void {
  visit(root)
  if (root.shadowRoot) {
    for (const child of root.shadowRoot.children) visitComposedElements(child, visit)
  }
  if (root instanceof HTMLSlotElement) {
    const assigned = root.assignedElements({ flatten: true })
    const children = assigned.length > 0 ? assigned : [...root.children]
    for (const assigned of children) {
      visitComposedElements(assigned, visit)
    }
    return
  }
  for (const child of root.children) visitComposedElements(child, visit)
}

interface PublishedCaptureResourceEntry {
  readonly owner: Element
  readonly resource: PublishedCaptureResource
}

function resourcesBelow(roots: readonly Element[]): PublishedCaptureResourceEntry[] {
  const found = new Map<PublishedCaptureResource, Element>()
  roots.forEach((root) => visitComposedElements(root, (element) => {
    captureResources.get(element)?.forEach((resource) => {
      if (!found.has(resource)) found.set(resource, element)
    })
  }))
  return [...found].map(([resource, owner]) => ({ owner, resource }))
}

class PublishedCanvasSnapshots {
  readonly #snapshots = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()

  capture(owner: Element): void {
    visitComposedElements(owner, (element) => {
      if (!(element instanceof HTMLCanvasElement)) return
      if (element.width <= 0 || element.height <= 0) return
      const copy = element.ownerDocument.createElement('canvas')
      copy.width = element.width
      copy.height = element.height
      const context = copy.getContext('2d')
      if (!context) throw new Error('无法冻结 Published Canvas 最终帧')
      try {
        context.drawImage(element, 0, 0)
      } catch (cause) {
        throw new Error(`Published Canvas 最终帧无法冻结：${captureError(cause).message}`, {
          cause,
        })
      }
      this.#snapshots.set(element, copy)
    })
  }

  get(source: HTMLCanvasElement): HTMLCanvasElement | undefined {
    return this.#snapshots.get(source)
  }
}

function captureClockMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/**
 * One monotonic deadline owns the complete capture. Every asynchronous stage
 * receives only the remaining budget, and image fetches share one abort signal.
 */
class PublishedCaptureDeadline {
  readonly #expiresAt: number
  readonly #abortController = new AbortController()

  constructor(timeoutMs: number) {
    this.#expiresAt = captureClockMs() + Math.max(0, timeoutMs)
  }

  get signal(): AbortSignal {
    return this.#abortController.signal
  }

  assertAvailable(message: string): void {
    if (!this.signal.aborted && this.#remainingMs() > 0) return
    const error = new Error(message)
    this.#expire(error)
    throw error
  }

  waitFor<T>(
    promise: PromiseLike<T>,
    message: string,
    onDeadline?: () => void,
  ): Promise<T> {
    const pending = Promise.resolve(promise)
    const remainingMs = this.#remainingMs()
    if (this.signal.aborted || remainingMs <= 0) {
      onDeadline?.()
      const error = new Error(message)
      this.#expire(error)
      void pending.catch(() => undefined)
      return Promise.reject(error)
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (complete: () => void) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        this.signal.removeEventListener('abort', handleAbort)
        complete()
      }
      const timeoutError = () => new Error(message)
      const handleAbort = () => {
        if (settled) return
        onDeadline?.()
        finish(() => reject(timeoutError()))
      }
      const timeout = window.setTimeout(() => {
        const error = timeoutError()
        this.#expire(error)
        handleAbort()
      }, remainingMs)

      this.signal.addEventListener('abort', handleAbort, { once: true })
      pending.then(
        (value) => finish(() => resolve(value)),
        (cause: unknown) => finish(() => reject(cause)),
      )
    })
  }

  #remainingMs(): number {
    return Math.max(0, this.#expiresAt - captureClockMs())
  }

  #expire(error: Error): void {
    if (!this.signal.aborted) this.#abortController.abort(error)
  }
}

async function prepareResources(
  roots: readonly Element[],
  deadline: PublishedCaptureDeadline,
): Promise<{
  entries: PublishedCaptureResourceEntry[]
  canvasSnapshots: PublishedCanvasSnapshots
}> {
  const entries = resourcesBelow(roots)
  const canvasSnapshots = new PublishedCanvasSnapshots()
  try {
    // Prepare and freeze one instance at a time. A later, slower instance must
    // not outlive the readable drawing buffer produced by an earlier
    // prepareCapture() when preserveDrawingBuffer is false.
    for (const entry of entries) {
      await deadline.waitFor(
        entry.resource.waitForCaptureReady(),
        'Published 静态捕获等待动态内容就绪超时',
      )
      canvasSnapshots.capture(entry.owner)
    }
    return { entries, canvasSnapshots }
  } catch (cause) {
    // Some siblings may already have entered capture mode when another one
    // fails. Restore every discovered resource before propagating the cause.
    for (const { resource } of [...entries].reverse()) {
      try {
        resource.restoreAfterCapture?.()
      } catch {
        // The readiness failure remains authoritative.
      }
    }
    throw cause
  }
}

interface CaptureRect {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

interface DomPaintContext {
  readonly context: CanvasRenderingContext2D
  readonly origin: { left: number; top: number }
  readonly imageCache: Map<string, Promise<HTMLImageElement>>
  readonly canvasSnapshots: PublishedCanvasSnapshots
  readonly deadline: PublishedCaptureDeadline
}

function localRect(rect: DOMRect, origin: DomPaintContext['origin']): CaptureRect {
  const left = rect.left - origin.left
  const top = rect.top - origin.top
  return {
    left,
    top,
    width: rect.width,
    height: rect.height,
    right: left + rect.width,
    bottom: top + rect.height,
  }
}

function cssNumber(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function computedStyle(element: Element): CSSStyleDeclaration {
  return element.ownerDocument.defaultView?.getComputedStyle(element)
    ?? getComputedStyle(element)
}

function boundedOpacity(value: string, fallback = 1): number {
  return Math.max(0, Math.min(1, cssNumber(value, fallback)))
}

function maximumBorderRadius(style: CSSStyleDeclaration): number {
  // Some DOM/CSS implementations expose an authored shorthand without
  // expanding its computed longhands. Including both forms also makes capture
  // resilient while styles are being applied in the same rendering turn.
  return Math.max(
    cssNumber(style.borderRadius),
    cssNumber(style.borderTopLeftRadius),
    cssNumber(style.borderTopRightRadius),
    cssNumber(style.borderBottomRightRadius),
    cssNumber(style.borderBottomLeftRadius),
  )
}

function isTransparent(value: string): boolean {
  const compact = value.replace(/\s+/g, '').toLowerCase()
  if (!compact || compact === 'transparent') return true
  const rgba = /^rgba\([^,]+,[^,]+,[^,]+,([^\)]+)\)$/.exec(compact)
  return rgba ? cssNumber(rgba[1] ?? '', 1) <= 0 : false
}

function roundedRectangle(
  context: CanvasRenderingContext2D,
  rect: CaptureRect,
  radius: number,
): void {
  const boundedRadius = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2))
  context.beginPath()
  if (boundedRadius <= 0) {
    context.rect(rect.left, rect.top, rect.width, rect.height)
    return
  }
  context.roundRect(rect.left, rect.top, rect.width, rect.height, boundedRadius)
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
    if (character === '"' || character === "'") quote = character
    else if (character === '(') depth += 1
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

function gradientCoordinates(
  direction: string,
  rect: CaptureRect,
): [number, number, number, number] {
  const normalized = direction.trim().toLowerCase()
  if (normalized.startsWith('to ')) {
    const horizontal = normalized.includes('right') ? 1 : normalized.includes('left') ? -1 : 0
    const vertical = normalized.includes('bottom') ? 1 : normalized.includes('top') ? -1 : 0
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    return [
      centerX - horizontal * rect.width / 2,
      centerY - vertical * rect.height / 2,
      centerX + horizontal * rect.width / 2,
      centerY + vertical * rect.height / 2,
    ]
  }
  if (normalized.endsWith('deg')) {
    const radians = (cssNumber(normalized, 180) - 90) * Math.PI / 180
    const horizontal = Math.cos(radians)
    const vertical = Math.sin(radians)
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const extent = Math.abs(horizontal) * rect.width / 2
      + Math.abs(vertical) * rect.height / 2
    return [
      centerX - horizontal * extent,
      centerY - vertical * extent,
      centerX + horizontal * extent,
      centerY + vertical * extent,
    ]
  }
  return [rect.left, rect.top, rect.left, rect.bottom]
}

function linearGradient(
  context: CanvasRenderingContext2D,
  cssValue: string,
  rect: CaptureRect,
): CanvasGradient | null {
  const match = /^linear-gradient\((.*)\)$/i.exec(cssValue.trim())
  if (!match) return null
  const values = topLevelParts(match[1] ?? '')
  if (values.length < 2) return null
  const hasDirection = /^(?:to\s|[-+.\d]+deg)/i.test(values[0] ?? '')
  const direction = hasDirection ? values.shift() ?? '' : 'to bottom'
  const gradient = context.createLinearGradient(...gradientCoordinates(direction, rect))
  values.forEach((stop, index) => {
    const positionMatch = /\s+([-+.\d]+)%\s*$/.exec(stop)
    const color = positionMatch ? stop.slice(0, positionMatch.index).trim() : stop.trim()
    const offset = positionMatch
      ? Math.max(0, Math.min(1, cssNumber(positionMatch[1] ?? '') / 100))
      : index / Math.max(1, values.length - 1)
    try {
      gradient.addColorStop(offset, color)
    } catch {
      // Keep valid authored stops when one stop is not accepted by Canvas.
    }
  })
  return gradient
}

async function embeddableImageSource(
  source: string,
  deadline: PublishedCaptureDeadline,
): Promise<string> {
  if (source.startsWith('data:') || source.startsWith('blob:')) return source
  const response = await deadline.waitFor(
    fetch(source, { signal: deadline.signal }),
    'Published 静态捕获等待图片素材读取超时',
  )
  if (!response.ok) throw new Error(`Published 捕获素材读取失败（${response.status}）`)
  const blob = await deadline.waitFor(
    response.blob(),
    'Published 静态捕获等待图片素材响应超时',
  )
  const bytes = new Uint8Array(await deadline.waitFor(
    blob.arrayBuffer(),
    'Published 静态捕获等待图片素材读取超时',
  ))
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`
}

async function decodeImage(
  image: HTMLImageElement,
  source: string,
  deadline: PublishedCaptureDeadline,
): Promise<void> {
  let settled = false
  const cleanup = () => {
    image.onload = null
    image.onerror = null
  }
  const abandon = () => {
    if (settled) return
    settled = true
    cleanup()
    image.removeAttribute('src')
  }
  const decoding = new Promise<void>((resolve, reject) => {
    image.onload = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    image.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      image.removeAttribute('src')
      reject(new Error('Published 捕获图片解码失败'))
    }
    try {
      image.src = source
    } catch (cause) {
      abandon()
      reject(cause)
    }
  })
  await deadline.waitFor(
    decoding,
    'Published 静态捕获等待图片解码超时',
    abandon,
  )
}

function loadImage(source: string, paint: DomPaintContext): Promise<HTMLImageElement> {
  const cached = paint.imageCache.get(source)
  if (cached) return cached
  const loading = (async () => {
    const embedded = await embeddableImageSource(source, paint.deadline)
    const image = new Image()
    await decodeImage(image, embedded, paint.deadline)
    return image
  })()
  paint.imageCache.set(source, loading)
  return loading
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  rect: CaptureRect,
  fit: string,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0 || rect.width <= 0 || rect.height <= 0) return
  if (fit === 'contain') {
    const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight)
    const width = sourceWidth * scale
    const height = sourceHeight * scale
    context.drawImage(
      image,
      rect.left + (rect.width - width) / 2,
      rect.top + (rect.height - height) / 2,
      width,
      height,
    )
    return
  }
  if (fit === 'cover') {
    const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight)
    const cropWidth = rect.width / scale
    const cropHeight = rect.height / scale
    context.drawImage(
      image,
      (sourceWidth - cropWidth) / 2,
      (sourceHeight - cropHeight) / 2,
      cropWidth,
      cropHeight,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
    )
    return
  }
  context.drawImage(image, rect.left, rect.top, rect.width, rect.height)
}

async function paintBackgroundImage(
  style: CSSStyleDeclaration,
  rect: CaptureRect,
  paint: DomPaintContext,
): Promise<void> {
  const backgroundImage = style.backgroundImage.trim()
  if (!backgroundImage || backgroundImage === 'none') return
  const gradient = linearGradient(paint.context, backgroundImage, rect)
  if (gradient) {
    paint.context.fillStyle = gradient
    paint.context.fillRect(rect.left, rect.top, rect.width, rect.height)
    return
  }
  const match = /^url\(["']?(.*?)["']?\)$/i.exec(backgroundImage)
  if (!match?.[1]) return
  const image = await loadImage(match[1], paint)
  const fit = style.backgroundSize === 'contain'
    ? 'contain'
    : style.backgroundSize === 'cover' ? 'cover' : 'fill'
  drawContainedImage(
    paint.context,
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    rect,
    fit,
  )
}

async function paintElementBox(
  style: CSSStyleDeclaration,
  rect: CaptureRect,
  opacity: number,
  paint: DomPaintContext,
): Promise<void> {
  const context = paint.context
  const radius = maximumBorderRadius(style)
  context.save()
  context.globalAlpha *= opacity
  roundedRectangle(context, rect, radius)
  context.clip()
  if (!isTransparent(style.backgroundColor)) {
    context.fillStyle = style.backgroundColor
    context.fillRect(rect.left, rect.top, rect.width, rect.height)
  }
  await paintBackgroundImage(style, rect, paint)
  context.restore()
  const borderWidth = Math.max(
    cssNumber(style.borderTopWidth),
    cssNumber(style.borderRightWidth),
    cssNumber(style.borderBottomWidth),
    cssNumber(style.borderLeftWidth),
  )
  if (borderWidth > 0 && style.borderTopStyle !== 'none') {
    context.save()
    context.globalAlpha *= opacity
    context.lineWidth = borderWidth
    context.strokeStyle = style.borderTopColor
    roundedRectangle(context, {
      left: rect.left + borderWidth / 2,
      top: rect.top + borderWidth / 2,
      width: Math.max(0, rect.width - borderWidth),
      height: Math.max(0, rect.height - borderWidth),
      right: rect.right - borderWidth / 2,
      bottom: rect.bottom - borderWidth / 2,
    }, Math.max(0, radius - borderWidth / 2))
    context.stroke()
    context.restore()
  }
}

function paintText(
  node: Text,
  opacity: number,
  paint: DomPaintContext,
): void {
  const parent = node.parentElement
  if (!parent || !node.data) return
  const style = computedStyle(parent)
  if (isTransparent(style.color)) return
  const context = paint.context
  const fontSize = Math.max(1, cssNumber(style.fontSize, 16))
  context.save()
  context.globalAlpha *= opacity
  context.fillStyle = style.color
  context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  context.direction = style.direction === 'rtl' ? 'rtl' : 'ltr'
  const range = node.ownerDocument.createRange()
  let offset = 0
  for (const character of node.data) {
    const next = offset + character.length
    range.setStart(node, offset)
    range.setEnd(node, next)
    const rect = localRect(range.getBoundingClientRect(), paint.origin)
    offset = next
    if (/^\s$/u.test(character) || rect.width <= 0 || rect.height <= 0) continue
    const baseline = rect.top + Math.max(
      fontSize * 0.8,
      (rect.height - fontSize) / 2 + fontSize * 0.82,
    )
    context.fillText(character, rect.left, baseline)
  }
  range.detach()
  context.restore()
}

function paintControlValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  style: CSSStyleDeclaration,
  rect: CaptureRect,
  opacity: number,
  paint: DomPaintContext,
): void {
  const value = element instanceof HTMLSelectElement
    ? element.selectedOptions[0]?.textContent ?? ''
    : element.value
  if (!value) return
  const context = paint.context
  const fontSize = Math.max(1, cssNumber(style.fontSize, 16))
  context.save()
  context.globalAlpha *= opacity
  context.fillStyle = style.color
  context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  context.textBaseline = 'middle'
  context.fillText(
    value,
    rect.left + cssNumber(style.paddingLeft, 4),
    rect.top + rect.height / 2,
    Math.max(0, rect.width - cssNumber(style.paddingLeft) - cssNumber(style.paddingRight)),
  )
  context.restore()
}

async function paintReplacedElement(
  element: Element,
  style: CSSStyleDeclaration,
  rect: CaptureRect,
  opacity: number,
  paint: DomPaintContext,
): Promise<boolean> {
  let image: CanvasImageSource | null = null
  let width = 0
  let height = 0
  if (element instanceof HTMLImageElement) {
    const loaded = await loadImage(element.currentSrc || element.src, paint)
    image = loaded
    width = loaded.naturalWidth || loaded.width
    height = loaded.naturalHeight || loaded.height
  } else if (element instanceof HTMLCanvasElement) {
    const frozen = paint.canvasSnapshots.get(element) ?? element
    image = frozen
    width = frozen.width
    height = frozen.height
  } else if (element instanceof HTMLVideoElement) {
    if (element.readyState < 2 || element.videoWidth <= 0 || element.videoHeight <= 0) {
      return false
    }
    image = element
    width = element.videoWidth
    height = element.videoHeight
  } else if (element instanceof SVGSVGElement) {
    const clone = element.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const source = `data:image/svg+xml;base64,${bytesToBase64(
      new TextEncoder().encode(new XMLSerializer().serializeToString(clone)),
    )}`
    const loaded = await loadImage(source, paint)
    image = loaded
    width = loaded.naturalWidth || rect.width
    height = loaded.naturalHeight || rect.height
  }
  if (!image) return false
  const radius = maximumBorderRadius(style)
  paint.context.save()
  paint.context.globalAlpha *= opacity
  roundedRectangle(paint.context, rect, radius)
  paint.context.clip()
  drawContainedImage(paint.context, image, width, height, rect, style.objectFit || 'fill')
  paint.context.restore()
  return true
}

async function paintNode(
  node: Node,
  inheritedOpacity: number,
  paint: DomPaintContext,
): Promise<void> {
  if (node instanceof Text) {
    paintText(node, inheritedOpacity, paint)
    return
  }
  if (!(node instanceof Element)) return
  if (node instanceof HTMLStyleElement || node instanceof HTMLScriptElement) return
  const style = computedStyle(node)
  if (
    style.display === 'none'
    || style.visibility === 'hidden'
    || style.visibility === 'collapse'
    || style.contentVisibility === 'hidden'
  ) return
  const opacity = inheritedOpacity * boundedOpacity(style.opacity)
  if (opacity <= 0.001) return
  const rect = localRect(node.getBoundingClientRect(), paint.origin)
  if (rect.width > 0 && rect.height > 0) {
    await paintElementBox(style, rect, opacity, paint)
    if (await paintReplacedElement(node, style, rect, opacity, paint)) return
    if (
      node instanceof HTMLInputElement
      || node instanceof HTMLTextAreaElement
      || node instanceof HTMLSelectElement
    ) {
      paintControlValue(node, style, rect, opacity, paint)
      return
    }
  }
  const clipsChildren = style.overflow === 'hidden'
    || style.overflowX === 'hidden'
    || style.overflowY === 'hidden'
    || style.overflow === 'clip'
  const clipApplied = clipsChildren && rect.width > 0 && rect.height > 0
  if (clipApplied) {
    paint.context.save()
    paint.context.beginPath()
    paint.context.rect(rect.left, rect.top, rect.width, rect.height)
    paint.context.clip()
  }
  try {
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true })
      const children = assigned.length > 0 ? assigned : [...node.childNodes]
      for (const child of children) await paintNode(child, opacity, paint)
      return
    }
    const children = node.shadowRoot?.childNodes ?? node.childNodes
    for (const child of children) await paintNode(child, opacity, paint)
  } finally {
    if (clipApplied) paint.context.restore()
  }
}

async function captureElementContent(
  element: HTMLElement,
  width: number,
  height: number,
  canvasSnapshots: PublishedCanvasSnapshots,
  deadline: PublishedCaptureDeadline,
): Promise<HTMLCanvasElement> {
  const canvas = element.ownerDocument.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建 Published 静态捕获画布')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  const previous = {
    transform: element.style.transform,
    opacity: element.style.opacity,
    visibility: element.style.visibility,
  }
  element.style.transform = 'none'
  element.style.opacity = '1'
  element.style.visibility = 'visible'
  try {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Published 静态捕获目标没有可见布局尺寸')
    }
    context.save()
    context.scale(width / rect.width, height / rect.height)
    await paintNode(element, 1, {
      context,
      origin: { left: rect.left, top: rect.top },
      imageCache: new Map(),
      canvasSnapshots,
      deadline,
    })
    context.restore()
  } finally {
    element.style.transform = previous.transform
    element.style.opacity = previous.opacity
    element.style.visibility = previous.visibility
  }
  return canvas
}

export interface PublishedSurfaceCaptureLayer {
  readonly element: HTMLElement
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation: number
  readonly opacity: number
}

/** Backward-compatible name retained for Slide callers. */
export type PublishedSlideCaptureLayer = PublishedSurfaceCaptureLayer

export interface CapturePublishedSurfaceOptions {
  readonly root: HTMLElement
  readonly width: number
  readonly height: number
  readonly layers: readonly PublishedSurfaceCaptureLayer[]
  /** Item capture stays transparent and omits the authored page background. */
  readonly transparentBackground?: boolean
  readonly timeoutMs?: number
}

/** Backward-compatible name retained for Slide callers. */
export type CapturePublishedSlideOptions = CapturePublishedSurfaceOptions

function exposeCaptureRootForLayout(root: HTMLElement): () => void {
  const visibility = computedStyle(root).visibility
  if (!root.hidden && visibility === 'visible') return () => undefined

  const previous = {
    hidden: root.hidden,
    left: root.style.left,
    top: root.style.top,
    visibility: root.style.visibility,
    pointerEvents: root.style.pointerEvents,
    ariaHidden: root.getAttribute('aria-hidden'),
  }
  // An inactive Mixed surface is kept mounted under visibility:hidden and its
  // Slide root also carries the hidden attribute. Give it real layout while
  // keeping it far outside the viewport and inert, so capture never has to
  // activate the surface or execute its deferred Runtime generation.
  root.hidden = false
  root.style.left = '-100000px'
  root.style.top = '0'
  root.style.visibility = 'visible'
  root.style.pointerEvents = 'none'
  root.setAttribute('aria-hidden', 'true')

  return () => {
    root.hidden = previous.hidden
    root.style.left = previous.left
    root.style.top = previous.top
    root.style.visibility = previous.visibility
    root.style.pointerEvents = previous.pointerEvents
    if (previous.ariaHidden === null) root.removeAttribute('aria-hidden')
    else root.setAttribute('aria-hidden', previous.ariaHidden)
  }
}

/**
 * Produces an ordinary origin-clean PNG from actual Published DOM/canvas roots.
 * Top-level authored transforms are applied once here so item capture can be
 * embedded by PPTX without double rotation or opacity.
 */
export async function capturePublishedSurfacePng(
  options: CapturePublishedSurfaceOptions,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS
  const deadline = new PublishedCaptureDeadline(timeoutMs)
  const restoreCaptureRoot = exposeCaptureRootForLayout(options.root)
  try {
    const prepared = await prepareResources(
      options.layers.map((layer) => layer.element),
      deadline,
    )
    try {
      const fontsReady = options.root.ownerDocument.fonts?.ready
      if (fontsReady) {
        await deadline.waitFor(
          Promise.resolve(fontsReady).then(() => undefined),
          'Published 静态捕获等待字体就绪超时',
        )
      }
      const canvas = options.root.ownerDocument.createElement('canvas')
      canvas.width = Math.max(1, Math.round(options.width))
      canvas.height = Math.max(1, Math.round(options.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建 Published 页面合成画布')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      if (!options.transparentBackground) {
        const style = computedStyle(options.root)
        context.fillStyle = isTransparent(style.backgroundColor)
          ? '#ffffff'
          : style.backgroundColor
        context.fillRect(0, 0, canvas.width, canvas.height)
        await paintBackgroundImage(style, {
          left: 0,
          top: 0,
          width: canvas.width,
          height: canvas.height,
          right: canvas.width,
          bottom: canvas.height,
        }, {
          context,
          origin: { left: 0, top: 0 },
          imageCache: new Map(),
          canvasSnapshots: prepared.canvasSnapshots,
          deadline,
        })
      }

      for (const layer of options.layers) {
        const content = await captureElementContent(
          layer.element,
          layer.width,
          layer.height,
          prepared.canvasSnapshots,
          deadline,
        )
        context.save()
        context.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
        context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2)
        context.rotate(layer.rotation * Math.PI / 180)
        context.drawImage(
          content,
          -layer.width / 2,
          -layer.height / 2,
          layer.width,
          layer.height,
        )
        context.restore()
      }
      deadline.assertAvailable('Published 静态捕获超过统一截止时间')
      try {
        return canvas.toDataURL('image/png')
      } catch (cause) {
        throw new Error(`Published 静态捕获不是 origin-clean：${captureError(cause).message}`, {
          cause,
        })
      }
    } finally {
      for (const { resource } of prepared.entries.reverse()) {
        try {
          resource.restoreAfterCapture?.()
        } catch {
          // Capture result/failure remains authoritative; restoration is best effort.
        }
      }
    }
  } finally {
    restoreCaptureRoot()
  }
}

/** Slide compatibility wrapper over the generic Published Surface compositor. */
export function capturePublishedSlidePng(
  options: CapturePublishedSlideOptions,
): Promise<string> {
  return capturePublishedSurfacePng(options)
}
