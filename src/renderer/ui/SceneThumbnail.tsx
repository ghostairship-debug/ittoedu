import { useEffect, useMemo, useRef, useState } from 'react'
import { isComponentVisibleAtSurface, resolveComponentBackground, resolveComponentPresentation } from '../../shared/contracts/component-platform/project'
import type { ComponentInstance } from '../../shared/contracts/component-platform/project'
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

/** Static thumbnail rendering reuses professional paint functions and never mounts a runtime world. */
export function SceneThumbnail({ locationId }: { locationId?: string; scene?: object } = {}) {
  const view = useEditorStore(state => state.courseView)
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const surfaceId = locationId ?? view.surfaceId
  const source = view.project?.surfaces.find(surface => surface.id === surfaceId)
  const project = useMemo(() => view.project ? resolveComponentPresentation(view.project, surfaceId ?? null,
    source?.presentation?.thumbnailStateId ?? source?.presentation?.initialStateId ?? null) : null,
  [view.project, surfaceId, source?.presentation])
  const resources = view.views.find(item => item.documentId === view.activeDocumentId)?.model.resources ?? view.snapshot?.model.resources
  useEffect(() => {
    const element = host.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '240px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = host.current, surface = project?.surfaces.find(value => value.id === surfaceId)
    if (!element || !visible || !project || !surface) return
    let disposed = false
    const urls = new Map<string, string>()
    const assetUrl = (id: string): string | null => {
      if (urls.has(id)) return urls.get(id)!
      const bytes = resources?.assets[id]
      if (!bytes) return null
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: project.assets[id]?.mimeType }))
      urls.set(id, url); return url
    }
    const dom = element.ownerDocument
    const size = surface.designSize ?? { width: 1280, height: 720 }
    const background = resolveComponentBackground(project, surface)
    const page = dom.createElement('div')
    Object.assign(page.style, { position: 'absolute', left: '0', top: '0', width: size.width + 'px', height: size.height + 'px',
      transformOrigin: '0 0', pointerEvents: 'none', overflow: 'hidden', backgroundColor: background.color })
    if (background.assetId) {
      const url = assetUrl(background.assetId)
      if (url) Object.assign(page.style, { backgroundImage: 'url("' + url + '")', backgroundSize: background.fit === 'fill' ? '100% 100%' : background.fit, backgroundRepeat: 'no-repeat', backgroundPosition: 'center' })
    }
    const diagnostics: string[] = []
    const label = (target: HTMLElement, instance: ComponentInstance, reason: string) => {
      target.dataset.thumbnailDiagnostic = reason
      const definition = project.definitions[instance.definitionId]
      target.textContent = definition?.title ?? instance.name ?? instance.definitionId
      Object.assign(target.style, { border: '1px solid #5b9cff', background: '#e6efff', color: '#244778', display: 'grid', placeItems: 'center', fontSize: '20px', overflow: 'hidden' })
      diagnostics.push((definition?.title ?? instance.definitionId) + '：' + reason)
      element.title = diagnostics.join('\n')
    }
    const paint = (id: string, parent: HTMLElement) => {
      const instance = project.instances[id], definition = instance && project.definitions[instance.definitionId]
      if (!instance || !definition || !isComponentVisibleAtSurface(instance, surface.id) || definition.role === 'behavior') return
      const wrapper = dom.createElement('div'), content = dom.createElement('div')
      applyComponentPaintStyle(wrapper, instance)
      Object.assign(wrapper.style, componentFrameStyle(instance.frame))
      Object.assign(content.style, { width: '100%', height: '100%' })
      wrapper.append(content); parent.append(wrapper)
      const implementation = instance.implementationOverride ?? definition.implementation
      const width = instance.frame?.width ?? 320, height = instance.frame?.height ?? 160
      try {
        if (implementation.kind === 'source') label(content, instance, '源码组件的静态缩略图；实际效果见预览')
        else if (implementation.key === 'guoling.text') {
          const data = textComponentDataSchema.parse(instance.data), text = renderTextComponent(dom, data)
          content.append(text)
          if (instance.frame) applyTextComponentLayout(text, measureTextComponent(text, instance.frame, data.sizing))
        } else if (implementation.key === 'guoling.formula') content.append(renderFormulaComponent(dom, formulaComponentDataSchema.parse(instance.data)))
        else if (implementation.key === 'guoling.shape') {
          const canvas = dom.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(width)); canvas.height = Math.max(1, Math.ceil(height))
          Object.assign(canvas.style, { width: '100%', height: '100%' })
          const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 不可用')
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
              const canvas = renderImageNodeCanvas(image, image.naturalWidth, image.naturalHeight, node, width, height)
              Object.assign(canvas.style, { width: '100%', height: '100%' }); content.replaceChildren(canvas)
            } catch (error) { label(content, instance, error instanceof Error ? error.message : '图片预览失败') }
          }
          image.onerror = () => { if (!disposed) label(content, instance, '图片预览无法解码') }
          image.src = url
        } else if (implementation.key !== 'guoling.group') label(content, instance, '此组件的静态缩略图；实际效果见预览')
      } catch (error) { label(content, instance, error instanceof Error ? error.message : '组件预览失败') }
      instance.childIds?.forEach(child => paint(child, wrapper))
    }
    element.replaceChildren(page)
    project.global.underlay.forEach(id => paint(id, page)); surface.childIds.forEach(id => paint(id, page)); project.global.overlay.forEach(id => paint(id, page))
    const fit = () => { const width = element.clientWidth || 160; const height = element.clientHeight || width * size.height / size.width; const scale = Math.min(width / size.width, height / size.height)
      page.style.transform = 'translate(' + (width - size.width * scale) / 2 + 'px,' + (height - size.height * scale) / 2 + 'px) scale(' + scale + ')' }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit)
    observer?.observe(element)
    element.title = diagnostics.join('\n')
    return () => { disposed = true; observer?.disconnect(); for (const url of urls.values()) URL.revokeObjectURL(url); page.remove() }
  }, [project, surfaceId, resources, visible])
  const ratio = source?.designSize ?? { width: 1280, height: 720 }
  return <div ref={host} className="scene-thumbnail" style={{ position: 'relative', aspectRatio: ratio.width + '/' + ratio.height, overflow: 'hidden' }} aria-hidden="true" />
}
