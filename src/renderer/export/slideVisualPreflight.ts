import type { ExportPreflightCode } from '../../shared/diagnosticCodes'
import { analyzeFormulaNodeLayout } from '../../shared/formulaRenderer'
import { rotatedRectangleAabb } from '../../shared/geometry'
import type { CourseProjectHealthSeverity } from '../../shared/courseProjectHealth'
import {
  composeCourseProjectLocation,
  type CourseLayerComposition,
} from '../../shared/courseLayerComposition'
import type {
  TextNode,
  NativeRenderableNode,
} from '../../shared/contracts/native-v1/types'
import type {
  CourseProjectDocument,
  LayerItem,
  NativeLayerItem,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'
import { compareStableStrings } from '../../shared/stableOrder'
import {
  analyzeTextNodeLayout,
  textNodeHasEmphasis,
} from '../../shared/textLayout'
import {
  analyzeVisualDensityState,
  type VisualDensityStateReport,
} from '../../shared/visualDensity'

export type SlideVisualPreflightTarget =
  | 'single-html'
  | 'web-package'
  | 'pdf'
  | 'pptx'

export interface SlideVisualPreflightItem {
  severity: CourseProjectHealthSeverity
  code: ExportPreflightCode
  message: string
  target: SlideVisualPreflightTarget
  sceneId?: string
  stateId?: string
  nodeId?: string
  path?: ReadonlyArray<string | number>
}

export interface CourseSlideVisualPreflightReport {
  reportVersion: 1
  projectId: string
  schemaVersion: 9
  target: SlideVisualPreflightTarget
  generatedAt: string
  items: SlideVisualPreflightItem[]
  summary: {
    error: number
    warning: number
    info: number
    total: number
    canExport: boolean
  }
}

interface SlideVisualStateContext {
  sceneId: string
  sceneName: string
  stateId?: string
  stateName: string
  backgroundColor: string
}

interface ComponentVisualNode {
  id: string
  name: string
  type: 'external-component'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  playbackInitialVisibility: 'inherit' | 'hidden'
  component: { packageId: string; version: string }
  props: Record<string, unknown>
}

type VisualInspectNode = NativeRenderableNode | ComponentVisualNode

type AddItem = (item: Omit<SlideVisualPreflightItem, 'target'>) => void

export const SLIDE_VISUAL_PREFLIGHT_CODES = [
  'controller-interactive-obstruction',
  'formula-content-overflow',
  'formula-content-overflow-estimated',
  'formula-layout-check-failed',
  'formula-low-contrast',
  'image-hard-edge-review',
  'image-safe-area-review',
  'node-fully-outside-canvas',
  'node-partially-outside-canvas',
  'pptx-formula-rasterized',
  'pptx-text-emphasis-rasterized',
  'scene-appears-blank',
  'text-content-overflow',
  'text-content-overflow-estimated',
  'text-font-size-below-recommended',
  'text-font-size-near-minimum',
  'text-font-unavailable',
  'text-layout-check-failed',
  'text-low-contrast',
  'visual-density-high',
  'visual-overlap-heuristic',
] as const satisfies readonly ExportPreflightCode[]

const MINIMUM_BODY_FONT_SIZE = 22
const NEAR_MINIMUM_BODY_FONT_SIZE = 24

function rgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]
}

