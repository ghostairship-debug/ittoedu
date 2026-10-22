import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'
import type { CourseDeliverySnapshot } from '../../app/courseDeliverySnapshot'
import { buildComponentHtml, buildComponentPublished, buildComponentWebPackage, type ComponentCompilePort } from './buildHtml'
import { buildComponentPptx } from './pptx'
import { buildComponentDocx } from './document'
import { buildComponentPrintHtml, composeComponentPrintHtml } from './print'
import type { SingleHtmlExportMode } from '../course/coursePackagePreflight'
import { uniqueFlowDocxFilename } from '../docxFilename'
import type { PdfPrintImage } from '../course/pdfPrintHtml'
import { bytesToDataUrl } from '../base64'
import { resolveCourseProjectDeliveryFindingRoute } from '../../diagnostics/projectHealthNavigation'
import { componentDeliveryPages } from './deliveryPages'
import { componentSurface, componentSurfaces } from '../../../shared/contracts/component-platform/project'
import { componentStaticRootOmissions } from './presentation'

import type { ComponentDeliveryFormat, ComponentDeliveryFinding, ComponentDeliveryReport, ComponentDeliveryArtifact, BuiltComponentDelivery } from '../../../shared/workbench/frozenDelivery'
export type { ComponentDeliveryFormat, ComponentDeliveryFinding, ComponentDeliveryReport, ComponentDeliveryArtifact, BuiltComponentDelivery } from '../../../shared/workbench/frozenDelivery'
export interface ComponentOutputCapture {
  captureInstance(surfaceId: string, instanceId: string): Promise<PdfPrintImage | undefined>
  captureSurface(surfaceId: string, spatialFrameId?: string): Promise<PdfPrintImage | undefined>
  /** Only the effective formal background; authored objects and global planes are absent. */
  captureBackground?(surfaceId: string, layer?: 'project' | 'surface'): Promise<PdfPrintImage | undefined>
  dispose(): void | Promise<void>
}
function captureBytes(image: PdfPrintImage) {
  const [header, data] = image.dataUrl.split(',')
  if (!header?.includes(';base64') || !data) throw new Error('实际捕获没有返回图片字节')
  return { bytes: Uint8Array.from(atob(data), char => char.charCodeAt(0)), mimeType: header.slice(5).split(';')[0]!, width: image.width, height: image.height }
}

