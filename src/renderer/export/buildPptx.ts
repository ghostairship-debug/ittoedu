import type { ExportPayload } from '../../shared/componentTypes'
import { APP_COMPANY, APP_NAME } from '../../shared/constants'
import { materializeScene } from '../../shared/presentation'
import type { SceneNode } from '../../shared/projectTypes'
import { bytesToDataUrl } from './base64'
import {
  addPptxComponentNode,
  addPptxImageNode,
  releasePptxImageCache,
  type PptxImageCacheEntry,
} from './pptxImages'
import {
  pptxComponentSnapshotKey,
  pptxColor,
  pptxGlobalComponentSnapshotKey,
  pptxNodePosition,
  WIDE_SLIDE_HEIGHT,
  WIDE_SLIDE_WIDTH,
  type CanvasScale,
  type PptxSlide,
} from './pptxShared'
import {
  addPptxFormulaNode,
  addPptxShapeNode,
  addPptxTextNode,
} from './pptxTextAndShape'
import {
  assertExportPayloadDependencies,
  runtimeEntriesForScene,
  runtimeSnapshotKey,
  visibleGlobalLayerItemsForScene,
  type RuntimeStaticExportEntry,
} from './exportPayloadSupport'

export interface BuildPptxOptions {
  /** Test/host injection point. Production builds render snapshots on demand. */
  componentSnapshots?: Map<string, string>
  /** Item-level diagnostics keyed like componentSnapshots. */
  componentSnapshotFailures?: ReadonlyMap<string, string>
  /** Transparent full-canvas snapshots keyed by runtimeSnapshotKey(). */
  runtimeSnapshots?: Map<string, string>
  /** Runtime- or layer-level diagnostics keyed by runtimeSnapshotKey(). */
  runtimeSnapshotFailures?: ReadonlyMap<string, string>
  skipSnapshotRendering?: boolean
  onWarning?(message: string): void
}

function snapshotErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolvePptxAssetData(
  payload: ExportPayload,
  assetFiles: Record<string, Uint8Array>,
  assetId: string,
): string | null {
  const embedded = payload.assets[assetId]?.dataUrl
  if (embedded?.startsWith('data:')) return embedded
  const bytes = assetFiles[assetId]
  const meta = payload.project.assets[assetId]
  return bytes && meta ? bytesToDataUrl(bytes, meta.mimeType) : null
}

function addFullCanvasImage(
  slide: PptxSlide,
  data: string,
  objectName: string,
  altText: string,
): void {
  slide.addImage({
    data,
    x: 0,
    y: 0,
    w: WIDE_SLIDE_WIDTH,
    h: WIDE_SLIDE_HEIGHT,
    objectName,
    altText,
  })
}

function addRuntimeLayer(
  slide: PptxSlide,
  entry: RuntimeStaticExportEntry,
  layer: 'underlay' | 'overlay',
  payload: ExportPayload,
  assetFiles: Record<string, Uint8Array>,
  runtimeSnapshots: Map<string, string>,
  runtimeSnapshotFailures: ReadonlyMap<string, string>,
  snapshotRenderingFailed: boolean,
  warnings: string[],
): void {
  const layerKey = runtimeSnapshotKey(entry.scope, entry.sceneId, layer)
  const failureMessage = runtimeSnapshotFailures.get(layerKey)
    ?? runtimeSnapshotFailures.get(entry.key)
  const snapshot = runtimeSnapshots.get(layerKey)
    ?? (entry.layer === layer ? runtimeSnapshots.get(entry.key) : undefined)
  if (snapshot) {
    addFullCanvasImage(
      slide,
      snapshot,
      `${entry.label} · ${layer === 'underlay' ? '底层' : '顶层'}实际播放器快照`,
      `${entry.label}（${layer === 'underlay' ? '底层' : '顶层'}实际播放器透明静态快照）`,
    )
    return
  }

  const hasSnapshotInAnotherLayer = runtimeSnapshots.has(
    runtimeSnapshotKey(entry.scope, entry.sceneId, layer === 'underlay'
      ? 'overlay'
      : 'underlay'),
  ) || runtimeSnapshots.has(entry.key)
  if (!failureMessage && (hasSnapshotInAnotherLayer || entry.layer !== layer)) {
    return
  }
  if (entry.layer !== layer) {
    warnings.push(
      `${entry.label}的${layer === 'underlay' ? '底层' : '顶层'}实际快照失败，已保留该运行时其他成功快照。`,
    )
    return
  }

  const fallback = entry.runtime.staticFallback
  if (fallback) {
    const fallbackData = resolvePptxAssetData(
      payload,
      assetFiles,
      fallback.assetId,
    )
    if (fallbackData) {
      addFullCanvasImage(
        slide,
        fallbackData,
        `${entry.label} · 静态后备`,
        `${entry.label}（${fallback.coverage === 'full-scene' ? '整页' : '运行时图层'}静态后备）`,
      )
      warnings.push(
        failureMessage || snapshotRenderingFailed
          ? `${entry.label}实际快照失败，已使用作者提供的静态后备。`
          : `${entry.label}未产生可见快照，已使用作者提供的静态后备。`,
      )
      if (fallback.coverage === 'full-scene') {
        warnings.push(
          `${entry.label}使用整页静态后备；普通对象仍保留在 PPTX 中，但该图片可能覆盖其显示。`,
        )
      }
      return
    }
    warnings.push(`${entry.label}的静态后备素材缺失，已插入警告占位。`)
    return
  }

  warnings.push(
    failureMessage || snapshotRenderingFailed
      ? `${entry.label}实际快照失败且没有可用的 staticFallback，互动视觉未被静默省略。`
      : `${entry.label}没有可用的实际快照或 staticFallback，互动视觉未被静默省略。`,
  )
}

