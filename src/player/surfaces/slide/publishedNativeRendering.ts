import type {
  NativeElementContent,
  NativeLayerItem,
} from '../../../shared/contracts/course-project-v9/types'
import type {
  FormulaNode,
  ImageNode,
  NativeChartContent,
  NativeInputContent,
  NativeTableContent,
  NativeRenderableBase,
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
import { colorWithAlpha } from '../../../shared/colorAlpha'
import { buildNativeTableLayout } from '../../../shared/nativeTableLayout'
import { buildNativeChartView } from '../../../shared/nativeChartView'

type DeepReadonlyNative<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonlyNative<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonlyNative<T[Key]> }
    : T

export type PublishedNativeTableInput = DeepReadonlyNative<
  Omit<NativeRenderableBase, 'type'> & { readonly type: 'table' } & NativeTableContent
>

export type PublishedNativeChartInput = DeepReadonlyNative<
  Omit<NativeRenderableBase, 'type'> & { readonly type: 'chart' } & NativeChartContent
>

export type PublishedNativeInputLayerInput = DeepReadonlyNative<
  Omit<NativeRenderableBase, 'type'> & { readonly type: 'input' } & NativeInputContent
>

export type PublishedNativeRenderInput =
  | ReadonlyNativeRenderInput
  | PublishedNativeTableInput
  | PublishedNativeChartInput
  | PublishedNativeInputLayerInput

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
    case 'table':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'table' as const,
      })
    case 'chart':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'chart' as const,
      })
    case 'input':
      return freezeRenderSnapshot({
        ...structuredClone(item.content.data),
        ...layout,
        type: 'input' as const,
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
    case 'table':
      paintPublishedNativeTable(wrap, input)
      return
    case 'chart':
      paintPublishedNativeChart(wrap, input)
      return
    case 'input':
      paintPublishedNativeInput(wrap, input)
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

export function paintPublishedNativeTable(
  wrap: HTMLElement,
  input: PublishedNativeTableInput,
): void {
  const layout = buildNativeTableLayout(input, { width: input.width, height: input.height })
  wrap.style.overflow = 'hidden'
  wrap.style.boxSizing = 'border-box'

  const table = wrap.ownerDocument.createElement('table')
  table.style.width = '100%'
  table.style.height = '100%'
  table.style.tableLayout = 'fixed'
  table.style.borderCollapse = 'collapse'
  table.style.borderSpacing = '0'
  table.style.boxSizing = 'border-box'
  table.dataset.nativeTableId = input.id

  const colgroup = wrap.ownerDocument.createElement('colgroup')
  for (const col of layout.columns) {
    const colEl = wrap.ownerDocument.createElement('col')
    colEl.style.width = `${col.width}px`
    colgroup.appendChild(colEl)
  }
  table.appendChild(colgroup)

  const tbody = wrap.ownerDocument.createElement('tbody')
  for (const row of layout.rows) {
    const tr = wrap.ownerDocument.createElement('tr')
    tr.style.height = `${row.height}px`
    tr.dataset.rowId = row.id
    for (const cell of row.cells) {
      const cellTag = cell.isHeader ? 'th' : 'td'
      const td = wrap.ownerDocument.createElement(cellTag)
      td.dataset.cellId = cell.id
      td.dataset.colId = cell.columnId
      td.textContent = cell.text
      const s = cell.style
      td.style.boxSizing = 'border-box'
      td.style.padding = `${s.cellPadding}px`
      td.style.fontFamily = s.fontFamily
      td.style.fontSize = `${s.fontSize}px`
      td.style.fontWeight = s.bold ? 'bold' : 'normal'
      td.style.fontStyle = s.italic ? 'italic' : 'normal'
      td.style.textAlign = s.horizontalAlign
      td.style.verticalAlign = s.verticalAlign
      td.style.color = s.textColor
      if (s.fillOpacity > 0) {
        td.style.backgroundColor = colorWithAlpha(s.fillColor, s.fillOpacity)
      }
      if (s.borderWidth > 0) {
        td.style.border = `${s.borderWidth}px ${s.lineStyle} ${colorWithAlpha(s.borderColor, s.borderOpacity)}`
      } else {
        td.style.border = 'none'
      }
      td.style.overflow = 'hidden'
      td.style.textOverflow = 'ellipsis'
      td.style.wordBreak = 'break-word'
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  wrap.appendChild(table)
}

export function paintPublishedNativeChart(
  wrap: HTMLElement,
  input: PublishedNativeChartInput,
): void {
  const chartView = buildNativeChartView(input, { width: input.width, height: input.height })
  wrap.style.overflow = 'hidden'
  wrap.style.boxSizing = 'border-box'

  const svg = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(Math.max(1, Math.round(input.width))))
  svg.setAttribute('height', String(Math.max(1, Math.round(input.height))))
  svg.setAttribute('viewBox', `0 0 ${input.width} ${input.height}`)
  svg.style.display = 'block'
  svg.style.width = '100%'
  svg.style.height = '100%'
  svg.dataset.nativeChartId = input.id

  // Accessibility
  const desc = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'desc')
  desc.textContent = chartView.accessibleDescription
  svg.appendChild(desc)

  // Background
  if (input.style.backgroundColor && input.style.backgroundOpacity > 0) {
    const bg = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', String(input.width))
    bg.setAttribute('height', String(input.height))
    bg.setAttribute('fill', input.style.backgroundColor)
    bg.setAttribute('fill-opacity', String(input.style.backgroundOpacity))
    svg.appendChild(bg)
  }

  // Title
  if (chartView.title) {
    const titleText = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text')
    titleText.setAttribute('x', String(input.width / 2))
    titleText.setAttribute('y', '24')
    titleText.setAttribute('text-anchor', 'middle')
    titleText.setAttribute('font-family', input.style.fontFamily)
    titleText.setAttribute('font-size', String(input.style.fontSize))
    titleText.setAttribute('font-weight', 'bold')
    titleText.setAttribute('fill', input.style.textColor)
    titleText.textContent = chartView.title
    titleText.dataset.chartText = 'title'
    svg.appendChild(titleText)
  }

  // Cartesian chart
  if (chartView.cartesianSeries && (input.chartType === 'bar' || input.chartType === 'line' || input.chartType === 'area')) {
    // Gridlines
    if (input.style.showGridLines && chartView.gridLines) {
      for (const line of chartView.gridLines) {
        const lineEl = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line')
        lineEl.setAttribute('x1', String(chartView.plotArea.x))
        lineEl.setAttribute('y1', String(line.y))
        lineEl.setAttribute('x2', String(chartView.plotArea.x + chartView.plotArea.width))
        lineEl.setAttribute('y2', String(line.y))
        lineEl.setAttribute('stroke', '#e5e7eb')
        lineEl.setAttribute('stroke-width', '1')
        svg.appendChild(lineEl)
      }
    }

    // A nested SVG clips all series to the plot without shared/global clip IDs.
    const plot = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const area = chartView.plotArea
    plot.setAttribute('x', String(area.x))
    plot.setAttribute('y', String(area.y))
    plot.setAttribute('width', String(area.width))
    plot.setAttribute('height', String(area.height))
    plot.setAttribute('viewBox', `${area.x} ${area.y} ${area.width} ${area.height}`)
    plot.style.overflow = 'hidden'
    svg.appendChild(plot)

    if (input.style.showValueAxis) {
      for (const tick of chartView.gridLines ?? []) {
        const label = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('x', String(area.x - 8))
        label.setAttribute('y', String(tick.y + 4))
        label.setAttribute('text-anchor', 'end')
        label.setAttribute('font-size', '12')
        label.setAttribute('font-family', input.style.fontFamily)
        label.setAttribute('fill', input.style.textColor)
        label.dataset.chartValueTick = 'true'
        label.textContent = String(tick.value)
        svg.appendChild(label)
      }
    }

    // Series
    for (const s of chartView.cartesianSeries) {
      if (s.bars) {
        for (const bar of s.bars) {
          const rect = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect')
          rect.setAttribute('x', String(bar.x))
          rect.setAttribute('y', String(bar.y))
          rect.setAttribute('width', String(bar.width))
          rect.setAttribute('height', String(bar.height))
          rect.setAttribute('fill', bar.color)
          plot.appendChild(rect)
        }
      }
      if (s.areaPathD) {
        const areaEl = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path')
        areaEl.setAttribute('d', s.areaPathD)
        areaEl.setAttribute('fill', s.color)
        areaEl.setAttribute('fill-opacity', '0.25')
        plot.appendChild(areaEl)
      }
      if (s.linePathD) {
        const lineEl = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path')
        lineEl.setAttribute('d', s.linePathD)
        lineEl.setAttribute('stroke', s.color)
        lineEl.setAttribute('stroke-width', '2.5')
        lineEl.setAttribute('fill', 'none')
        plot.appendChild(lineEl)
      }
      for (const pt of s.points) {
        if (input.style.showDataLabels && pt.y >= area.y && pt.y <= area.y + area.height) {
          const label = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text')
          const bar = s.bars?.find((item) => item.categoryId === pt.categoryId)
          label.setAttribute('x', String(bar ? bar.x + bar.width / 2 : pt.x))
          label.setAttribute('y', String(Math.max(area.y + 12, pt.y - 7)))
          label.setAttribute('text-anchor', 'middle')
          label.setAttribute('font-family', input.style.fontFamily)
          label.setAttribute('font-size', '12')
          label.setAttribute('fill', input.style.textColor)
          label.dataset.chartDataLabel = 'true'
          label.textContent = String(pt.value)
          plot.appendChild(label)
        }
        if (input.chartType === 'bar') continue
        const circle = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circle.setAttribute('cx', String(pt.x))
        circle.setAttribute('cy', String(pt.y))
        circle.setAttribute('r', '4')
        circle.setAttribute('fill', s.color)
        circle.setAttribute('stroke', '#ffffff')
        circle.setAttribute('stroke-width', '1.5')
        plot.appendChild(circle)
      }
    }

    // Category labels
    if (input.style.showCategoryAxis && chartView.categories) {
      for (const cat of chartView.categories) {
        const catText = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text')
        catText.setAttribute('x', String(cat.x + cat.width / 2))
        catText.setAttribute('y', String(chartView.plotArea.y + chartView.plotArea.height + 18))
        catText.setAttribute('text-anchor', 'middle')
        catText.setAttribute('font-family', input.style.fontFamily)
        catText.setAttribute('font-size', '12')
        catText.setAttribute('fill', input.style.textColor)
        catText.textContent = cat.label
        catText.dataset.chartCategoryId = cat.id
        svg.appendChild(catText)
      }
    }
  }

  // Circular chart (pie / donut)
  if (chartView.circularSlices) {
    for (const slice of chartView.circularSlices) {
      if (!slice.pathD) continue
      const path = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', slice.pathD)
      path.setAttribute('fill-rule', 'evenodd')
      path.setAttribute('fill', slice.color)
      path.setAttribute('stroke', '#ffffff')
      path.setAttribute('stroke-width', '1.5')
      svg.appendChild(path)
      if (input.style.showDataLabels && slice.value > 0) {
        const label = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('x', String(slice.labelX))
        label.setAttribute('y', String(slice.labelY))
        label.setAttribute('text-anchor', 'middle')
        label.setAttribute('font-family', input.style.fontFamily)
        label.setAttribute('font-size', '12')
        label.setAttribute('fill', input.style.textColor)
        label.dataset.chartDataLabel = 'true'
        label.textContent = `${slice.value} (${slice.percentage}%)`
        svg.appendChild(label)
      }
    }
  }

  // Legend
  if (chartView.legend && chartView.legend.items.length > 0) {
    const legG = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g')
    const position = chartView.legend.position
    const vertical = position === 'left' || position === 'right'
    let currentX = vertical ? (position === 'left' ? 8 : input.width - 84) : chartView.plotArea.x
    let legY = vertical ? chartView.plotArea.y + 12 : position === 'top' ? (input.title ? 42 : 18) : input.height - 14
    legG.dataset.chartLegend = position
    for (const item of chartView.legend.items) {
      const dot = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect')
      dot.setAttribute('x', String(currentX))
      dot.setAttribute('y', String(legY - 9))
      dot.setAttribute('width', '10')
      dot.setAttribute('height', '10')
      dot.setAttribute('rx', '2')
      dot.setAttribute('fill', item.color)
      legG.appendChild(dot)

      const lbl = wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text')
      lbl.setAttribute('x', String(currentX + 14))
      lbl.setAttribute('y', String(legY))
      lbl.setAttribute('font-family', input.style.fontFamily)
      lbl.setAttribute('font-size', '11')
      lbl.setAttribute('fill', input.style.textColor)
      lbl.textContent = item.label
      if (input.chartType === 'pie' || input.chartType === 'donut') lbl.dataset.chartCategoryId = item.id
      else lbl.dataset.chartSeriesId = item.id
      if (vertical && item.label.length > 6) lbl.textContent = `${item.label.slice(0, 5)}…`
      legG.appendChild(lbl)

      if (vertical) legY += 20
      else currentX += item.label.length * 12 + 30
    }
    svg.appendChild(legG)
  }

  wrap.appendChild(svg)
}

export function paintPublishedNativeInput(
  wrap: HTMLElement,
  input: PublishedNativeInputLayerInput,
): void {
  wrap.style.overflow = 'hidden'
  wrap.style.boxSizing = 'border-box'
  const style = input.style

  const inputEl = wrap.ownerDocument.createElement('input')
  inputEl.type = 'text'
  if (input.answerType === 'number') inputEl.inputMode = 'decimal'
  inputEl.placeholder = input.placeholder ?? ''
  inputEl.setAttribute('aria-label', input.placeholder || '填写答案')
  inputEl.dataset.inputNodeId = input.id
  inputEl.style.flex = '1'
  inputEl.style.minWidth = '0'
  inputEl.style.height = '100%'
  inputEl.style.boxSizing = 'border-box'
  inputEl.style.fontFamily = style.fontFamily
  inputEl.style.fontSize = `${style.fontSize}px`
  inputEl.style.color = style.textColor
  inputEl.style.backgroundColor = colorWithAlpha(style.fillColor, style.fillOpacity)
  inputEl.style.border = `${style.borderWidth}px solid ${colorWithAlpha(style.borderColor, style.borderOpacity)}`
  inputEl.style.borderRadius = `${style.cornerRadius}px`
  inputEl.style.textAlign = style.horizontalAlign
  inputEl.style.padding = `${style.padding}px`
  const form = wrap.ownerDocument.createElement('form')
  form.style.cssText = 'display:flex;gap:8px;width:100%;height:100%;margin:0;pointer-events:auto'
  const button = wrap.ownerDocument.createElement('button')
  button.type = 'submit'
  button.textContent = '提交'
  button.style.cssText = 'flex:none;min-width:60px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:white;font:inherit;cursor:pointer'
  form.append(inputEl, button)
  wrap.appendChild(form)
}
