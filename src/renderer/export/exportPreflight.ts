import type { ComponentPackageData } from '../../shared/componentTypes'
import { rotatedRectangleAabb } from '../../shared/geometry'
import { ensureScenePresentation, materializeScene } from '../../shared/presentation'
import type {
  ProjectDocument,
  SceneNode,
  TextNode,
} from '../../shared/projectTypes'
import { analyzeFormulaNodeLayout } from '../../shared/formulaRenderer'
import { analyzeVisualDensity } from '../../shared/visualDensity'
import {
  collectProjectHealth,
  type ProjectHealthSeverity,
} from '../../shared/projectHealth'
import {
  analyzeTextNodeLayout,
  textNodeHasEmphasis,
} from '../../shared/textLayout'
import { visibleGlobalLayerItemsForScene } from './exportPayloadSupport'
import type { ExportPreflightCode } from '../../shared/diagnosticCodes'
import { collectUnusedProjectAssetIds } from '../../shared/assetReferences'
import { componentContentSha256 } from '../../shared/componentContentIntegrity'
import { compareStableStrings } from '../../shared/stableOrder'

export type ExportPreflightTarget =
  | 'single-html'
  | 'web-package'
  | 'pdf'
  | 'pptx'

export interface ExportPreflightResources {
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
}

export interface ExportPreflightItem {
  severity: ProjectHealthSeverity
  code: ExportPreflightCode
  message: string
  target: ExportPreflightTarget
  sceneId?: string
  stateId?: string
  nodeId?: string
  path?: ReadonlyArray<string | number>
}

export interface ExportPreflightReport {
  reportVersion: 1
  projectId: string
  schemaVersion: 8 | 9
  target: ExportPreflightTarget
  generatedAt: string
  items: ExportPreflightItem[]
  summary: {
    error: number
    warning: number
    info: number
    total: number
    canExport: boolean
  }
}

interface SceneStateContext {
  sceneId: string
  sceneName: string
  stateId?: string
  stateName: string
  backgroundColor: string
}

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

function componentKey(packageId: string, version: string): string {
  return `${packageId}@${version}`
}

type SourceNetworkFinding = 'network-use' | 'url-reference' | null

