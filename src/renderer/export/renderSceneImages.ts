import type { ProjectDocument, SceneDocument, SceneNode } from '../../shared/projectTypes'
import { renderShapeCanvas } from '../../shared/canvasShapeRenderer'
import { renderFormulaNodeCanvas } from '../../shared/formulaRenderer'
import { renderImageNodeCanvas } from '../../shared/imageEffects'
import { renderTextNodeCanvas } from '../../shared/textLayout'
import type { ExportPayload } from '../../shared/componentTypes'
import { materializeScene } from '../../shared/presentation'
import {
  runtimeEntriesForScene,
  visibleGlobalLayerItemsForScene,
} from './exportPayloadSupport'

interface LoadedImage {
  image: HTMLImageElement
  url?: string
}

export interface StaticSceneRenderOptions {
  payload?: ExportPayload
  captureFailure?: string
}

async function loadImage(bytes: Uint8Array, mimeType: string): Promise<LoadedImage> {
  const copy = Uint8Array.from(bytes)
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }))
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    return { image, url }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

async function loadDataUrlImage(dataUrl: string): Promise<LoadedImage> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  return { image }
}

function drawMissingNode(context: CanvasRenderingContext2D, node: SceneNode, label: string): void {
  context.fillStyle = '#fff1f2'
  context.strokeStyle = '#ef4444'
  context.lineWidth = 2
  context.fillRect(-node.width / 2, -node.height / 2, node.width, node.height)
  context.strokeRect(-node.width / 2, -node.height / 2, node.width, node.height)
  context.fillStyle = '#991b1b'
  context.font = `${Math.max(14, Math.min(24, node.height / 5))}px "Microsoft YaHei", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, 0, 0, Math.max(20, node.width - 20))
}

export async function renderSceneCanvas(
  project: ProjectDocument,
  scene: SceneDocument,
  assetFiles: Record<string, Uint8Array>,
  resolution = 1,
  options: StaticSceneRenderOptions = {},
): Promise<HTMLCanvasElement> {
  const renderedScene = materializeScene(scene)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(project.canvas.width * resolution)
  canvas.height = Math.round(project.canvas.height * resolution)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建导出画布')
  context.scale(resolution, resolution)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = renderedScene.backgroundColor
  context.fillRect(0, 0, project.canvas.width, project.canvas.height)

  const loaded = new Map<string, LoadedImage>()
  const warnings: string[] = []
  try {
    const assetMeta = (assetId: string) => project.assets[assetId]
      ?? Object.values(project.assets).find((meta) => meta.id === assetId)

    const sourceFor = async (assetId: string): Promise<LoadedImage | null> => {
      const cached = loaded.get(assetId)
      if (cached) return cached
      const meta = assetMeta(assetId)
      if (!meta) return null
      const embedded = options.payload?.assets[assetId]?.dataUrl
      const bytes = assetFiles[assetId]
      let source: LoadedImage | null = null
      try {
        if (embedded?.startsWith('data:')) {
          source = await loadDataUrlImage(embedded)
        } else if (bytes) {
          source = await loadImage(bytes, meta.mimeType)
        }
      } catch (error) {
        console.warn(`静态导出素材“${meta.filename}”读取失败`, error)
      }
      if (source) loaded.set(assetId, source)
      return source
    }

    const drawFullCanvasAsset = async (
      assetId: string,
      label: string,
    ): Promise<boolean> => {
      const source = await sourceFor(assetId)
      if (!source) {
        warnings.push(`${label}素材缺失。`)
        return false
      }
      context.save()
      context.globalAlpha = 1
      context.drawImage(
        source.image,
        0,
        0,
        project.canvas.width,
        project.canvas.height,
      )
      context.restore()
      return true
    }

    const drawNode = async (node: SceneNode, componentLabel = '互动组件') => {
      if (!node.visible) return
      const renderedText = node.type === 'text'
        ? renderTextNodeCanvas(node, node.width, resolution)
        : null
      const renderedFormula = node.type === 'formula'
        ? renderFormulaNodeCanvas(
            node,
            node.width,
            node.height,
            resolution,
          )
        : null
      const visualWidth = renderedText?.width ?? renderedFormula?.width ?? node.width
      const visualHeight = renderedText?.height ?? renderedFormula?.height ?? node.height
      context.save()
      context.translate(
        node.x + visualWidth / 2,
        node.y + visualHeight / 2,
      )
      context.rotate((node.rotation * Math.PI) / 180)
      context.globalAlpha = node.opacity
      if (node.type === 'text') {
        context.drawImage(
          renderedText!.canvas,
          -renderedText!.width / 2,
          -renderedText!.height / 2,
          renderedText!.width,
          renderedText!.height,
        )
      } else if (node.type === 'formula') {
        context.drawImage(
          renderedFormula!.canvas,
          -renderedFormula!.width / 2,
          -renderedFormula!.height / 2,
          renderedFormula!.width,
          renderedFormula!.height,
        )
      } else if (node.type === 'shape') {
        context.translate(-node.width / 2, -node.height / 2)
        renderShapeCanvas(context, node)
      } else if (node.type === 'image') {
        const meta = assetMeta(node.assetId)
        const source = await sourceFor(node.assetId)
        if (!meta || !source) {
          drawMissingNode(context, node, '图片缺失')
        } else {
          const rendered = renderImageNodeCanvas(
            source.image,
            source.image.naturalWidth || meta.width || node.width,
            source.image.naturalHeight || meta.height || node.height,
            node,
            node.width,
            node.height,
            resolution,
          )
          context.drawImage(rendered, -node.width / 2, -node.height / 2, node.width, node.height)
        }
      } else if (node.type === 'video') {
        const poster = node.poster.mode === 'image' && node.poster.assetId
          ? await sourceFor(node.poster.assetId)
          : null
        context.fillStyle = '#0b1120'
        context.fillRect(-node.width / 2, -node.height / 2, node.width, node.height)
        if (poster) {
          context.drawImage(poster.image, -node.width / 2, -node.height / 2, node.width, node.height)
        }
        context.fillStyle = '#f8fafc'
        context.beginPath()
        context.moveTo(-14, -22)
        context.lineTo(26, 0)
        context.lineTo(-14, 22)
        context.closePath()
        context.fill()
      } else if (node.type === 'teacher-controller') {
        if (node.includeInStaticExports) {
          context.fillStyle = node.style.backgroundColor
          context.globalAlpha *= node.style.backgroundOpacity
          context.fillRect(-node.width / 2, -node.height / 2, node.width, node.height)
          context.fillStyle = node.style.textColor
          context.font = '600 18px "Microsoft YaHei", sans-serif'
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillText(node.title, 0, 0, node.width - 24)
        }
      } else {
        drawMissingNode(context, node, `${componentLabel}：${node.name}`)
      }
      context.restore()
    }

    const drawRuntimeFallbacks = async (layer: 'underlay' | 'overlay') => {
      for (const entry of runtimeEntriesForScene(project, scene)) {
        if (entry.layer !== layer) continue
        const fallback = entry.runtime.staticFallback
        if (!fallback) {
          warnings.push(
            `${entry.label}没有实际播放器快照或 staticFallback，已显示警告占位。`,
          )
          continue
        }
        await drawFullCanvasAsset(fallback.assetId, `${entry.label}静态后备`)
      }
    }

    if (renderedScene.backgroundAssetId) {
      await drawFullCanvasAsset(renderedScene.backgroundAssetId, `场景“${scene.name}”背景`)
    }
    await drawRuntimeFallbacks('underlay')

    for (const item of visibleGlobalLayerItemsForScene(
      project,
      scene.id,
      'underlay',
    )) {
      await drawNode(item.node, '全局组件静态占位')
    }
    for (const node of renderedScene.nodes) {
      await drawNode(node)
    }
    for (const item of visibleGlobalLayerItemsForScene(
      project,
      scene.id,
      'overlay',
    )) {
      await drawNode(item.node, '全局组件静态占位')
    }
    await drawRuntimeFallbacks('overlay')

    if (options.captureFailure) {
      warnings.unshift(`实际播放器合成快照失败：${options.captureFailure}`)
    }
    if (warnings.length > 0) {
      const uniqueWarnings = [...new Set(warnings)]
      const bannerHeight = Math.min(
        132,
        Math.max(54, 34 + uniqueWarnings.length * 25),
      )
      context.save()
      context.globalAlpha = 0.97
      context.fillStyle = '#fef3c7'
      context.strokeStyle = '#f59e0b'
      context.lineWidth = 2
      context.fillRect(
        12,
        project.canvas.height - bannerHeight - 12,
        project.canvas.width - 24,
        bannerHeight,
      )
      context.strokeRect(
        12,
        project.canvas.height - bannerHeight - 12,
        project.canvas.width - 24,
        bannerHeight,
      )
      context.fillStyle = '#7c2d12'
      context.font = 'bold 18px "Microsoft YaHei", sans-serif'
      context.textAlign = 'left'
      context.textBaseline = 'top'
      const summary = `静态导出提示：${uniqueWarnings.join(' ')}`
      const maxWidth = project.canvas.width - 56
      const words = [...summary]
      let line = ''
      let y = project.canvas.height - bannerHeight + 2
      for (const word of words) {
        const candidate = line + word
        if (context.measureText(candidate).width > maxWidth && line) {
          context.fillText(line, 28, y)
          line = word
          y += 25
          if (y > project.canvas.height - 34) break
        } else {
          line = candidate
        }
      }
      if (line && y <= project.canvas.height - 34) context.fillText(line, 28, y)
      context.restore()
    }
    return canvas
  } finally {
    loaded.forEach(({ url }) => {
      if (url) URL.revokeObjectURL(url)
    })
  }
}

export async function renderProjectSceneImages(
  project: ProjectDocument,
  assetFiles: Record<string, Uint8Array>,
  resolution = 1.5,
  options: StaticSceneRenderOptions = {},
): Promise<string[]> {
  const images: string[] = []
  for (const scene of project.scenes) {
    const canvas = await renderSceneCanvas(
      project,
      scene,
      assetFiles,
      resolution,
      options,
    )
    images.push(canvas.toDataURL('image/png'))
  }
  return images
}