/** Every format consumes this one drained snapshot. No live store reads or reimport. */
export async function buildComponentDelivery(snapshot: CourseDeliverySnapshot, format: ComponentDeliveryFormat, options: {
  compile: ComponentCompilePort
  singleHtmlMode?: SingleHtmlExportMode
  signal?: AbortSignal
  onProgress?: () => void
  createCapture?: (payload: PublishedCourseV3) => Promise<ComponentOutputCapture>
}): Promise<BuiltComponentDelivery> {
  const { project } = snapshot, items: ComponentDeliveryFinding[] = [], artifacts: ComponentDeliveryArtifact[] = []
  const check = () => { options.signal?.throwIfAborted(); options.onProgress?.() }
  const note = (values: readonly { code: string; message: string; severity?: ComponentDeliveryFinding['severity']; surfaceId?: string; instanceId?: string; path?: readonly (string | number)[] }[]) => {
    items.push(...values.map(value => {
      const route = resolveCourseProjectDeliveryFindingRoute(project, value)
      return { ...value, ...(route.available && route.surfaceId ? { surfaceId: route.surfaceId } : {}),
        ...(route.available && route.instanceId ? { instanceId: route.instanceId } : {}), severity: value.severity ?? 'warning' }
    }))
  }
  check()
  const choices = snapshot.deliveryOptions ?? {}
  const surfaces = componentSurfaces(project)
  const selectedPages = componentDeliveryPages(surfaces, format === 'single-html' || format === 'web-package' ? undefined : choices.pageIds)
  if (format === 'single-html') {
    const result = await buildComponentHtml(snapshot.snapshot, options.compile, options.singleHtmlMode, options.signal, options.onProgress)
    note(result.diagnostics)
    artifacts.push({ suggestedName: `${project.title}.html`, extension: 'html', html: result.html })
  } else if (format === 'web-package') {
    const result = await buildComponentWebPackage(snapshot.snapshot, options.compile, options.signal, options.onProgress)
    note(result.diagnostics)
    artifacts.push({ suggestedName: `${project.title}-网页包.zip`, extension: 'zip', bytes: result.bytes })
  } else {
    if (!surfaces.length && project.entry) throw new Error(`当前作品为自主管理程序入口，没有可映射的 ${format.toUpperCase()} 页面；请使用可运行 HTML/Web 包，工程内容与资源已保留。`)
    // PPTX reports these same omissions in its direct builder, then feeds them
    // through note below. Explicit page selections already declare their scope.
    if (!choices.pageIds && format !== 'pptx') note(componentStaticRootOmissions(project))
    let capture: ComponentOutputCapture | undefined
    // Prepare a fresh Player only when a format consumer actually requests a captured region.
    const getCapture = async () => {
      if (!capture && options.createCapture) {
        check()
        const published = await buildComponentPublished(snapshot.snapshot, options.compile, undefined, undefined, options.signal, options.onProgress)
        note(published.diagnostics)
        check()
        capture = await options.createCapture(published.payload)
        check()
      }
      return capture
    }
    const resolveAsset = (id: string) => {
      const bytes = snapshot.assetFiles[id], asset = project.assets[id]
      return bytes && asset ? { bytes, mimeType: asset.mimeType ?? 'application/octet-stream', filename: asset.path } : undefined
    }
    const captureInstance = options.createCapture ? async ({ surfaceId, instanceId }: { surfaceId: string; instanceId: string }) => {
      check(); const result = await (await getCapture())?.captureInstance(surfaceId, instanceId); check()
      return result ? captureBytes(result) : undefined
    } : undefined
    try {
      if (format === 'pptx') {
        const result = await buildComponentPptx(project, {
          ...choices,
          resolveAsset: id => {
            const value = resolveAsset(id)
            if (!value) return undefined
            return bytesToDataUrl(value.bytes, value.mimeType)
          },
          captureInstance: options.createCapture ? async ({ surface, instance }) => {
            check(); const image = await (await getCapture())?.captureInstance(surface.id, instance.id); check(); return image?.dataUrl
          } : undefined,
          captureSurface: options.createCapture ? async ({ surface, page }) => {
            check(); const image = await (await getCapture())?.captureSurface(surface.id, page.spatialFrameId); check(); return image?.dataUrl
          } : undefined,
          captureBackground: options.createCapture ? async ({ surface, layer }) => {
            check(); const image = await (await getCapture())?.captureBackground?.(surface.id, layer); check(); return image?.dataUrl
          } : undefined,
          onDiagnostic: () => check(),
        })
        check()
        note(result.diagnostics)
        if (!result.bytes.length) throw new Error('当前课程没有可生成的 PPTX 页面；内容与资源已保留')
        artifacts.push({ suggestedName: `${project.title}.pptx`, extension: 'pptx', bytes: result.bytes })
      } else if (format === 'docx') {
        const flows = selectedPages.map(page => componentSurface(project, page.surfaceId)!).filter(surface => surface.kind === 'flow'), names = new Set<string>()
        if (!flows.length) throw new Error('当前课程没有流式讲义，无法导出 DOCX')
        for (const surface of flows) {
          check()
          const result = await buildComponentDocx(project, { surfaceId: surface.id, resolveAsset, captureInstance, pageSize: choices.pageSize, orientation: choices.orientation })
          note(result.diagnostics)
          for (const message of result.warnings) items.push({ severity: 'warning', code: 'document-output', message })
          const suggestedName = uniqueFlowDocxFilename(surface.title, names); names.add(suggestedName)
          artifacts.push({ suggestedName, extension: 'docx', bytes: result.bytes })
        }
      } else {
        const fragments: string[] = []
        if (!surfaces.length) throw new Error('当前课程没有可打印的页面')
        const printPages = choices.pageIds ? selectedPages : surfaces.map(surface => ({ id: surface.id, surfaceId: surface.id, title: surface.title, spatialFrameId: undefined }))
        for (const page of printPages) {
          const surface = componentSurface(project, page.surfaceId)!
          check()
          const result = await buildComponentPrintHtml(project, {
            surfaceId: surface.id, resolveAsset, captureInstance, pageSize: choices.pageSize, orientation: choices.orientation, pageId: page.id,
            captureSurface: options.createCapture ? async ({ surfaceId }) => {
              const frames = componentSurface(project, surfaceId)?.spatial?.frames
              const ids = choices.pageIds ? [page.spatialFrameId] : frames?.length ? frames.map(frame => frame.id) : [undefined]
              const images: PdfPrintImage[] = []
              for (const id of ids) { check(); const image = await (await getCapture())?.captureSurface(surfaceId, id); check(); if (image) images.push(image) }
              return images
            } : undefined,
          })
          note(result.diagnostics)
          fragments.push(result.html)
        }
        artifacts.push({ suggestedName: `${project.title}.pdf`, extension: 'pdf', html: composeComponentPrintHtml(project.title, fragments) })
      }
    } finally { await capture?.dispose() }
  }
  check()
  const summary = { error: 0, warning: 0, info: 0, total: items.length, canExport: artifacts.length > 0 }
  for (const item of items) summary[item.severity]++
  return { artifacts, report: { reportVersion: 1, schemaVersion: 11, projectId: project.id, target: format,
    generatedAt: new Date().toISOString(), items, summary } }
}