function inspectSourceNetworkUse(source: string): SourceNetworkFinding {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
  // XML/SVG namespace identifiers use an http-looking URI but do not trigger
  // a request. Treating every `//` token as a URL also blocks legitimate
  // authored strings such as the reading component's pause markup.
  const inertNamespaceUris = new Set([
    'http://www.w3.org/2000/svg',
    'http://www.w3.org/1999/xlink',
    'http://www.w3.org/XML/1998/namespace',
  ])
  const absoluteUrls = withoutComments.match(/\bhttps?:\/\/[^\s'"`<>)]+/gi) ?? []
  const hasExternalUrl = absoluteUrls.some(
    (url) => !inertNamespaceUris.has(url.replace(/[;,]+$/, '')),
  )
  const protocolRelativeHost = /(?<!:)\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|(?=['"`]))/i
  const hasProtocolRelativeUrl = protocolRelativeHost.test(withoutComments)
  const usesNetworkApi = /\bfetch\s*\(/.test(withoutComments) ||
    /\bXMLHttpRequest\b/.test(withoutComments) ||
    /\b(?:WebSocket|EventSource)\s*\(/.test(withoutComments) ||
    /\bnavigator\s*\.\s*sendBeacon\s*\(/.test(withoutComments)
  const usesExternalResourceSyntax =
    /@import\s+(?:url\()?\s*['"]?(?:https?:)?\/\//i.test(withoutComments) ||
    /\burl\(\s*['"]?(?:https?:)?\/\//i.test(withoutComments) ||
    /\bimport\s*(?:\(|[^;\n]*?\bfrom\s*)['"](?:https?:)?\/\//i.test(withoutComments) ||
    /<(?:img|script|link|iframe|video|audio|source)\b[^>]*\b(?:src|href|poster)\s*=\s*['"](?:https?:)?\/\//i.test(withoutComments) ||
    /\.\s*(?:src|href|poster)\s*=\s*['"](?:https?:)?\/\//i.test(withoutComments) ||
    /setAttribute\s*\(\s*['"](?:src|href|poster)['"]\s*,\s*['"](?:https?:)?\/\//i.test(withoutComments)

  if (usesNetworkApi || usesExternalResourceSyntax) return 'network-use'
  return hasExternalUrl || hasProtocolRelativeUrl ? 'url-reference' : null
}

function stableItemKey(item: ExportPreflightItem): string {
  return [
    item.severity,
    item.code,
    item.sceneId ?? '',
    item.stateId ?? '',
    item.nodeId ?? '',
    item.message,
  ].join('\0')
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

function nodeLocationLabel(context: SceneStateContext, node: SceneNode): string {
  return `场景“${context.sceneName}”${context.stateId ? `的状态“${context.stateName}”` : '的基础画面'}中，节点“${node.name}”`
}

function collectNodeItems(
  project: ProjectDocument,
  target: ExportPreflightTarget,
  node: SceneNode,
  context: SceneStateContext,
  add: (item: Omit<ExportPreflightItem, 'target'>) => void,
): void {
  if (!node.visible) return
  const label = nodeLocationLabel(context, node)
  const bounds = rotatedRectangleAabb(node)
  const outside = bounds.right <= 0 ||
    bounds.bottom <= 0 ||
    bounds.left >= project.canvas.width ||
    bounds.top >= project.canvas.height
  const clipped = !outside && (
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.right > project.canvas.width ||
    bounds.bottom > project.canvas.height
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
      node.width * node.height >= project.canvas.width * project.canvas.height * 0.35
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

function summarize(items: readonly ExportPreflightItem[]): ExportPreflightReport['summary'] {
  const summary = { error: 0, warning: 0, info: 0, total: items.length, canExport: true }
  items.forEach(({ severity }) => { summary[severity] += 1 })
  summary.canExport = summary.error === 0
  return summary
}

export function collectExportPreflight(
  project: ProjectDocument,
  target: ExportPreflightTarget,
  resources: ExportPreflightResources,
  now = new Date(),
): ExportPreflightReport {
  const itemMap = new Map<string, ExportPreflightItem>()
  const add = (item: Omit<ExportPreflightItem, 'target'>): void => {
    const complete = { ...item, target }
    itemMap.set(stableItemKey(complete), complete)
  }

  collectProjectHealth(project, resources.components)
    .filter((diagnostic) => diagnostic.code !== 'asset-unused')
    .forEach((diagnostic) => add({
    severity: diagnostic.severity,
    code: `project-health:${diagnostic.code}` as const,
    message: diagnostic.message,
    path: diagnostic.path,
    ...(diagnostic.sceneId ? { sceneId: diagnostic.sceneId } : {}),
    ...(diagnostic.stateId ? { stateId: diagnostic.stateId } : {}),
    ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
    }))

  const unusedAssetIds = collectUnusedProjectAssetIds(project, {
    componentPackages: resources.components,
  })
  if (unusedAssetIds.size > 0) {
    const byteLength = Object.values(project.assets)
      .filter((asset) => unusedAssetIds.has(asset.id))
      .reduce((total, asset) => total + asset.byteLength, 0)
    add({
      severity: 'info',
      code: 'asset-unused-summary',
      message: `工程含 ${unusedAssetIds.size} 个未引用素材，共 ${byteLength} 字节；发布裁剪保持现有语义，工程归档不会被静默改写。`,
      path: ['assets'],
    })
  }

  for (const [assetKey, asset] of Object.entries(project.assets)) {
    if (!resources.assetFiles[assetKey] && !resources.assetFiles[asset.id]) {
      add({
        severity: 'error',
        code: 'asset-bytes-missing',
        message: `素材“${asset.filename}”只有工程元数据，没有可嵌入导出物的本地字节。`,
        path: ['assets', assetKey],
      })
    }
  }

  for (const [packageKey, embedded] of Object.entries(project.componentPackages)) {
    const component = Object.values(resources.components).find(
      ({ manifest }) => manifest.id === embedded.packageId &&
        manifest.version === embedded.version,
    )
    if (!component) {
      add({
        severity: 'error',
        code: 'component-bytes-missing',
        message: `组件包“${componentKey(embedded.packageId, embedded.version)}”没有可嵌入导出物的执行内容。`,
        path: ['componentPackages', packageKey],
      })
      continue
    }
    const actualContentSha256 = component.contentSha256 ??
      componentContentSha256(component.files)
    if (embedded.contentSha256 !== actualContentSha256) {
      add({
        severity: 'error',
        code: 'component-hash-mismatch',
        message: `组件包“${componentKey(embedded.packageId, embedded.version)}”的工程锁定内容哈希与当前执行内容不一致。`,
        path: ['componentPackages', packageKey, 'contentSha256'],
      })
    }
    const networkFinding = inspectSourceNetworkUse(component.runtimeSource)
    if (networkFinding === 'network-use') {
      add({
        severity: 'error',
        code: 'component-external-network',
        message: `组件包“${componentKey(embedded.packageId, embedded.version)}”包含网络请求 API 或外部资源引用，违反离线交付要求。`,
        path: ['componentPackages', packageKey],
      })
    } else if (networkFinding === 'url-reference') {
      add({
        severity: 'warning',
        code: 'component-external-url-reference',
        message: `组件包“${componentKey(embedded.packageId, embedded.version)}”含有外部 URL 文本，但预检未识别到网络请求或资源加载；请确认它只用于展示或归属说明。`,
        path: ['componentPackages', packageKey],
      })
    }
  }

  const runtimeEntries: Array<{
    source: string
    label: string
    path: Array<string | number>
    sceneId?: string
  }> = []
  if (project.globalRuntime?.enabled) {
    runtimeEntries.push({
      source: project.globalRuntime.source,
      label: '全局自由运行时',
      path: ['globalRuntime', 'source'],
    })
  }
  project.scenes.forEach((scene, sceneIndex) => {
    if (scene.runtime?.enabled) runtimeEntries.push({
      source: scene.runtime.source,
      label: `场景“${scene.name}”自由运行时`,
      path: ['scenes', sceneIndex, 'runtime', 'source'],
      sceneId: scene.id,
    })
  })
  runtimeEntries.forEach((runtime) => {
    const networkFinding = inspectSourceNetworkUse(runtime.source)
    if (networkFinding === 'network-use') {
      add({
        severity: 'error',
        code: 'runtime-external-network',
        message: `${runtime.label}包含网络请求 API 或外部资源引用，违反离线交付要求。`,
        path: runtime.path,
        ...(runtime.sceneId ? { sceneId: runtime.sceneId } : {}),
      })
    } else if (networkFinding === 'url-reference') {
      add({
        severity: 'warning',
        code: 'runtime-external-url-reference',
        message: `${runtime.label}含有外部 URL 文本，但预检未识别到网络请求或资源加载；请确认它只用于展示或归属说明。`,
        path: runtime.path,
        ...(runtime.sceneId ? { sceneId: runtime.sceneId } : {}),
      })
    }
  })

  for (const scene of project.scenes) {
    const presentation = ensureScenePresentation(scene)
    const states: Array<{ id: string | null; name: string }> = [
      { id: null, name: '基础画面' },
      ...presentation.states.map(({ id, name }) => ({ id, name })),
    ]
    states.forEach((state) => {
      const rendered = materializeScene(scene, state.id)
      const context: SceneStateContext = {
        sceneId: scene.id,
        sceneName: scene.name,
        ...(state.id ? { stateId: state.id } : {}),
        stateName: state.name,
        backgroundColor: rendered.backgroundColor,
      }
      rendered.nodes.forEach((node) => collectNodeItems(
        project,
        target,
        node,
        context,
        add,
      ))

      const globalNodes = visibleGlobalLayerItemsForScene(project, scene.id)
        .map(({ node }) => node)
      const visibleNodes = [...rendered.nodes, ...globalNodes].filter(
        (node) => node.visible,
      )
      const interactiveNodeIds = new Set<string>()
      ;[...scene.interactions, ...project.globalInteractions]
        .filter((rule) => rule.enabled)
        .forEach((rule) => {
          if (
            rule.trigger.type === 'node.click' ||
            rule.trigger.type === 'node.activated' ||
            rule.trigger.type === 'component.event'
          ) {
            interactiveNodeIds.add(rule.trigger.nodeId)
          }
        })
      const interactiveNodes = visibleNodes.filter((node) => (
        node.type !== 'teacher-controller' && (
          interactiveNodeIds.has(node.id) ||
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
            add({
              severity: 'warning',
              code: 'controller-interactive-obstruction',
              message: `${nodeLocationLabel(context, controller)}与主要互动节点“${interactive.name}”重叠超过其面积的 20%；这是启发式提醒，请按真实课堂操作人工确认。`,
              sceneId: scene.id,
              ...(state.id ? { stateId: state.id } : {}),
              nodeId: controller.id,
            })
          })
        })
    })

    const globalContext: SceneStateContext = {
      sceneId: scene.id,
      sceneName: scene.name,
      stateName: '全局层',
      backgroundColor: scene.backgroundColor,
    }
    visibleGlobalLayerItemsForScene(project, scene.id).forEach(({ node }) => {
      collectNodeItems(project, target, node, globalContext, add)
    })

    const visibleContent = materializeScene(scene).nodes.some(
      (node) => node.visible && node.type !== 'teacher-controller',
    ) || visibleGlobalLayerItemsForScene(project, scene.id).some(
      ({ node }) => node.type !== 'teacher-controller',
    ) || scene.runtime?.enabled || project.globalRuntime?.enabled
    if (!visibleContent && !scene.backgroundAssetId) {
      add({
        severity: 'warning',
        code: 'scene-appears-blank',
        message: `场景“${scene.name}”没有可见内容、背景图片或运行时，导出结果可能是空白页。`,
        sceneId: scene.id,
      })
    }
  }

  analyzeVisualDensity(project).states.forEach((state) => {
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
  })

  if (target === 'pdf' || target === 'pptx') {
    const interactionCount = project.globalInteractions.length +
      project.scenes.reduce((count, scene) => count + scene.interactions.length, 0)
    const videoCount = project.globalLayer.filter(({ node }) => node.type === 'video').length +
      project.scenes.reduce(
        (count, scene) => count + scene.nodes.filter(({ type }) => type === 'video').length,
        0,
      )
    const omittedControllerCount = project.globalLayer.filter(
      ({ node }) => node.type === 'teacher-controller' && !node.includeInStaticExports,
    ).length + project.scenes.reduce(
      (count, scene) => count + scene.nodes.filter(
        (node) => node.type === 'teacher-controller' && !node.includeInStaticExports,
      ).length,
      0,
    )
    if (interactionCount > 0) add({
      severity: 'info',
      code: 'static-export-interactions-omitted',
      message: `${target.toUpperCase()} 为静态格式，${interactionCount} 条声明式交互不会保留。`,
    })
    if (Object.keys(project.media.audio.sounds).length > 0) add({
      severity: 'info',
      code: 'static-export-audio-omitted',
      message: `${target.toUpperCase()} 为静态格式，声音不会播放。`,
    })
    if (videoCount > 0) add({
      severity: 'info',
      code: 'static-export-video-poster',
      message: `${target.toUpperCase()} 中的 ${videoCount} 个视频只保留封面或静态占位。`,
    })
    if (omittedControllerCount > 0) add({
      severity: 'info',
      code: 'static-export-controller-omitted',
      message: `${omittedControllerCount} 个教师控制器按作者设置从静态导出中省略。`,
    })
  }

  const items = [...itemMap.values()].sort((left, right) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[left.severity] - severityOrder[right.severity] ||
      compareStableStrings(left.code, right.code) ||
      compareStableStrings(left.sceneId ?? '', right.sceneId ?? '')
  })
  return {
    reportVersion: 1,
    projectId: project.id,
    schemaVersion: project.schemaVersion,
    target,
    generatedAt: now.toISOString(),
    items,
    summary: summarize(items),
  }
}
