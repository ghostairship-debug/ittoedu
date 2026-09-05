import type { LayerFrame } from '../../../shared/contracts/course-project-v9/types'
import type {
  PublishedCourseV2Payload,
  PublishedFlowSurface,
  PublishedFlowSurfaceLayerEntry,
  PublishedGlobalLayerEntry,
  PublishedLayerItem,
  PublishedNativeLayerItem,
} from '../../../shared/contracts/published-course-v2/types'
import { compareStableStrings } from '../../../shared/stableOrder'
import { resolveEffectiveBackground } from '../../../shared/effectiveBackground'
import {
  buildFlowPrintPlan,
  type FlowPrintNode,
  type FlowPrintOrientation,
  type FlowPrintPageSize,
} from './flowPrintPlan'

export type FlowDocxDisposition =
  | 'preserved'
  | 'editable-shape'
  | 'image'
  | 'static-fallback'
  | 'placeholder'
  | 'excluded'
  | 'rejected'
  | 'approximation'

export interface FlowDocxLayerReportItem {
  surfaceId: string
  layerItemId: string
  scope: 'surface' | 'global'
  locationId: string | null
  fieldPath: string
  disposition: FlowDocxDisposition
  reasonCode: string
  message: string
  sourceFrame: LayerFrame
  outputFrame?: LayerFrame
}

export type FlowDocxCarrierKind =
  | 'textbox'
  | 'shape'
  | 'image'
  | 'formula'
  | 'placeholder'

export interface FlowDocxProjectedItem {
  layerItemId: string
  scope: 'surface' | 'global'
  disposition: FlowDocxDisposition
  carrierKind: FlowDocxCarrierKind
  sourceFrame: LayerFrame
  outputFrame: LayerFrame
  rotation: number
  opacity: number
  relativeHeight: number
  behindDoc: boolean
  item: PublishedLayerItem
  anchorBlockId: string
  placeholderText?: string
  assetId?: string
}

export interface FlowDocxProjectedAnchorGroup {
  blockId: string
  items: FlowDocxProjectedItem[]
}

export interface FlowDocxPageBox {
  widthTwips: number
  heightTwips: number
  marginTwips: number
  maxContentWidthPx: number
  maxContentHeightPx: number
}

export interface BuildFlowDocxProjectionOptions {
  pageSize?: FlowPrintPageSize
  orientation?: FlowPrintOrientation
  blockTops?: Record<string, number>
}

export interface FlowDocxProjection {
  surface: PublishedFlowSurface
  title: string
  backgroundColor?: string
  backgroundAssetId?: string | null
  pageSize: FlowPrintPageSize
  orientation: FlowPrintOrientation
  pageBox: FlowDocxPageBox
  nodes: readonly FlowPrintNode[]
  anchoredGroups: FlowDocxProjectedAnchorGroup[]
  documentStartItems: FlowDocxProjectedItem[]
  footerItems: FlowDocxProjectedItem[]
  layerReport: FlowDocxLayerReportItem[]
  warnings: string[]
}

export function resolveFlowDocxPageBox(
  pageSize: FlowPrintPageSize = 'A4',
  orientation: FlowPrintOrientation = 'portrait',
): FlowDocxPageBox {
  let widthTwips = 11_906
  let heightTwips = 16_838
  if (pageSize === 'letter') {
    widthTwips = 12_240
    heightTwips = 15_840
  }
  if (orientation === 'landscape') {
    const temp = widthTwips
    widthTwips = heightTwips
    heightTwips = temp
  }
  const marginTwips = 1134 // standard 20mm margins
  const maxContentWidthPx = Math.floor((widthTwips - marginTwips * 2) / 15)
  const maxContentHeightPx = Math.floor((heightTwips - marginTwips * 2) / 15)
  return {
    widthTwips,
    heightTwips,
    marginTwips,
    maxContentWidthPx,
    maxContentHeightPx,
  }
}