function addPptxWarnings(slide: PptxSlide, warnings: string[]): void {
  if (warnings.length === 0) return
  const uniqueWarnings = [...new Set(warnings)]
  const text = `静态导出提示：${uniqueWarnings.join(' ')}`
  const height = Math.min(1.15, 0.36 + uniqueWarnings.length * 0.18)
  slide.addText(text, {
    x: 0.15,
    y: WIDE_SLIDE_HEIGHT - height - 0.08,
    w: WIDE_SLIDE_WIDTH - 0.3,
    h: height,
    objectName: '静态导出警告',
    margin: 5,
    fontFace: 'Microsoft YaHei',
    fontSize: 10,
    bold: true,
    color: '7C2D12',
    fill: { color: 'FEF3C7', transparency: 4 },
    line: { color: 'F59E0B', width: 1.25 },
    fit: 'shrink',
    valign: 'middle',
  })
  slide.addNotes(text)
}

function sceneHasVisibleExternalComponent(
  project: ExportPayload['project'],
  scene: ExportPayload['project']['scenes'][number],
): boolean {
  if (materializeScene(scene).nodes.some((node) => (
    node.type === 'external-component' && node.visible
  ))) {
    return true
  }
  return visibleGlobalLayerItemsForScene(project, scene.id).some(
    (item) => item.node.type === 'external-component',
  )
}

function addSuccessfulComponentStaticHint(slide: PptxSlide): void {
  const text = '静态导出提示：本页互动组件已转为静态快照，播放交互不会进入 PPTX。'
  slide.addText(text, {
    x: 0.15,
    y: WIDE_SLIDE_HEIGHT - 0.5,
    w: WIDE_SLIDE_WIDTH - 0.3,
    h: 0.42,
    objectName: '导出差异说明',
    margin: 3,
    fontFace: 'Microsoft YaHei',
    fontSize: 8.5,
    bold: true,
    color: '7C2D12',
    fill: { color: 'FEF3C7', transparency: 5 },
    line: { color: 'F59E0B', width: 0.75 },
    fit: 'shrink',
    valign: 'middle',
  })
  slide.addNotes(text)
}