function blendColor(foreground: string, background: string, alpha: number): string {
  const foregroundRgb = rgb(foreground)
  const backgroundRgb = rgb(background)
  const channel = (index: number) => Math.round(
    foregroundRgb[index]! * alpha + backgroundRgb[index]! * (1 - alpha),
  ).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

function relativeLuminance(color: string): number {
  const channels = rgb(color).map((value) => {
    const normalized = value / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

function area(bounds: ReturnType<typeof rotatedRectangleAabb>): number {
  return Math.max(0, bounds.right - bounds.left) *
    Math.max(0, bounds.bottom - bounds.top)
}

function intersectionArea(
  left: ReturnType<typeof rotatedRectangleAabb>,
  right: ReturnType<typeof rotatedRectangleAabb>,
): number {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) *
    Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
}

function textFontAvailable(node: TextNode): boolean | null {
  if (typeof document === 'undefined' || !document.fonts?.check) return null
  try {
    return document.fonts.check(
      `${Math.max(8, node.style.fontSize)}px "${node.style.fontFamily}"`,
      '课件字体检查',
    )
  } catch {
    return null
  }
}

function nodeLocationLabel(context: SlideVisualStateContext, node: VisualInspectNode): string {
  return `场景“${context.sceneName}”${context.stateId ? `的状态“${context.stateName}”` : '的基础画面'}中，节点“${node.name}”`
}

/** Pure visual rule over an already materialized node and background. */
function collectNodeItems(input: {
  canvas: { width: number; height: number }
  target: SlideVisualPreflightTarget
  node: VisualInspectNode
  context: SlideVisualStateContext
  add: AddItem
}): void {
  const { canvas, target, node, context, add } = input
  if (!node.visible) return
  const label = nodeLocationLabel(context, node)
  const bounds = rotatedRectangleAabb(node)
  const outside = bounds.right <= 0 ||
    bounds.bottom <= 0 ||
    bounds.left >= canvas.width ||
    bounds.top >= canvas.height
  const clipped = !outside && (
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.right > canvas.width ||
    bounds.bottom > canvas.height
  )
  if (outside) {
    add({
      severity: 'error',
      code: 'node-fully-outside-canvas',
      message: `${label}完全位于 1280×720 画布之外。`,
      sceneId: context.sceneId,
      ...(context.stateId ? { stateId: context.stateId } : {}),
      nodeId: node.id,
    })
  } else if (clipped) {
    add({
      severity: 'warning',
      code: 'node-partially-outside-canvas',
      message: `${label}有一部分超出画布，导出时会被裁切。`,
      sceneId: context.sceneId,
      ...(context.stateId ? { stateId: context.stateId } : {}),
      nodeId: node.id,
    })
  }

  if (node.type === 'formula') {
    const formulaForeground = blendColor(
      node.style.color,
      context.backgroundColor,
      node.opacity,
    )
    const formulaContrast = contrastRatio(formulaForeground, context.backgroundColor)
    if (formulaContrast < (node.style.fontSize >= 24 ? 3 : 4.5)) {
      add({
        severity: 'warning',
        code: 'formula-low-contrast',
        message: `${label}与场景背景的估算对比度仅 ${formulaContrast.toFixed(2)}:1；这是启发式提醒，请在真实投影环境人工确认。`,
        sceneId: context.sceneId,
        ...(context.stateId ? { stateId: context.stateId } : {}),
        nodeId: node.id,
      })
    }
    try {
      const layout = analyzeFormulaNodeLayout(node)
      if (layout.overflowsWidth || layout.overflowsHeight) {
        const estimated = layout.measurementMode === 'deterministic-fallback'
        add({
          severity: estimated ? 'warning' : 'error',
          code: estimated
            ? 'formula-content-overflow-estimated'
            : 'formula-content-overflow',
          message: estimated
            ? `${label}的公式在 Node 确定性近似测量中可能超出节点区域；请用真实导出或编辑器画布确认。`
            : `${label}的公式超出节点可用区域，导出时会被裁切；请扩大节点或减小字号。`,
          sceneId: context.sceneId,
          ...(context.stateId ? { stateId: context.stateId } : {}),
          nodeId: node.id,
        })
      }
    } catch (error) {
      add({
        severity: 'warning',
        code: 'formula-layout-check-failed',
        message: `${label}未能完成公式排版预检：${error instanceof Error ? error.message : String(error)}`,
        sceneId: context.sceneId,
        ...(context.stateId ? { stateId: context.stateId } : {}),
        nodeId: node.id,
      })
    }
    if (target === 'pptx') {
      add({
        severity: 'info',
        code: 'pptx-formula-rasterized',
        message: `${label}是递归语义公式；PPTX 没有可靠的一对一原生映射，将按共享渲染结果静态化为透明图片，并保留 Formula ID 与无障碍文本。`,
        sceneId: context.sceneId,
        ...(context.stateId ? { stateId: context.stateId } : {}),
        nodeId: node.id,
      })
    }
    return
  }

  if (node.type === 'image') {
    if (node.safeAreas.length > 0) {
      add({
        severity: 'info',
        code: 'image-safe-area-review',
        message: `${label}登记了 ${node.safeAreas.length} 个编辑器安全区；请人工确认裁剪后的主体仍完整，安全区本身不会进入成品画面。`,
        sceneId: context.sceneId,
        ...(context.stateId ? { stateId: context.stateId } : {}),
        nodeId: node.id,
      })
    }
    if (
      node.feather.amount === 0 &&
      node.cornerRadius === 0 &&
      node.width * node.height >= canvas.width * canvas.height * 0.35
    ) {
      add({
        severity: 'info',
        code: 'image-hard-edge-review',
        message: `${label}占据大面积且没有圆角或羽化；这不是错误，请人工确认硬边是否符合视觉意图。`,
        sceneId: context.sceneId,
        ...(context.stateId ? { stateId: context.stateId } : {}),
        nodeId: node.id,
      })
    }
    return
  }

  if (node.type !== 'text' || !node.text.trim()) return
  const textBackground = blendColor(
    node.style.backgroundColor,
    context.backgroundColor,
    node.style.backgroundOpacity * node.opacity,
  )
  const textForeground = blendColor(node.style.color, textBackground, node.opacity)
  const textContrast = contrastRatio(textForeground, textBackground)
  if (textContrast < (node.style.fontSize >= 24 ? 3 : 4.5)) {
    add({
      severity: 'warning',
      code: 'text-low-contrast',
      message: `${label}的估算文字对比度仅 ${textContrast.toFixed(2)}:1；这是启发式提醒，请在真实投影环境人工确认。`,
      sceneId: context.sceneId,
      ...(context.stateId ? { stateId: context.stateId } : {}),
      nodeId: node.id,
    })
  }
  if (node.style.fontSize < MINIMUM_BODY_FONT_SIZE) {
    add({
      severity: 'warning',
      code: 'text-font-size-below-recommended',
      message: `${label}字号为 ${node.style.fontSize}px，低于当前正文建议下限 ${MINIMUM_BODY_FONT_SIZE}px；请人工确认其是否只是辅助标签。`,
      sceneId: context.sceneId,
      ...(context.stateId ? { stateId: context.stateId } : {}),
      nodeId: node.id,
    })
  } else if (node.style.fontSize < NEAR_MINIMUM_BODY_FONT_SIZE) {
    add({
      severity: 'info',
      code: 'text-font-size-near-minimum',
      message: `${label}字号接近正文建议下限，请在实际投影距离下复查。`,
      sceneId: context.sceneId,
      ...(context.stateId ? { stateId: context.stateId } : {}),
      nodeId: node.id,
    })
  }

  const fontAvailable = textFontAvailable(node)
  if (fontAvailable === false) {
    add({
      severity: 'warning',
      code: 'text-font-unavailable',
      message: `${label}使用的系统字体“${node.style.fontFamily}”当前不可用，换行和字形可能发生变化。`,
      sceneId: context.sceneId,
      ...(context.stateId ? { stateId: context.stateId } : {}),
      nodeId: node.id,
    })
  }

  try {
    const layout = analyzeTextNodeLayout(node)
    const clipsText = node.style.overflow === 'fixed' &&
      (layout.overflowsWidth || layout.overflowsHeight)
    const shrinkHitFloor = node.style.overflow === 'shrink' &&
      layout.fontSize <= 8 &&
      (layout.overflowsWidth || layout.overflowsHeight)
    if (clipsText || shrinkHitFloor) {
      const estimated = layout.measurementMode === 'deterministic-fallback'
      add({
        severity: estimated ? 'warning' : 'error',
        code: estimated
          ? 'text-content-overflow-estimated'
          : 'text-content-overflow',
        message: estimated
          ? `${label}的文字在 Node 确定性近似测量中可能超出节点区域；请用真实导出或编辑器画布确认。`
          : `${label}的文字超出节点可用区域，当前“${node.style.overflow === 'fixed' ? '裁切' : '缩小'}”策略仍无法完整呈现。`,
        sceneId: context.sceneId,
        ...(context.stateId ? { stateId: context.stateId } : {}),
        nodeId: node.id,
      })
    }
  } catch (error) {
    add({
      severity: 'warning',
      code: 'text-layout-check-failed',
      message: `${label}未能完成文字排版预检：${error instanceof Error ? error.message : String(error)}`,
      sceneId: context.sceneId,
      ...(context.stateId ? { stateId: context.stateId } : {}),
      nodeId: node.id,
    })
  }

  if (target === 'pptx' && textNodeHasEmphasis(node)) {
    add({
      severity: 'info',
      code: 'pptx-text-emphasis-rasterized',
      message: `${label}含有文字着重号，PPTX 将按保真策略静态化该文本节点。`,
      sceneId: context.sceneId,
      ...(context.stateId ? { stateId: context.stateId } : {}),
      nodeId: node.id,
    })
  }
}

function collectControllerObstructionItems(input: {
  context: SlideVisualStateContext
  nodes: readonly VisualInspectNode[]
  interactiveNodeIds: ReadonlySet<string>
  add: AddItem
}): void {
  const visibleNodes = input.nodes.filter((node) => node.visible)
  const interactiveNodes = visibleNodes.filter((node) => (
    node.type !== 'teacher-controller' && (
      input.interactiveNodeIds.has(node.id) ||
      node.type === 'external-component' ||
      (node.type === 'video' && (node.clickToToggle || node.showControls))
    )
  ))
  visibleNodes
    .filter((node) => node.type === 'teacher-controller')
    .forEach((controller) => {
      const controllerBounds = rotatedRectangleAabb(controller)
      interactiveNodes.forEach((interactive) => {
        const interactiveBounds = rotatedRectangleAabb(interactive)
        const targetArea = area(interactiveBounds)
        if (
          targetArea <= 0 ||
          intersectionArea(controllerBounds, interactiveBounds) / targetArea < 0.2
        ) return
        input.add({
          severity: 'warning',
          code: 'controller-interactive-obstruction',
          message: `${nodeLocationLabel(input.context, controller)}与主要互动节点“${interactive.name}”重叠超过其面积的 20%；这是启发式提醒，请按真实课堂操作人工确认。`,
          sceneId: input.context.sceneId,
          ...(input.context.stateId ? { stateId: input.context.stateId } : {}),
          nodeId: controller.id,
        })
      })
    })
}

function collectDensityItems(
  state: VisualDensityStateReport,
  add: AddItem,
): void {
  if (state.band === 'dense') {
    add({
      severity: 'warning',
      code: 'visual-density-high',
      message: `场景“${state.sceneName}”的状态“${state.stateName}”视觉密度启发式得分为 ${state.score}/100；请人工确认信息焦点与任务入口是否清晰。`,
      sceneId: state.sceneId,
      stateId: state.stateId,
    })
  }
  if (state.significantOverlapPairs >= 3) {
    add({
      severity: 'warning',
      code: 'visual-overlap-heuristic',
      message: `场景“${state.sceneName}”的状态“${state.stateName}”检测到 ${state.significantOverlapPairs} 对大面积包围盒重叠；重叠可能是有意叠层，请人工复查而非按错误处理。`,
      sceneId: state.sceneId,
      stateId: state.stateId,
    })
  }
}

function interactiveNodeIds(
  rules: readonly { enabled: boolean; trigger: { type: string; nodeId?: string } }[],
): Set<string> {
  const ids = new Set<string>()
  rules.filter((rule) => rule.enabled).forEach((rule) => {
    if (
      rule.trigger.type === 'node.click' ||
      rule.trigger.type === 'node.activated' ||
      rule.trigger.type === 'component.event'
    ) {
      if (rule.trigger.nodeId) ids.add(rule.trigger.nodeId)
    }
  })
  return ids
}

function itemCollector(target: SlideVisualPreflightTarget): {
  items: SlideVisualPreflightItem[]
  add: AddItem
} {
  const items: SlideVisualPreflightItem[] = []
  return {
    items,
    add: (item) => { items.push({ ...item, target }) },
  }
}

function layerItemToVisualNode(item: LayerItem): VisualInspectNode | null {
  const base = {
    id: item.layerItemId,
    name: item.label,
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    rotation: item.rotation,
    opacity: item.opacity,
    visible: item.visible,
    locked: item.locked,
    playbackInitialVisibility: item.playbackInitialVisibility,
  }
  if (item.kind === 'component') {
    return {
      ...base,
      type: 'external-component',
      component: structuredClone(item.component),
      props: structuredClone(item.props),
    }
  }
  if (item.kind !== 'native') return null
  const native = item as NativeLayerItem
  return {
    ...base,
    type: native.content.nativeType,
    ...structuredClone(native.content.data),
  } as VisualInspectNode
}

function slideLocation(project: CourseProjectDocument, locationId: string): {
  surface: SlideSurfaceDocument
  scene: SlideSurfaceDocument['scenes'][number]
} {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location || location.kind !== 'slide-scene') {
    throw new Error(`Location ${locationId} is not a Slide scene location`)
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') {
    throw new Error(`Unknown Slide surface: ${location.surfaceId}`)
  }
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error(`Unknown Slide scene: ${location.sceneId}`)
  return { surface, scene }
}

function mountedNodes(composition: CourseLayerComposition<LayerItem>): VisualInspectNode[] {
  return composition.entries.flatMap((entry) => {
    if (!entry.mounted) return []
    const node = layerItemToVisualNode(entry.item)
    return node ? [node] : []
  })
}

/**
 * V9 location adapter. Scope, state materialization, background and stable order
 * are consumed only from the shared SEM-B3 composition result.
 */
export function collectCourseSlideLocationVisualPreflightItems(input: {
  project: CourseProjectDocument
  locationId: string
  target: SlideVisualPreflightTarget
}): SlideVisualPreflightItem[] {
  const { surface, scene } = slideLocation(input.project, input.locationId)
  const { items, add } = itemCollector(input.target)
  const states: Array<{ id: string | null; name: string }> = [
    { id: null, name: '基础画面' },
    ...(scene.presentation?.states.map(({ id, name }) => ({ id, name })) ?? []),
  ]
  const interactiveIds = interactiveNodeIds([
    ...scene.interactions,
    ...input.project.globalInteractions,
  ])
  for (const state of states) {
    const composition = composeCourseProjectLocation({
      project: input.project,
      locationId: input.locationId,
      stateId: state.id,
    })
    if (!composition.background) {
      throw new Error(`Slide composition ${input.locationId} has no background`)
    }
    const nodes = mountedNodes(composition)
    const context: SlideVisualStateContext = {
      sceneId: scene.id,
      sceneName: scene.name,
      ...(state.id ? { stateId: state.id } : {}),
      stateName: state.name,
      backgroundColor: composition.background.color,
    }
    nodes.forEach((node) => collectNodeItems({
      canvas: surface.canvas,
      target: input.target,
      node,
      context,
      add,
    }))
    collectControllerObstructionItems({
      context,
      nodes,
      interactiveNodeIds: interactiveIds,
      add,
    })
    if (state.id !== null) {
      collectDensityItems(analyzeVisualDensityState({
        sceneId: scene.id,
        sceneName: scene.name,
        stateId: state.id,
        stateName: state.name,
        nodes,
        canvas: surface.canvas,
      }), add)
    }
  }

  const initialStateId = scene.presentation?.states.length
    ? scene.presentation.initialStateId
    : null
  const initialComposition = composeCourseProjectLocation({
    project: input.project,
    locationId: input.locationId,
    stateId: initialStateId,
  })
  const visibleContent = initialComposition.entries.some((entry) => (
    entry.mounted && !(
      entry.item.kind === 'native' &&
      entry.item.content.nativeType === 'teacher-controller'
    )
  ))
  if (!visibleContent && !initialComposition.background?.assetId) {
    add({
      severity: 'warning',
      code: 'scene-appears-blank',
      message: `场景“${scene.name}”没有可见内容、背景图片或运行时，导出结果可能是空白页。`,
      sceneId: scene.id,
    })
  }
  return items
}

function stableItemKey(item: SlideVisualPreflightItem): string {
  return [
    item.severity,
    item.code,
    item.sceneId ?? '',
    item.stateId ?? '',
    item.nodeId ?? '',
    item.message,
  ].join('\0')
}

function normalizedItems(items: readonly SlideVisualPreflightItem[]): SlideVisualPreflightItem[] {
  const itemMap = new Map<string, SlideVisualPreflightItem>()
  items.forEach((item) => itemMap.set(stableItemKey(item), item))
  const severityOrder = { error: 0, warning: 1, info: 2 }
  return [...itemMap.values()].sort((left, right) => (
    severityOrder[left.severity] - severityOrder[right.severity] ||
    compareStableStrings(left.code, right.code) ||
    compareStableStrings(left.sceneId ?? '', right.sceneId ?? '')
  ))
}

export function collectCourseProjectSlideVisualPreflightItems(
  project: CourseProjectDocument,
  target: SlideVisualPreflightTarget,
): SlideVisualPreflightItem[] {
  return normalizedItems(project.locations.flatMap((location) => (
    location.kind === 'slide-scene'
      ? collectCourseSlideLocationVisualPreflightItems({
          project,
          locationId: location.id,
          target,
        })
      : []
  )))
}

/** Shared V9 adapter consumed by GUI/export preflight and headless checks. */
export function collectCourseProjectSlideVisualPreflight(
  project: CourseProjectDocument,
  target: SlideVisualPreflightTarget,
  now = new Date(),
): CourseSlideVisualPreflightReport {
  const items = collectCourseProjectSlideVisualPreflightItems(project, target)
  const summary = { error: 0, warning: 0, info: 0, total: items.length, canExport: true }
  items.forEach(({ severity }) => { summary[severity] += 1 })
  summary.canExport = summary.error === 0
  return {
    reportVersion: 1,
    projectId: project.id,
    schemaVersion: 9,
    target,
    generatedAt: now.toISOString(),
    items,
    summary,
  }
}