export function clampLayerFrameToPageBox(
  source: LayerFrame,
  box: FlowDocxPageBox,
): { outputFrame: LayerFrame; changed: boolean } {
  const originalW = Math.max(1, source.width)
  const originalH = Math.max(1, source.height)
  let w = originalW
  let h = originalH
  if (w > box.maxContentWidthPx || h > box.maxContentHeightPx) {
    const scale = Math.min(box.maxContentWidthPx / w, box.maxContentHeightPx / h)
    w = Math.max(1, Math.round(w * scale))
    h = Math.max(1, Math.round(h * scale))
  }
  const maxAllowedX = Math.max(0, box.maxContentWidthPx - w)
  const maxAllowedY = Math.max(0, box.maxContentHeightPx - h)
  const x = Math.max(0, Math.min(Math.round(source.x), maxAllowedX))
  const y = Math.max(0, Math.min(Math.round(source.y), maxAllowedY))

  const changed = x !== source.x || y !== source.y || w !== source.width || h !== source.height
  const outputFrame: LayerFrame = {
    ...source,
    x,
    y,
    width: w,
    height: h,
  }
  return { outputFrame, changed }
}

export function rotationToDrawingMlDegree(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  let norm = Math.round(deg * 60_000) % 21_600_000
  if (norm < 0) norm += 21_600_000
  return norm
}

export function isTeacherControllerPublishedItem(
  item: PublishedLayerItem,
): item is PublishedNativeLayerItem & {
  content: Extract<PublishedNativeLayerItem['content'], { nativeType: 'teacher-controller' }>
} {
  return item.kind === 'native' && item.content.nativeType === 'teacher-controller'
}

const SUPPORTED_PRESET_SHAPES = new Set([
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'line',
  'arrow-left',
  'arrow-right',
  'arrow-up',
  'arrow-down',
  'arrow-left-right',
  'elbow-arrow',
])

interface StagedItem {
  entry: PublishedFlowSurfaceLayerEntry | PublishedGlobalLayerEntry
  scope: 'surface' | 'global'
  fieldPath: string
  planeRank: number
  locationId: string | null
  disposition: FlowDocxDisposition
  carrierKind: FlowDocxCarrierKind
  reasonCode: string
  message: string
  sourceFrame: LayerFrame
  outputFrame?: LayerFrame
  isFooter: boolean
  isOmitted: boolean
  anchorBlockId: string
  placeholderText?: string
  assetId?: string
}

