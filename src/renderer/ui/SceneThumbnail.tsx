import { useEffect, useMemo, useRef, useState } from 'react'
import { materializeNativeLayerItem } from '../../shared/courseProjectSchema'
import { renderShapeCanvas } from '../../shared/canvasShapeRenderer'
import { renderFormulaNodeCanvas } from '../../shared/formulaRenderer'
import { renderImageNodeCanvas } from '../../shared/imageEffects'
import { renderTextNodeCanvas } from '../../shared/textLayout'
import { buildSlideEditorView, resolveSlideThumbnailStateId } from '../../core/tools/slideLayerView'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '../store/editorStore'
import { buildSceneThumbnailComposition } from './sceneThumbnailComposition'
import { courseSlideCanvas, DEFAULT_SLIDE_CANVAS } from '../../shared/slideCanvas'

const THUMB_WIDTH = 160

export function SceneThumbnail(props: {
  locationId?: string
  /**
   * Out-of-scope callers may still pass a V8 scene. Drawing always uses the
   * active Course Project V9 document and thumbnail state.
   */
  scene?: object
} = {}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [shouldRender, setShouldRender] = useState(false)
  const document = useEditorStore(selectActiveCourseProjectDocument)
  const storeLocationId = useEditorStore(selectActiveCourseLocationId)
  const locationId = props.locationId ?? storeLocationId
  const assets = document?.assets ?? {}
  const assetFiles = useEditorStore(selectMediaAssetFiles)
  const components = useEditorStore((state) => state.componentPackages)
  const thumbnailStateId = useMemo(() => {
    if (!document || !locationId) return null
    const location = document.locations.find((candidate) => candidate.id === locationId)
    if (!location || location.kind !== 'slide-scene') return null
    return resolveSlideThumbnailStateId(document, locationId)
  }, [document, locationId])
  const slideView = useMemo(() => {
    if (!document || !locationId) return null
    const location = document.locations.find((candidate) => candidate.id === locationId)
    if (!location || location.kind !== 'slide-scene') return null
    return buildSlideEditorView({
      project: document,
      locationId,
      stateId: thumbnailStateId,
    })
  }, [document, locationId, thumbnailStateId])
  const canvasSize = document ? courseSlideCanvas(document) : DEFAULT_SLIDE_CANVAS
  const thumbHeight = Math.max(1, Math.round(THUMB_WIDTH * canvasSize.height / canvasSize.width))
  const scale = THUMB_WIDTH / canvasSize.width
  const composition = useMemo(() => {
    if (!document || !locationId || !slideView) return []
    return buildSceneThumbnailComposition({
      project: document,
      locationId,
      stateId: thumbnailStateId,
    })
  }, [document, locationId, slideView, thumbnailStateId])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (typeof IntersectionObserver === 'undefined') {
      setShouldRender(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setShouldRender(true)
        observer.disconnect()
      },
      { rootMargin: '240px 0px' },
    )
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldRender) return
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    let disposed = false
    const urls: string[] = []
    const draw = async () => {
      context.clearRect(0, 0, THUMB_WIDTH, thumbHeight)
      context.fillStyle = slideView?.backgroundColor ?? '#ffffff'
      context.fillRect(0, 0, THUMB_WIDTH, thumbHeight)
      const backgroundAssetId = slideView?.backgroundAssetId
      if (backgroundAssetId) {
        const meta = assets[backgroundAssetId]
        const bytes = assetFiles[backgroundAssetId]
        if (meta && bytes) {
          const url = URL.createObjectURL(new Blob(
            [Uint8Array.from(bytes)],
            { type: meta.mimeType },
          ))
          urls.push(url)
          const image = new Image()
          image.src = url
          try {
            await image.decode()
            if (disposed) return
            const sourceWidth = image.naturalWidth || meta.width || THUMB_WIDTH
            const sourceHeight = image.naturalHeight || meta.height || thumbHeight
            const scale = Math.max(THUMB_WIDTH / sourceWidth, thumbHeight / sourceHeight)
            const width = sourceWidth * scale
            const height = sourceHeight * scale
            context.drawImage(image, (THUMB_WIDTH - width) / 2, (thumbHeight - height) / 2, width, height)
          } catch {
            // The authored background colour remains a visible fallback.
          }
        }
      }
      for (const entry of composition) {
        if (disposed) break
        if (entry.kind === 'runtime-fallback') {
          const { fallback } = entry
          const meta = assets[fallback.assetId]
          const bytes = assetFiles[fallback.assetId]
          if (!meta || !bytes) continue
          const url = URL.createObjectURL(new Blob(
            [Uint8Array.from(bytes)],
            { type: meta.mimeType },
          ))
          urls.push(url)
          const image = new Image()
          image.src = url
          try {
            await image.decode()
            if (disposed) break
            context.save()
            context.globalAlpha = 1
            if (fallback.coverage === 'scene') {
              // A full-scene fallback replaces everything below its authored
              // layer; a surface fallback preserves those editable nodes.
              context.clearRect(0, 0, THUMB_WIDTH, thumbHeight)
            }
            context.drawImage(image, 0, 0, THUMB_WIDTH, thumbHeight)
            context.restore()
          } catch {
            // Missing runtime fallback assets leave the editable thumbnail intact.
          }
          continue
        }

        const { item } = entry
        if (item.kind === 'native') {
          const node = materializeNativeLayerItem(item)
          const renderedText = node.type === 'text'
            ? renderTextNodeCanvas(node, node.width, scale)
            : null
          const renderedFormula = node.type === 'formula'
            ? renderFormulaNodeCanvas(node, node.width, node.height, scale)
            : null
          const visualWidth = renderedText?.width ?? renderedFormula?.width ?? node.width
          const visualHeight = renderedText?.height ?? renderedFormula?.height ?? node.height
          context.save()
          context.translate(
            (node.x + visualWidth / 2) * scale,
            (node.y + visualHeight / 2) * scale,
          )
          context.rotate((node.rotation * Math.PI) / 180)
          context.globalAlpha = node.opacity
          if (node.type === 'shape') {
            context.scale(scale, scale)
            context.translate(-node.width / 2, -node.height / 2)
            renderShapeCanvas(context, node)
          } else if (node.type === 'text') {
            context.drawImage(
              renderedText!.canvas,
              -renderedText!.width * scale / 2,
              -renderedText!.height * scale / 2,
              renderedText!.width * scale,
              renderedText!.height * scale,
            )
          } else if (node.type === 'formula') {
            context.drawImage(
              renderedFormula!.canvas,
              -renderedFormula!.width * scale / 2,
              -renderedFormula!.height * scale / 2,
              renderedFormula!.width * scale,
              renderedFormula!.height * scale,
            )
          } else if (node.type === 'image') {
            const meta = assets[node.assetId]
            const bytes = assetFiles[node.assetId]
            if (meta && bytes) {
              const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: meta.mimeType }))
              urls.push(url)
              const image = new Image()
              image.src = url
              try {
                await image.decode()
                if (!disposed) {
                  const rendered = renderImageNodeCanvas(
                    image,
                    image.naturalWidth || meta.width || node.width,
                    image.naturalHeight || meta.height || node.height,
                    node,
                    node.width,
                    node.height,
                    scale,
                  )
                  context.drawImage(rendered, -node.width * scale / 2, -node.height * scale / 2, node.width * scale, node.height * scale)
                }
              } catch {
                // Missing thumbnails remain represented by the empty frame.
              }
            }
          } else if (node.type === 'video') {
            const width = node.width * scale
            const height = node.height * scale
            context.fillStyle = '#0b1120'
            context.fillRect(-width / 2, -height / 2, width, height)
            context.fillStyle = '#f8fafc'
            context.beginPath()
            context.moveTo(-4, -7)
            context.lineTo(9, 0)
            context.lineTo(-4, 7)
            context.closePath()
            context.fill()
          } else {
            const width = node.width * scale
            const height = node.height * scale
            context.fillStyle = '#f8fafc'
            context.strokeStyle = '#cbd5e1'
            context.lineWidth = 1
            context.fillRect(-width / 2, -height / 2, width, height)
            context.strokeRect(-width / 2, -height / 2, width, height)
          }
          context.restore()
          continue
        }

        const width = item.frame.width * scale
        const height = item.frame.height * scale
        const component = item.kind === 'component'
          ? components[item.component.packageId]
          : undefined
        const thumbnailUrl = component?.thumbnailUrl
        context.save()
        context.translate(
          (item.frame.x + item.frame.width / 2) * scale,
          (item.frame.y + item.frame.height / 2) * scale,
        )
        context.rotate((item.rotation * Math.PI) / 180)
        context.globalAlpha = item.opacity
        context.fillStyle = '#151d2b'
        context.fillRect(-width / 2, -height / 2, width, height)
        let thumbnailDrawn = false
        if (thumbnailUrl) {
          const image = new Image()
          image.src = thumbnailUrl
          try {
            await image.decode()
            if (!disposed) {
              const naturalWidth = image.naturalWidth || item.frame.width
              const naturalHeight = image.naturalHeight || item.frame.height
              const fit = Math.min(width / naturalWidth, height / naturalHeight)
              const drawWidth = naturalWidth * fit
              const drawHeight = naturalHeight * fit
              context.drawImage(
                image,
                -drawWidth / 2,
                -drawHeight / 2,
                drawWidth,
                drawHeight,
              )
              thumbnailDrawn = true
            }
          } catch {
            // Fall through to the labelled component frame below.
          }
        }
        context.strokeStyle = 'rgba(91, 156, 255, 0.8)'
        context.lineWidth = 1
        context.strokeRect(-width / 2, -height / 2, width, height)
        if (!thumbnailDrawn) {
          context.fillStyle = '#cfe1ff'
          context.font = '600 8px "Microsoft YaHei", sans-serif'
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillText(
            component?.manifest.name ?? item.label,
            0,
            0,
            Math.max(12, width - 8),
          )
        }
        context.restore()
      }
    }
    void draw()
    return () => {
      disposed = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [assetFiles, assets, components, composition, scale, shouldRender, slideView, thumbHeight])

  return <canvas ref={ref} className="scene-thumbnail" width={THUMB_WIDTH} height={thumbHeight} aria-hidden="true" />
}
