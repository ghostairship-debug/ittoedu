import { componentSurface } from '../../shared/contracts/component-platform/project'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { applyComponentBackgroundPaint, componentBackgroundAssetIds } from '../../shared/componentBackgroundPaint'
import { isComponentVisibleAtSurface, resolveComponentBackground, resolveComponentPresentation } from '../../shared/contracts/component-platform/project'
import type { ComponentInstance, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { IDENTITY_MATRIX, multiplyMatrices, type AffineMatrix } from '../../core/components/geometry'
import { applyComponentPaintStyle } from '../../player/components/componentPlacementStyle'
import { componentFrameStyle } from '../../player/surfaces/spatial/componentSpatialAdapter'
import { formulaComponentDataSchema, textComponentDataSchema } from '../../components/text/data'
import { renderFormulaComponent, renderTextComponent, applyTextComponentLayout, measureTextComponent } from '../../components/text/render'
import { shapeDataSchema } from '../../components/shape/data'
import { renderShape } from '../../components/shape/render'
import { parseTableData } from '../../components/table/data'
import { renderTableSvg } from '../../components/table/render'
import { chartDataSchema } from '../../components/chart/data'
import { renderChart } from '../../components/chart/render'
import { imageDataSchema } from '../../components/image/data'
import { renderImageNodeCanvas } from '../../shared/imageEffects'
import type { ImageNode } from '../../shared/contracts/native-v1/types'
import { useEditorStore } from '../store/editorStore'
import { retainAssetObjectUrls, useAssetObjectUrls } from './useAssetObjectUrls'
import { elementTextFontRequests, prepareTextFonts } from '../../shared/fonts/ensureBundledFonts'

const EMPTY_FILES: Record<string, Uint8Array> = {}
const EMPTY_MIMES: Record<string, string> = {}
interface ThumbnailInput {
  dependencies: readonly unknown[]
  project: CourseProjectV10
  files: Record<string, Uint8Array>
  mimeTypes: Record<string, string>
}
/** Only the static painter's actual tree and resources belong to this thumbnail. */
function thumbnailInput(project: CourseProjectV10, surfaceId: string, assets: Readonly<Record<string, Uint8Array>> | undefined,
  previous: ThumbnailInput | null): ThumbnailInput | null {
  const surface = componentSurface(project, surfaceId)
  if (!surface) return null
  const stateId = surface.presentation?.thumbnailStateId ?? surface.presentation?.initialStateId ?? null
  const state = surface.kind === 'slide' ? surface.presentation?.states.find(value => value.id === stateId) : undefined
  const dependencies: unknown[] = [surfaceId, project.background, ...project.global.underlay, null, ...project.global.overlay]
  const instances: CourseProjectV10['instances'] = Object.create(null), definitions: CourseProjectV10['definitions'] = Object.create(null)
  const assetIds = new Set(componentBackgroundAssetIds(resolveComponentBackground(project, surface, state)))
  const seen = new Set<string>()
  const visit = (id: string, parentPaints = true, root = false) => {
    if (seen.has(id)) return
    seen.add(id)
    const instance = project.instances[id], definition = instance && project.definitions[instance.definitionId]
    dependencies.push(id, instance, definition)
    if (!instance) return
    instances[id] = instance
    if (definition) definitions[instance.definitionId] = definition
    const implementation = instance.implementationOverride ?? definition?.implementation
    const override = state?.overrides[id], data = override && 'data' in override ? override.data : instance.data
    const paints = root || parentPaints && Boolean(definition) && definition?.role !== 'behavior'
      && isComponentVisibleAtSurface({ visible: override?.visible ?? instance.visible, visibility: instance.visibility }, surfaceId)
    if (paints && implementation?.kind === 'builtin' && implementation.key === 'guoling.image' && data && typeof data === 'object'
      && !Array.isArray(data) && typeof data.assetId === 'string') assetIds.add(data.assetId)
    instance.childIds?.forEach(child => visit(child, paints))
  }
  visit(surfaceId, true, true); project.global.underlay.forEach(id => visit(id)); project.global.overlay.forEach(id => visit(id))
  const files: Record<string, Uint8Array> = Object.create(null), mimeTypes: Record<string, string> = Object.create(null)
  const metadata: CourseProjectV10['assets'] = Object.create(null)
  for (const id of assetIds) {
    dependencies.push(id, assets?.[id], project.assets[id]?.mimeType)
    if (assets?.[id]) files[id] = assets[id]
    if (project.assets[id]) metadata[id] = project.assets[id]
    mimeTypes[id] = project.assets[id]?.mimeType ?? 'application/octet-stream'
  }
  if (previous && previous.dependencies.length === dependencies.length
    && dependencies.every((value, index) => value === previous.dependencies[index])) return previous
  // Keep this page's borrowed author objects, rather than retaining an old whole-work root.
  const scoped: CourseProjectV10 = { schemaVersion: project.schemaVersion, id: project.id, revision: project.revision, title: project.title,
    rootIds: [surfaceId], instances, definitions, assets: metadata,
    global: { underlay: project.global.underlay, overlay: project.global.overlay }, ...(project.background ? { background: project.background } : {}) }
  return { dependencies, project: resolveComponentPresentation(scoped, surfaceId, stateId), files, mimeTypes }
}

/** Static thumbnail rendering reuses professional paint functions and never mounts a runtime world. */
export function SceneThumbnail({ locationId }: { locationId?: string; scene?: object } = {}) {
  const authorProject = useEditorStore(state => state.courseView.project)
  const surfaceId = useEditorStore(state => locationId ?? state.courseView.surfaceId)
  const resources = useEditorStore(state => state.courseView.views.find(item => item.documentId === state.courseView.activeDocumentId)?.model.resources
    ?? state.courseView.snapshot?.model.resources)
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const source = authorProject && surfaceId ? componentSurface(authorProject, surfaceId) : undefined
  const previous = useRef<ThumbnailInput | null>(null)
  const input = useMemo(() => {
    const next = visible && authorProject && surfaceId ? thumbnailInput(authorProject, surfaceId, resources?.assets, previous.current) : null
    previous.current = next; return next
  }, [authorProject, surfaceId, resources, visible])
  const urls = useAssetObjectUrls(visible && input ? input.files : EMPTY_FILES, visible && input ? input.mimeTypes : EMPTY_MIMES)
  const size = source?.designSize ?? { width: 1280, height: 720 }
  const [viewport, setViewport] = useState(() => ({ width: 160, height: 160 * size.height / size.width, resolution: 160 / size.width }))
  useEffect(() => {
    const element = host.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.target === element) setVisible(entry.isIntersecting) }, { rootMargin: '240px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const element = host.current
    if (!visible || !element) return
    const measure = () => {
      const width = element.clientWidth || 160, height = element.clientHeight || width * size.height / size.width
      const resolution = Math.min(width / size.width, height / size.height) * (element.ownerDocument.defaultView?.devicePixelRatio || 1)
      setViewport(current => current.width === width && current.height === height && current.resolution === resolution ? current : { width, height, resolution })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    const view = element.ownerDocument.defaultView
    view?.addEventListener('resize', measure)
    return () => { observer?.disconnect(); view?.removeEventListener('resize', measure) }
  }, [visible, size.width, size.height])
  useEffect(() => {
    const element = host.current, project = input?.project, surface = project && surfaceId ? componentSurface(project, surfaceId) : undefined
    if (!element || !visible || !project || !surface) return
    let disposed = false
    const releaseUrls = retainAssetObjectUrls(urls)
    const assetUrl = (id: string): string | null => urls[id] ?? null
    const dom = element.ownerDocument
    const size = surface.designSize ?? { width: 1280, height: 720 }
    const background = resolveComponentBackground(project, surface)
    const page = dom.createElement('div')
    Object.assign(page.style, { position: 'absolute', left: '0', top: '0', width: size.width + 'px', height: size.height + 'px',
      transformOrigin: '0 0', pointerEvents: 'none', overflow: 'hidden' })
    applyComponentBackgroundPaint(page, background, id => assetUrl(id) ?? undefined)
    const diagnostics: string[] = []
    const label = (target: HTMLElement, instance: ComponentInstance, reason: string) => {
      target.dataset.thumbnailDiagnostic = reason
      const definition = project.definitions[instance.definitionId]
      target.textContent = definition?.title ?? instance.name ?? instance.definitionId
      Object.assign(target.style, { border: '1px solid #5b9cff', background: '#e6efff', color: '#244778', display: 'grid', placeItems: 'center', fontSize: '20px', overflow: 'hidden' })
      diagnostics.push((definition?.title ?? instance.definitionId) + '：' + reason)
      element.title = diagnostics.join('\n')
    }
    const paint = (id: string, parent: HTMLElement, parentToSurface: AffineMatrix) => {
      const instance = project.instances[id], definition = instance && project.definitions[instance.definitionId]
      if (!instance || !definition || !isComponentVisibleAtSurface(instance, surface.id) || definition.role === 'behavior') return
      const wrapper = dom.createElement('div'), content = dom.createElement('div')
      applyComponentPaintStyle(wrapper, instance, definition)
      Object.assign(wrapper.style, componentFrameStyle(instance.frame))
      Object.assign(content.style, { width: '100%', height: '100%' })
      wrapper.append(content); parent.append(wrapper)
      const implementation = instance.implementationOverride ?? definition.implementation
      const width = instance.frame?.width ?? 320, height = instance.frame?.height ?? 160
      const toSurface = instance.frame ? multiplyMatrices(parentToSurface, instance.frame.transform) : parentToSurface
      const resolution = viewport.resolution * Math.max(Math.hypot(toSurface[0], toSurface[1]), Math.hypot(toSurface[2], toSurface[3]))
      try {
        if (implementation.kind === 'source') label(content, instance, '源码组件的静态缩略图；实际效果见预览')
        else if (implementation.key === 'guoling.text') {
          const data = textComponentDataSchema.parse(instance.data), text = renderTextComponent(dom, data)
          content.append(text)
          const measure = () => {
            if (disposed || !instance.frame) return
            try { applyTextComponentLayout(text, measureTextComponent(text, instance.frame, data.sizing)) }
            catch (error) { label(content, instance, error instanceof Error ? error.message : '文字预览量度失败') }
          }
          const pending = prepareTextFonts(elementTextFontRequests(text), dom.fonts)
          if (pending) void pending.then(measure, error => {
            if (disposed) return
            diagnostics.push((definition.title ?? instance.id) + '：文字字体准备失败，保留作者框尺寸')
            element.title = diagnostics.join('\n')
            console.warn('缩略图文字字体准备失败，保留作者框尺寸', error)
          })
          else measure()
        } else if (implementation.key === 'guoling.formula') content.append(renderFormulaComponent(dom, formulaComponentDataSchema.parse(instance.data)))
        else if (implementation.key === 'guoling.shape') {
          const canvas = dom.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(width * resolution)); canvas.height = Math.max(1, Math.ceil(height * resolution))
          Object.assign(canvas.style, { width: '100%', height: '100%' })
          const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 不可用')
          context.scale(canvas.width / width, canvas.height / height)
          renderShape(context, shapeDataSchema.parse(instance.data), { width, height }); content.append(canvas)
        } else if (implementation.key === 'guoling.table') content.innerHTML = renderTableSvg(parseTableData(instance.data), width, height, instance.id)
        else if (implementation.key === 'guoling.chart') content.append(renderChart(dom, chartDataSchema.parse(instance.data), width, height, instance.id))
        else if (implementation.key === 'guoling.image') {
          const data = imageDataSchema.parse(instance.data), url = assetUrl(data.assetId)
          if (!url) throw new Error('图片资源缺失')
          const image = new Image()
          image.onload = () => {
            if (disposed) return
            try {
              const node: ImageNode = { ...data, id, name: data.alt, type: 'image', x: 0, y: 0, width, height, rotation: 0, opacity: 1, visible: true, locked: false, playbackInitialVisibility: 'inherit', preserveAspectRatio: true, safeAreas: [] }
              const canvas = renderImageNodeCanvas(image, image.naturalWidth, image.naturalHeight, node, width, height, resolution)
              Object.assign(canvas.style, { width: '100%', height: '100%' }); content.replaceChildren(canvas)
            } catch (error) { label(content, instance, error instanceof Error ? error.message : '图片预览失败') }
          }
          image.onerror = () => { if (!disposed) label(content, instance, '图片预览无法解码') }
          image.src = url
        } else if (implementation.key !== 'guoling.group') label(content, instance, '此组件的静态缩略图；实际效果见预览')
      } catch (error) { label(content, instance, error instanceof Error ? error.message : '组件预览失败') }
      instance.childIds?.forEach(child => paint(child, wrapper, toSurface))
    }
    element.replaceChildren(page)
    project.global.underlay.forEach(id => paint(id, page, IDENTITY_MATRIX)); surface.childIds.forEach(id => paint(id, page, IDENTITY_MATRIX)); project.global.overlay.forEach(id => paint(id, page, IDENTITY_MATRIX))
    const scale = Math.min(viewport.width / size.width, viewport.height / size.height)
    page.style.transform = 'translate(' + (viewport.width - size.width * scale) / 2 + 'px,' + (viewport.height - size.height * scale) / 2 + 'px) scale(' + scale + ')'
    element.title = diagnostics.join('\n')
    return () => { disposed = true; releaseUrls(); page.remove() }
  }, [input, surfaceId, urls, visible, viewport])
  const ratio = source?.designSize ?? { width: 1280, height: 720 }
  return <div ref={host} className="scene-thumbnail" style={{ position: 'relative', aspectRatio: ratio.width + '/' + ratio.height, overflow: 'hidden' }} aria-hidden="true" />
}