export async function buildPptx(
  payload: ExportPayload,
  assetFiles: Record<string, Uint8Array>,
  options: BuildPptxOptions = {},
): Promise<Uint8Array> {
  assertExportPayloadDependencies(payload)
  const project = payload.project
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = APP_NAME
  pptx.subject = '互动课件可编辑素材导出'
  pptx.title = project.title
  pptx.company = APP_COMPANY
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
  }
  const scale: CanvasScale = {
    x: WIDE_SLIDE_WIDTH / project.canvas.width,
    y: WIDE_SLIDE_HEIGHT / project.canvas.height,
  }
  let componentSnapshots = options.componentSnapshots ?? new Map<string, string>()
  const componentSnapshotFailures = new Map(
    options.componentSnapshotFailures ?? [],
  )
  let componentSnapshotRenderingFailed = false
  const hasVisibleComponents = project.scenes.some((scene) =>
    materializeScene(scene).nodes.some((node) => node.type === 'external-component' && node.visible) ||
    visibleGlobalLayerItemsForScene(project, scene.id).some(
      (item) => item.node.type === 'external-component',
    ),
  )
  if (
    options.componentSnapshots === undefined &&
    !options.skipSnapshotRendering &&
    hasVisibleComponents
  ) {
    try {
      const { renderPptxComponentSnapshots } = await import(
        './renderPptxComponentSnapshots'
      )
      componentSnapshots = await renderPptxComponentSnapshots(payload, {
        onFailure(failure) {
          const reason = snapshotErrorMessage(failure.error)
          componentSnapshotFailures.set(failure.snapshotKey, reason)
          console.warn(
            `PPTX 互动组件“${failure.label}”快照生成失败，将仅回退该实例`,
            failure.error,
          )
        },
      })
    } catch (error) {
      componentSnapshotRenderingFailed = true
      console.warn(
        'PPTX 互动组件快照生成失败，将导出可选择的占位对象',
        error,
      )
      options.onWarning?.('PPTX 互动组件快照生成失败，已使用可选择的占位对象。')
    }
  }

  let runtimeSnapshots = options.runtimeSnapshots ?? new Map<string, string>()
  const runtimeSnapshotFailures = new Map(
    options.runtimeSnapshotFailures ?? [],
  )
  let runtimeSnapshotRenderingFailed = false
  const hasEnabledRuntimes = project.globalRuntime?.enabled === true ||
    project.scenes.some((scene) => scene.runtime?.enabled)
  if (
    options.runtimeSnapshots === undefined &&
    !options.skipSnapshotRendering &&
    hasEnabledRuntimes
  ) {
    try {
      const { renderPptxRuntimeSnapshots } = await import(
        './renderPptxRuntimeSnapshots'
      )
      runtimeSnapshots = await renderPptxRuntimeSnapshots(payload, {
        onFailure(failure) {
          const reason = snapshotErrorMessage(failure.error)
          runtimeSnapshotFailures.set(failure.snapshotKey, reason)
          console.warn(
            `PPTX ${failure.label}${failure.layer ? `（${failure.layer === 'underlay' ? '底层' : '顶层'}）` : ''}快照生成失败，将仅回退该条目`,
            failure.error,
          )
        },
      })
    } catch (error) {
      runtimeSnapshotRenderingFailed = true
      console.warn(
        'PPTX 自由运行时实际快照生成失败，将使用静态后备或警告占位',
        error,
      )
      options.onWarning?.(
        'PPTX 自由运行时实际快照生成失败，已使用静态后备或警告占位。',
      )
    }
  }

  const imageCache = new Map<string, PptxImageCacheEntry>()
  const addEditableNode = async (
    slide: PptxSlide,
    node: SceneNode,
    sceneId: string,
    warnings: string[],
    globalItem = false,
  ): Promise<void> => {
    if (!node.visible) return
    if (node.type === 'text') {
      addPptxTextNode(slide, node, scale)
    } else if (node.type === 'formula') {
      addPptxFormulaNode(slide, node, scale)
    } else if (node.type === 'shape') {
      addPptxShapeNode(slide, node, scale)
    } else if (node.type === 'image') {
      await addPptxImageNode(
        slide,
        node,
        payload,
        assetFiles,
        imageCache,
        scale,
      )
    } else if (node.type === 'video') {
      slide.addText(`▶  视频\n${project.assets[node.assetId]?.filename ?? node.name}`, {
        ...pptxNodePosition(node, scale),
        color: 'F8FAFC',
        fill: { color: '0B1120' },
        line: { color: '475569', width: 1 },
        align: 'center',
        valign: 'middle',
        fontFace: 'Microsoft YaHei',
        fontSize: 16,
        rotate: node.rotation,
        transparency: Math.round((1 - node.opacity) * 100),
        objectName: `${node.name} · 视频封面`,
      })
    } else if (node.type === 'teacher-controller') {
      if (!node.includeInStaticExports) return
      slide.addText(node.title, {
        ...pptxNodePosition(node, scale),
        color: pptxColor(node.style.textColor, 'F8FAFC'),
        fill: {
          color: pptxColor(node.style.backgroundColor, '172033'),
          transparency: Math.round((1 - node.style.backgroundOpacity) * 100),
        },
        line: { color: pptxColor(node.style.accentColor, 'E7B85C'), width: 1 },
        align: 'center',
        valign: 'middle',
        fontFace: 'Microsoft YaHei',
        fontSize: 13,
        rotate: node.rotation,
        objectName: `${node.name} · 教师控制器`,
      })
    } else {
      const snapshotKey = globalItem
        ? pptxGlobalComponentSnapshotKey(sceneId, node.id)
        : pptxComponentSnapshotKey(sceneId, node.id)
      addPptxComponentNode(
        slide,
        node,
        sceneId,
        componentSnapshots,
        scale,
        snapshotKey,
      )
      const failure = componentSnapshotFailures.get(snapshotKey)
      if (
        !componentSnapshots.has(snapshotKey) &&
        (failure || componentSnapshotRenderingFailed)
      ) {
        warnings.push(
          `互动组件“${node.name}”实际快照失败，已使用该实例的可选择占位对象。`,
        )
      }
    }
  }
  try {
    for (const scene of project.scenes) {
      const renderedScene = materializeScene(scene)
      const slide = pptx.addSlide()
      const warnings: string[] = []
      slide.background = {
        color: pptxColor(renderedScene.backgroundColor, 'FFFFFF'),
      }

      if (renderedScene.backgroundAssetId) {
        const backgroundData = resolvePptxAssetData(
          payload,
          assetFiles,
          renderedScene.backgroundAssetId,
        )
        if (backgroundData) {
          addFullCanvasImage(
            slide,
            backgroundData,
            `场景背景 · ${scene.id}`,
            `${scene.name}（可编辑背景图片）`,
          )
        } else {
          warnings.push(`场景“${scene.name}”的背景图片缺失。`)
        }
      }

      const runtimeEntries = runtimeEntriesForScene(project, scene)
      for (const item of visibleGlobalLayerItemsForScene(
        project,
        scene.id,
        'underlay',
      )) {
        await addEditableNode(slide, item.node, scene.id, warnings, true)
      }
      for (const entry of runtimeEntries.filter(({ scope }) => scope === 'global')) {
        addRuntimeLayer(
          slide,
          entry,
          'underlay',
          payload,
          assetFiles,
          runtimeSnapshots,
          runtimeSnapshotFailures,
          runtimeSnapshotRenderingFailed,
          warnings,
        )
      }
      for (const entry of runtimeEntries.filter(({ scope }) => scope === 'scene')) {
        addRuntimeLayer(
          slide,
          entry,
          'underlay',
          payload,
          assetFiles,
          runtimeSnapshots,
          runtimeSnapshotFailures,
          runtimeSnapshotRenderingFailed,
          warnings,
        )
      }

      for (const node of renderedScene.nodes) {
        await addEditableNode(slide, node, scene.id, warnings)
      }

      for (const entry of runtimeEntries.filter(({ scope }) => scope === 'scene')) {
        addRuntimeLayer(
          slide,
          entry,
          'overlay',
          payload,
          assetFiles,
          runtimeSnapshots,
          runtimeSnapshotFailures,
          runtimeSnapshotRenderingFailed,
          warnings,
        )
      }
      for (const item of visibleGlobalLayerItemsForScene(
        project,
        scene.id,
        'overlay',
      )) {
        await addEditableNode(slide, item.node, scene.id, warnings, true)
      }
      for (const entry of runtimeEntries.filter(({ scope }) => scope === 'global')) {
        addRuntimeLayer(
          slide,
          entry,
          'overlay',
          payload,
          assetFiles,
          runtimeSnapshots,
          runtimeSnapshotFailures,
          runtimeSnapshotRenderingFailed,
          warnings,
        )
      }
      if (runtimeSnapshotRenderingFailed && runtimeEntries.length > 0) {
        warnings.push('实际播放器运行时快照生成失败。')
      }
      for (const warning of warnings) {
        console.warn(`PPTX 第 ${project.scenes.indexOf(scene) + 1} 页：${warning}`)
        options.onWarning?.(warning)
      }
      addPptxWarnings(slide, warnings)
      if (warnings.length === 0 && sceneHasVisibleExternalComponent(project, scene)) {
        addSuccessfulComponentStaticHint(slide)
      }
    }
    const output = await pptx.write({
      outputType: 'arraybuffer',
      compression: true,
    })
    return new Uint8Array(output as ArrayBuffer)
  } finally {
    releasePptxImageCache(imageCache)
  }
}
