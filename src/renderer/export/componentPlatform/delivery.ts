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

export type ComponentDeliveryFormat = 'single-html' | 'web-package' | 'pptx' | 'pdf' | 'docx'
export interface ComponentDeliveryFinding {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  surfaceId?: string
  instanceId?: string
  path?: readonly (string | number)[]
}
export interface ComponentDeliveryReport {
  reportVersion: 1
  schemaVersion: 10
  projectId: string
  target: ComponentDeliveryFormat
  generatedAt: string
  items: ComponentDeliveryFinding[]
  summary: { error: number; warning: number; info: number; total: number; canExport: boolean }
}
export interface ComponentOutputCapture {
  captureInstance(surfaceId: string, instanceId: string): Promise<PdfPrintImage | undefined>
  captureSurface(surfaceId: string, spatialFrameId?: string): Promise<PdfPrintImage | undefined>
  dispose(): void | Promise<void>
}
export interface ComponentDeliveryArtifact {
  suggestedName: string
  extension: 'html' | 'zip' | 'pptx' | 'pdf' | 'docx'
  bytes?: Uint8Array
  html?: string
}
export interface BuiltComponentDelivery { artifacts: ComponentDeliveryArtifact[]; report: ComponentDeliveryReport }

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
  if (format === 'single-html') {
    const result = await buildComponentHtml(snapshot.snapshot, options.compile, options.singleHtmlMode, options.signal, options.onProgress)
    note(result.diagnostics)
    artifacts.push({ suggestedName: `${project.title}.html`, extension: 'html', html: result.html })
  } else if (format === 'web-package') {
    const result = await buildComponentWebPackage(snapshot.snapshot, options.compile, options.signal, options.onProgress)
    note(result.diagnostics)
    artifacts.push({ suggestedName: `${project.title}-网页包.zip`, extension: 'zip', bytes: result.bytes })
  } else {
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
          onDiagnostic: () => check(),
        })
        check()
        note(result.diagnostics)
        if (!result.bytes.length) throw new Error('当前课程没有可生成的 PPTX 页面；内容与资源已保留')
        artifacts.push({ suggestedName: `${project.title}.pptx`, extension: 'pptx', bytes: result.bytes })
      } else if (format === 'docx') {
        const flows = project.surfaces.filter(surface => surface.kind === 'flow'), names = new Set<string>()
        if (!flows.length) throw new Error('当前课程没有流式讲义，无法导出 DOCX')
        for (const surface of flows) {
          check()
          const result = await buildComponentDocx(project, { surfaceId: surface.id, resolveAsset, captureInstance })
          note(result.diagnostics)
          for (const message of result.warnings) items.push({ severity: 'warning', code: 'document-output', message })
          const suggestedName = uniqueFlowDocxFilename(surface.title, names); names.add(suggestedName)
          artifacts.push({ suggestedName, extension: 'docx', bytes: result.bytes })
        }
      } else {
        const fragments: string[] = []
        if (!project.surfaces.length) throw new Error('当前课程没有可打印的页面')
        for (const surface of project.surfaces) {
          check()
          const result = await buildComponentPrintHtml(project, {
            surfaceId: surface.id, resolveAsset, captureInstance,
            captureSurface: options.createCapture ? async ({ surfaceId }) => {
              const frames = project.surfaces.find(value => value.id === surfaceId)?.spatial?.frames
              const ids = frames?.length ? frames.map(frame => frame.id) : [undefined]
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
  return { artifacts, report: { reportVersion: 1, schemaVersion: 10, projectId: project.id, target: format,
    generatedAt: new Date().toISOString(), items, summary } }
}