export function buildFlowDocxProjection(
  payload: PublishedCourseV2Payload,
  targetSurfaceId: string,
  options: BuildFlowDocxProjectionOptions = {},
): FlowDocxProjection {
  const surface = payload.surfaces.find((s) => s.id === targetSurfaceId)
  if (!surface || surface.type !== 'flow') {
    throw new Error(`Target surface "${targetSurfaceId}" is not a Flow surface in PublishedCourseV2Payload.`)
  }

  const surfaceIndex = payload.surfaces.findIndex((s) => s.id === targetSurfaceId)
  const pageSize = options.pageSize ?? 'A4'
  const orientation = options.orientation ?? 'portrait'
  const pageBox = resolveFlowDocxPageBox(pageSize, orientation)
  const warnings: string[] = []
  const layerReport: FlowDocxLayerReportItem[] = []

  const flowLocations = payload.locations.filter(
    (l) => l.surfaceId === targetSurfaceId && l.kind === 'flow-block',
  )
  const firstFlowLocationId = flowLocations[0]?.id ?? null
  const firstBlockId = surface.blocks[0]?.id ?? '__anchor_start__'

  const stagedItems: StagedItem[] = []

  // 1. Process Surface Layer Items
  surface.surfaceLayerItems.forEach((entry, index) => {
    const item = entry.item
    const fieldPath = `surfaces[${surfaceIndex}].surfaceLayerItems[${index}].item`
    const sourceFrame = item.frame

    // Native input, table, and chart are illegal in Flow
    if (
      item.kind === 'native' &&
      (item.content.nativeType === 'input' ||
        item.content.nativeType === 'table' ||
        item.content.nativeType === 'chart')
    ) {
      layerReport.push({
        surfaceId: targetSurfaceId,
        layerItemId: item.layerItemId,
        scope: 'surface',
        locationId: null,
        fieldPath,
        disposition: 'rejected',
        reasonCode: 'illegal-flow-native-kind',
        message: `Flow 浮层不支持 Native ${item.content.nativeType}，该内容在 Flow 非法。`,
        sourceFrame,
      })
      return
    }

    // Teacher controller check
    if (isTeacherControllerPublishedItem(item)) {
      if (item.content.data.includeInStaticExports !== true) {
        layerReport.push({
          surfaceId: targetSurfaceId,
          layerItemId: item.layerItemId,
          scope: 'surface',
          locationId: null,
          fieldPath,
          disposition: 'excluded',
          reasonCode: 'teacher-controller-static-export-disabled',
          message: '教师控制器未启用静态导出，已排除。',
          sourceFrame,
        })
        return
      }
    }

    // Visibility and location matching
    if (!item.visible) {
      layerReport.push({
        surfaceId: targetSurfaceId,
        layerItemId: item.layerItemId,
        scope: 'surface',
        locationId: null,
        fieldPath,
        disposition: 'excluded',
        reasonCode: 'layer-hidden',
        message: '浮层已隐藏，未导出。',
        sourceFrame,
      })
      return
    }

    let matchedLocationId: string | null = null
    if (entry.visibility.mode === 'include') {
      const match = flowLocations.find((l) => entry.visibility.locationIds.includes(l.id))
      if (!match) {
        layerReport.push({
          surfaceId: targetSurfaceId,
          layerItemId: item.layerItemId,
          scope: 'surface',
          locationId: null,
          fieldPath,
          disposition: 'excluded',
          reasonCode: 'location-not-applicable',
          message: '浮层在此流式讲义的位置上不可见，已排除。',
          sourceFrame,
        })
        return
      }
      matchedLocationId = match.id
    } else if (entry.visibility.mode === 'exclude') {
      if (flowLocations.length > 0 && flowLocations.every((l) => entry.visibility.locationIds.includes(l.id))) {
        layerReport.push({
          surfaceId: targetSurfaceId,
          layerItemId: item.layerItemId,
          scope: 'surface',
          locationId: null,
          fieldPath,
          disposition: 'excluded',
          reasonCode: 'location-not-applicable',
          message: '浮层在此流式讲义的所有位置上均被排除。',
          sourceFrame,
        })
        return
      }
      matchedLocationId = flowLocations.find((l) => !entry.visibility.locationIds.includes(l.id))?.id ?? firstFlowLocationId
    } else {
      matchedLocationId = firstFlowLocationId
    }

    // Determine Anchor Block ID
    let anchorBlockId = firstBlockId
    let reasonCode = 'anchored-drawingml'
    let message = '浮层已作为 DrawingML 对象锚定到文档中。'

    if (item.paperSpace === 'paper') {
      if (options.blockTops && Object.keys(options.blockTops).length > 0) {
        let bestBlockId = firstBlockId
        let bestTop = -Infinity
        for (const block of surface.blocks) {
          const top = options.blockTops[block.id]
          if (top !== undefined && top <= sourceFrame.y && top > bestTop) {
            bestTop = top
            bestBlockId = block.id
          }
        }
        anchorBlockId = bestBlockId
        reasonCode = 'paper-space-anchored'
        message = `已按 paperSpace 坐标锚定到最近段落块 ${anchorBlockId}。`
      } else {
        anchorBlockId = firstBlockId
        const warning = `浮层“${item.layerItemId}”使用 paperSpace: paper，但未提供 Flow 布局块位置，已回退到文档首段。`
        warnings.push(warning)
        reasonCode = 'paper-space-fallback-to-start'
        message = warning
      }
    } else {
      anchorBlockId = firstBlockId
      reasonCode = 'viewport-to-document-start'
      message = '视口定位浮层已转换为文档首段锚点。'
    }

    const { outputFrame } = clampLayerFrameToPageBox(sourceFrame, pageBox)

    // Determine carrier & disposition
    let disposition: FlowDocxDisposition = 'preserved'
    let carrierKind: FlowDocxCarrierKind = 'textbox'
    let placeholderText: string | undefined
    let assetId: string | undefined

    if (item.kind === 'native') {
      if (item.content.nativeType === 'text') {
        disposition = 'editable-shape'
        carrierKind = 'textbox'
        if (reasonCode === 'anchored-drawingml') {
          reasonCode = 'anchored-drawingml-textbox'
          message = 'Native 文本浮层已转换为 DrawingML 文本框。'
        }
      } else if (item.content.nativeType === 'shape') {
        const shapeType = item.content.data.shapeType
        if (SUPPORTED_PRESET_SHAPES.has(shapeType)) {
          disposition = 'editable-shape'
          carrierKind = 'shape'
          if (shapeType === 'line' || shapeType === 'elbow-arrow') {
            reasonCode = 'anchored-drawingml-connector'
            message = 'Native 线条/折线已转换为 DrawingML 连接符。'
          } else {
            reasonCode = 'anchored-drawingml-shape'
            message = 'Native 几何图形已转换为 DrawingML 预设图形。'
          }
        } else {
          disposition = 'static-fallback'
          carrierKind = 'shape'
          reasonCode = 'shape-static-fallback'
          message = 'Native 图形未匹配到原生预设，已生成静态后备。'
        }
      } else if (item.content.nativeType === 'image') {
        disposition = 'image'
        carrierKind = 'image'
        reasonCode = 'anchored-drawingml-picture'
        message = 'Native 图片浮层已转换为 DrawingML 嵌入图片。'
        assetId = item.content.data.assetId
      } else if (item.content.nativeType === 'formula') {
        disposition = 'preserved'
        carrierKind = 'formula'
        reasonCode = 'preserved-native-formula'
        message = 'Native 公式已保留为 DrawingML/OMML 表达式。'
      } else if (item.content.nativeType === 'video') {
        if (item.content.data.poster.mode === 'image' && item.content.data.poster.assetId) {
          disposition = 'static-fallback'
          carrierKind = 'image'
          reasonCode = 'video-poster-fallback'
          message = '视频浮层已使用封面素材作为静态后备图片。'
          assetId = item.content.data.poster.assetId
        } else {
          disposition = 'placeholder'
          carrierKind = 'placeholder'
          reasonCode = 'video-placeholder'
          message = '视频浮层缺少封面素材，已生成可见占位文本框。'
          placeholderText = `[视频：${item.layerItemId}]`
        }
      } else if (item.content.nativeType === 'teacher-controller') {
        disposition = 'editable-shape'
        carrierKind = 'textbox'
        reasonCode = 'teacher-controller-body'
        message = '教师控制器已作为 DrawingML 文本框锚定到文档中。'
      }
    } else if (item.kind === 'component') {
      if (item.staticFallbackAssetId) {
        disposition = 'static-fallback'
        carrierKind = 'image'
        reasonCode = 'dynamic-static-fallback'
        message = '组件已使用静态后备素材呈现。'
        assetId = item.staticFallbackAssetId
      } else {
        disposition = 'placeholder'
        carrierKind = 'placeholder'
        reasonCode = 'dynamic-placeholder'
        message = '组件缺少静态后备素材，已生成可见身份占位文本框。'
        placeholderText = `[组件：${item.component.packageId}@${item.component.version}]`
      }
    } else if (item.kind === 'runtime') {
      if (item.runtime.staticFallback?.assetId) {
        disposition = 'static-fallback'
        carrierKind = 'image'
        reasonCode = 'dynamic-static-fallback'
        message = '运行时已使用静态后备素材呈现。'
        assetId = item.runtime.staticFallback.assetId
      } else {
        disposition = 'placeholder'
        carrierKind = 'placeholder'
        reasonCode = 'dynamic-placeholder'
        message = '运行时缺少静态后备素材，已生成可见身份占位文本框。'
        placeholderText = `[运行时：${item.runtime.protocol} v${item.runtime.runtimeApiVersion}]`
      }
    }

    const planeRank = entry.bodyPlane === 'underlay' ? 1 : 2

    stagedItems.push({
      entry,
      scope: 'surface',
      fieldPath,
      planeRank,
      locationId: matchedLocationId,
      disposition,
      carrierKind,
      reasonCode,
      message,
      sourceFrame,
      outputFrame,
      isFooter: false,
      isOmitted: false,
      anchorBlockId,
      placeholderText,
      assetId,
    })
  })

  // 2. Process Global Layer Items
  payload.globalLayerItems.forEach((entry, index) => {
    const item = entry.item
    const fieldPath = `globalLayerItems[${index}].item`
    const sourceFrame = item.frame

    // Native input, table, chart are illegal in Flow
    if (
      item.kind === 'native' &&
      (item.content.nativeType === 'input' ||
        item.content.nativeType === 'table' ||
        item.content.nativeType === 'chart')
    ) {
      layerReport.push({
        surfaceId: targetSurfaceId,
        layerItemId: item.layerItemId,
        scope: 'global',
        locationId: null,
        fieldPath,
        disposition: 'rejected',
        reasonCode: 'illegal-flow-native-kind',
        message: `Flow 不支持全局 Native ${item.content.nativeType}，该内容在 Flow 非法。`,
        sourceFrame,
      })
      return
    }

    // Global teacher controller
    if (isTeacherControllerPublishedItem(item)) {
      if (item.content.data.includeInStaticExports !== true) {
        layerReport.push({
          surfaceId: targetSurfaceId,
          layerItemId: item.layerItemId,
          scope: 'global',
          locationId: null,
          fieldPath,
          disposition: 'excluded',
          reasonCode: 'teacher-controller-static-export-disabled',
          message: '教师控制器未启用静态导出，已排除。',
          sourceFrame,
        })
        return
      }

      // Unique repeat exception: global teacher-controller with visibility.mode='all' and includeInStaticExports=true
      if (entry.visibility.mode === 'all') {
        const { outputFrame } = clampLayerFrameToPageBox(sourceFrame, pageBox)
        stagedItems.push({
          entry,
          scope: 'global',
          fieldPath,
          planeRank: 3,
          locationId: null,
          disposition: 'editable-shape',
          carrierKind: 'textbox',
          reasonCode: 'global-teacher-controller-footer',
          message: '全局教师控制器已放入页脚跨页呈现。',
          sourceFrame,
          outputFrame,
          isFooter: true,
          isOmitted: false,
          anchorBlockId: '__footer__',
        })
        return
      }
    }

    // Visibility check
    if (!item.visible) {
      layerReport.push({
        surfaceId: targetSurfaceId,
        layerItemId: item.layerItemId,
        scope: 'global',
        locationId: null,
        fieldPath,
        disposition: 'excluded',
        reasonCode: 'layer-hidden',
        message: '全局图层已隐藏，未导出。',
        sourceFrame,
      })
      return
    }

    let matchedLocationId: string | null = null
    if (entry.visibility.mode === 'include') {
      const match = flowLocations.find((l) => entry.visibility.locationIds.includes(l.id))
      if (!match) {
        layerReport.push({
          surfaceId: targetSurfaceId,
          layerItemId: item.layerItemId,
          scope: 'global',
          locationId: null,
          fieldPath,
          disposition: 'excluded',
          reasonCode: 'location-not-applicable',
          message: '全局图层未在此流式讲义的位置上启用，已排除。',
          sourceFrame,
        })
        return
      }
      matchedLocationId = match.id
    } else if (entry.visibility.mode === 'exclude') {
      if (flowLocations.length > 0 && flowLocations.every((l) => entry.visibility.locationIds.includes(l.id))) {
        layerReport.push({
          surfaceId: targetSurfaceId,
          layerItemId: item.layerItemId,
          scope: 'global',
          locationId: null,
          fieldPath,
          disposition: 'excluded',
          reasonCode: 'location-not-applicable',
          message: '全局图层在此流式讲义的所有位置上均被排除。',
          sourceFrame,
        })
        return
      }
      matchedLocationId = flowLocations.find((l) => !entry.visibility.locationIds.includes(l.id))?.id ?? firstFlowLocationId
    } else {
      matchedLocationId = firstFlowLocationId
    }

    // Ordinary global items drop exactly once into document start
    const { outputFrame } = clampLayerFrameToPageBox(sourceFrame, pageBox)
    const anchorBlockId = firstBlockId

    let disposition: FlowDocxDisposition = 'preserved'
    let carrierKind: FlowDocxCarrierKind = 'textbox'
    let reasonCode = 'global-layer-anchored'
    let message = '普通全局图层已锚定到文档首段（仅呈现一次）。'
    let placeholderText: string | undefined
    let assetId: string | undefined

    if (item.kind === 'native') {
      if (item.content.nativeType === 'text') {
        disposition = 'editable-shape'
        carrierKind = 'textbox'
        reasonCode = 'anchored-drawingml-textbox'
        message = '全局文本图层已转换为文档首段 DrawingML 文本框。'
      } else if (item.content.nativeType === 'shape') {
        const shapeType = item.content.data.shapeType
        if (SUPPORTED_PRESET_SHAPES.has(shapeType)) {
          disposition = 'editable-shape'
          carrierKind = 'shape'
          reasonCode = shapeType === 'line' || shapeType === 'elbow-arrow' ? 'anchored-drawingml-connector' : 'anchored-drawingml-shape'
          message = '全局几何图形已转换为文档首段 DrawingML 图形。'
        } else {
          disposition = 'static-fallback'
          carrierKind = 'shape'
          reasonCode = 'shape-static-fallback'
          message = '全局图形未匹配到原生预设，已生成静态后备。'
        }
      } else if (item.content.nativeType === 'image') {
        disposition = 'image'
        carrierKind = 'image'
        reasonCode = 'anchored-drawingml-picture'
        message = '全局图片已转换为文档首段 DrawingML 嵌入图片。'
        assetId = item.content.data.assetId
      } else if (item.content.nativeType === 'formula') {
        disposition = 'preserved'
        carrierKind = 'formula'
        reasonCode = 'preserved-native-formula'
        message = '全局公式已保留为 DrawingML/OMML 表达式。'
      } else if (item.content.nativeType === 'video') {
        if (item.content.data.poster.mode === 'image' && item.content.data.poster.assetId) {
          disposition = 'static-fallback'
          carrierKind = 'image'
          reasonCode = 'video-poster-fallback'
          message = '全局视频已使用封面素材作为静态后备图片。'
          assetId = item.content.data.poster.assetId
        } else {
          disposition = 'placeholder'
          carrierKind = 'placeholder'
          reasonCode = 'video-placeholder'
          message = '全局视频缺少封面素材，已生成可见占位文本框。'
          placeholderText = `[视频：${item.layerItemId}]`
        }
      } else if (item.content.nativeType === 'teacher-controller') {
        disposition = 'editable-shape'
        carrierKind = 'textbox'
        reasonCode = 'teacher-controller-body'
        message = '全局教师控制器已作为 DrawingML 文本框锚定到文档首段。'
      }
    } else if (item.kind === 'component') {
      if (item.staticFallbackAssetId) {
        disposition = 'static-fallback'
        carrierKind = 'image'
        reasonCode = 'dynamic-static-fallback'
        message = '全局组件已使用静态后备素材呈现。'
        assetId = item.staticFallbackAssetId
      } else {
        disposition = 'placeholder'
        carrierKind = 'placeholder'
        reasonCode = 'dynamic-placeholder'
        message = '全局组件缺少静态后备素材，已生成可见身份占位文本框。'
        placeholderText = `[组件：${item.component.packageId}@${item.component.version}]`
      }
    } else if (item.kind === 'runtime') {
      if (item.runtime.staticFallback?.assetId) {
        disposition = 'static-fallback'
        carrierKind = 'image'
        reasonCode = 'dynamic-static-fallback'
        message = '全局运行时已使用静态后备素材呈现。'
        assetId = item.runtime.staticFallback.assetId
      } else {
        disposition = 'placeholder'
        carrierKind = 'placeholder'
        reasonCode = 'dynamic-placeholder'
        message = '全局运行时缺少静态后备素材，已生成可见身份占位文本框。'
        placeholderText = `[运行时：${item.runtime.protocol} v${item.runtime.runtimeApiVersion}]`
      }
    }

    const planeRank = entry.plane === 'underlay' ? 0 : 3

    stagedItems.push({
      entry,
      scope: 'global',
      fieldPath,
      planeRank,
      locationId: matchedLocationId,
      disposition,
      carrierKind,
      reasonCode,
      message,
      sourceFrame,
      outputFrame,
      isFooter: false,
      isOmitted: false,
      anchorBlockId,
      placeholderText,
      assetId,
    })
  })

  // 3. Sort Staged Items by plane, order, layerItemId
  stagedItems.sort((a, b) => {
    if (a.planeRank !== b.planeRank) return a.planeRank - b.planeRank
    const orderA = a.entry.item.order
    const orderB = b.entry.item.order
    if (orderA !== orderB) return orderA - orderB
    return compareStableStrings(a.entry.item.layerItemId, b.entry.item.layerItemId)
  })

  // 4. Assign relativeHeight and behindDoc
  // underlay: behindDoc=true, relativeHeight increments from 1
  // surface overlay: behindDoc=false, relativeHeight increments from 1
  // global overlay: behindDoc=false, relativeHeight increments from 100000
  let nextUnderlayHeight = 1
  let nextSurfaceOverlayHeight = 1
  let nextGlobalOverlayHeight = 100_001

  const documentStartItems: FlowDocxProjectedItem[] = []
  const footerItems: FlowDocxProjectedItem[] = []
  const blockAnchorMap = new Map<string, FlowDocxProjectedItem[]>()

  for (const staged of stagedItems) {
    let behindDoc = false
    let relativeHeight = 1

    if (staged.planeRank <= 1) {
      behindDoc = true
      relativeHeight = nextUnderlayHeight++
    } else if (staged.planeRank === 2) {
      behindDoc = false
      relativeHeight = nextSurfaceOverlayHeight++
    } else {
      behindDoc = false
      relativeHeight = nextGlobalOverlayHeight++
    }

    const projectedItem: FlowDocxProjectedItem = {
      layerItemId: staged.entry.item.layerItemId,
      scope: staged.scope,
      disposition: staged.disposition,
      carrierKind: staged.carrierKind,
      sourceFrame: staged.sourceFrame,
      outputFrame: staged.outputFrame ?? staged.sourceFrame,
      rotation: staged.entry.item.rotation,
      opacity: staged.entry.item.opacity,
      relativeHeight,
      behindDoc,
      item: staged.entry.item,
      anchorBlockId: staged.anchorBlockId,
      ...(staged.placeholderText ? { placeholderText: staged.placeholderText } : {}),
      ...(staged.assetId ? { assetId: staged.assetId } : {}),
    }

    layerReport.push({
      surfaceId: targetSurfaceId,
      layerItemId: staged.entry.item.layerItemId,
      scope: staged.scope,
      locationId: staged.locationId,
      fieldPath: staged.fieldPath,
      disposition: staged.disposition,
      reasonCode: staged.reasonCode,
      message: staged.message,
      sourceFrame: staged.sourceFrame,
      outputFrame: staged.outputFrame,
    })

    if (staged.isFooter) {
      footerItems.push(projectedItem)
    } else if (staged.anchorBlockId === firstBlockId || staged.anchorBlockId === '__anchor_start__') {
      documentStartItems.push(projectedItem)
    } else {
      const existing = blockAnchorMap.get(staged.anchorBlockId) ?? []
      existing.push(projectedItem)
      blockAnchorMap.set(staged.anchorBlockId, existing)
    }
  }

  const anchoredGroups: FlowDocxProjectedAnchorGroup[] = Array.from(blockAnchorMap.entries()).map(
    ([blockId, items]) => ({ blockId, items }),
  )

  // 5. Build FlowPrintPlan for body nodes
  const printPlan = buildFlowPrintPlan(surface, {
    pageSize,
    orientation,
  })

  // Background resolution
  const effectiveBg = resolveEffectiveBackground({
    owner: 'flow-surface',
    course: payload,
    surface,
  })
  const backgroundColor = effectiveBg.color
  const backgroundAssetId = effectiveBg.assetId
  if (backgroundColor && backgroundColor.toLowerCase() !== '#ffffff') {
    layerReport.push({
      surfaceId: targetSurfaceId,
      layerItemId: `${targetSurfaceId}-background`,
      scope: 'surface',
      locationId: null,
      fieldPath: `surfaces[${surfaceIndex}].backgroundColor`,
      disposition: 'preserved',
      reasonCode: 'surface-background-color',
      message: `Flow 背景颜色 ${backgroundColor} 已保留为文档背景色。`,
      sourceFrame: { mode: 'absolute', x: 0, y: 0, width: pageBox.maxContentWidthPx, height: pageBox.maxContentHeightPx },
      outputFrame: { mode: 'absolute', x: 0, y: 0, width: pageBox.maxContentWidthPx, height: pageBox.maxContentHeightPx },
    })
  }
  if (backgroundAssetId) {
    layerReport.push({
      surfaceId: targetSurfaceId,
      layerItemId: `${targetSurfaceId}-background-image`,
      scope: 'surface',
      locationId: null,
      fieldPath: `surfaces[${surfaceIndex}].backgroundAssetId`,
      disposition: 'preserved',
      reasonCode: 'surface-background-image',
      message: `Flow 背景图片 ${backgroundAssetId} 已保留为页眉全页背景。`,
      sourceFrame: { mode: 'absolute', x: 0, y: 0, width: pageBox.maxContentWidthPx, height: pageBox.maxContentHeightPx },
      outputFrame: { mode: 'absolute', x: 0, y: 0, width: pageBox.maxContentWidthPx, height: pageBox.maxContentHeightPx },
    })
  }

  return {
    surface,
    title: surface.title,
    backgroundColor,
    backgroundAssetId,
    pageSize,
    orientation,
    pageBox,
    nodes: printPlan.nodes,
    anchoredGroups,
    documentStartItems,
    footerItems,
    layerReport,
    warnings,
  }
}
