import type { ComponentImplementation, ComponentInstance, ComponentSurface, ComponentFlowPlacement, CourseProjectV10 } from '../../../../shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../../../shared/contracts/component-platform/frame'
import { multiplyMatrices, type AffineMatrix } from '../../../../core/components/geometry'
import { isComponentVisibleAtSurface } from '../../../../shared/contracts/component-platform/project'
import type { PublishedCourseV3 } from '../../../../shared/contracts/component-platform/published'
import { textComponentDataSchema, formulaComponentDataSchema, type TextComponentData, type FormulaComponentData } from '../../../../components/text/data'
import { tableDataSchema, type TableData } from '../../../../components/table/data'
import { chartDataSchema, type ChartData } from '../../../../components/chart/data'
import { imageDataSchema, type ImageData } from '../../../../components/image/data'
import { shapeDataSchema, type ShapeData } from '../../../../components/shape/data'
import { inputDataSchema } from '../../../../components/input'
import { choiceDataSchema } from '../../../../components/choice'
import { disclosureDataSchema } from '../../../../components/disclosure'
import { popoverDataSchema } from '../../../../components/popover'
import { documentBlockOutputAdapter } from '../../../../components/document-block'
import type { DocumentBlock } from '../../../../shared/document/content'
import { componentOutputPresentation } from '../presentation'
import { audioDataSchema, videoDataSchema, type MediaData } from '../../../../components/media'
import type { FlowDocxPageSize, FlowDocxOrientation } from '../../flowPageBox'

/** Format consumers receive a captured formal document, never editor or session state. */
export type ComponentExportDocument = CourseProjectV10 | PublishedCourseV3
/** Neutral captured bytes shared by document, print and runtime capture consumers. */
export interface ComponentOutputAsset { bytes: Uint8Array; mimeType: string; filename?: string }
export interface ComponentStaticCapture extends ComponentOutputAsset { width: number; height: number }
export interface ComponentCaptureRequest {
  document: ComponentExportDocument
  surfaceId: string
  instanceId: string
  /** Capture a fresh author initial state; students' transient answers are excluded. */
  state: 'author-initial'
}
export interface ComponentDocumentOutputOptions {
  surfaceId: string
  pageSize?: FlowDocxPageSize
  orientation?: FlowDocxOrientation
  resolveAsset?: (assetId: string) => ComponentOutputAsset | undefined | Promise<ComponentOutputAsset | undefined>
  captureInstance?: (request: ComponentCaptureRequest) => Promise<ComponentStaticCapture | undefined>
  author?: string
  createdAt?: Date
}
export interface ComponentOutputDiagnostic {
  surfaceId: string
  instanceId: string
  code: string
  message: string
  /** Source remains available for repair; static output never claims to execute it. */
  implementation?: ComponentImplementation
  assetId?: string
}
type ProfessionalBlock =
  | { kind: 'document-block'; data: DocumentBlock }
  | { kind: 'media'; mediaKind: 'audio' | 'video'; data: MediaData }
  | { kind: 'text'; data: TextComponentData }
  | { kind: 'formula'; data: FormulaComponentData }
  | { kind: 'table'; data: TableData }
  | { kind: 'chart'; data: ChartData }
  | { kind: 'image'; data: ImageData }
  | { kind: 'shape'; data: ShapeData }
  | { kind: 'static'; label: string; lines: string[]; captureRequired: boolean }
export type ComponentReadingBlock = ProfessionalBlock & { instance: ComponentInstance; globalPlane?: 'underlay' | 'overlay'; floatingPlacement?: ComponentFlowPlacement; outputFrame?: ComponentFrame; floatingAnchorFrame?: ComponentFrame }
export interface ComponentReadingProjection {
  title: string
  surface: ComponentSurface
  blocks: ComponentReadingBlock[]
  diagnostics: ComponentOutputDiagnostic[]
}
export function escapeOutput(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}
export function buildComponentReadingProjection(document: ComponentExportDocument, surfaceId: string): ComponentReadingProjection {
  document = componentOutputPresentation(document, surfaceId)
  const surface = document.surfaces.find(item => item.id === surfaceId)
  if (!surface) throw new Error(`导出表面不存在：${surfaceId}`)
  if (surface.kind !== 'flow') throw new Error(`表面 ${surfaceId} 需要实际页面／镜头捕获，不能按阅读流重排。`)
  const projection: ComponentReadingProjection = { title: surface.title || document.title, surface, blocks: [], diagnostics: [] }
  const diagnostic = (instance: ComponentInstance, code: string, message: string, implementation?: ComponentImplementation) =>
    projection.diagnostics.push({ surfaceId, instanceId: instance.id, code, message, ...(implementation ? { implementation } : {}) })
  const walk = (id: string, globalPlane?: 'underlay' | 'overlay', parent: AffineMatrix = [1, 0, 0, 1, 0, 0], inheritedPlacement?: ComponentFlowPlacement, inheritedAnchorFrame?: ComponentFrame) => {
    const instance = document.instances[id]
    if (!instance) throw new Error(`导出引用的组件不存在：${id}`)
    if (!isComponentVisibleAtSurface(instance, surfaceId)) return
    const matrix = instance.frame ? multiplyMatrices(parent, instance.frame.transform) : parent
    const floatingPlacement = globalPlane ? { space: 'viewport' as const, plane: globalPlane } : instance.flowPlacement ?? inheritedPlacement
    const floatingAnchorFrame: ComponentFrame | undefined = instance.flowPlacement ? (instance.frame ? { ...instance.frame, transform: [...matrix] } : undefined) : inheritedAnchorFrame
    const definition = document.definitions[instance.definitionId]
    if (!definition) throw new Error(`导出引用的定义不存在：${instance.definitionId}`)
    const implementation = instance.implementationOverride ?? definition.implementation
    const key = definition.implementation.kind === 'builtin' ? definition.implementation.key : definition.id
    if (['guoling.navigation', 'guoling.teacher-controller'].includes(key) && !(instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) && instance.data.includeInStaticExports === true)) return
    if (definition.role === 'behavior') {
      diagnostic(instance, 'static-behavior', '行为在静态文件中不执行。', implementation)
      return
    }
    if (implementation.kind === 'source') diagnostic(instance, 'source-static-output', '专业数据仍保留；自定义源码的视觉与互动需要实际捕获。', implementation)
    if (instance.attachments?.length) diagnostic(instance, 'static-behavior', '附加行为在静态文件中不执行。')
    let block: ProfessionalBlock | undefined
    try {
      switch (key) {
        case 'guoling.document-block': block = { kind: 'document-block', data: documentBlockOutputAdapter.block(instance.data, instance.id) }; break
        case 'guoling.audio': block = { kind: 'media', mediaKind: 'audio', data: audioDataSchema.parse(instance.data) }; break
        case 'guoling.video': block = { kind: 'media', mediaKind: 'video', data: videoDataSchema.parse(instance.data) }; break
        case 'guoling.text': block = { kind: 'text', data: textComponentDataSchema.parse(instance.data) }; break
        case 'guoling.formula': block = { kind: 'formula', data: formulaComponentDataSchema.parse(instance.data) }; break
        case 'guoling.table': block = { kind: 'table', data: tableDataSchema.parse(instance.data) }; break
        case 'guoling.chart': block = { kind: 'chart', data: chartDataSchema.parse(instance.data) }; break
        case 'guoling.image': block = { kind: 'image', data: imageDataSchema.parse(instance.data) }; break
        case 'guoling.shape': block = { kind: 'shape', data: shapeDataSchema.parse(instance.data) }; break
        case 'guoling.input': {
          const data = inputDataSchema.parse(instance.data)
          block = { kind: 'static', label: data.label, lines: [data.initialValue || data.placeholder || '________________'], captureRequired: false }; break
        }
        case 'guoling.choice': {
          const data = choiceDataSchema.parse(instance.data)
          block = { kind: 'static', label: data.label, lines: data.options.map(option => `□ ${option.label}`), captureRequired: false }; break
        }
        case 'guoling.disclosure': {
          const data = disclosureDataSchema.parse(instance.data)
          block = { kind: 'static', label: data.label, lines: [data.content], captureRequired: false }; break
        }
        case 'guoling.popover': {
          const data = popoverDataSchema.parse(instance.data)
          block = { kind: 'static', label: data.label, lines: [data.content], captureRequired: false }; break
        }
        default:
          if (implementation.kind === 'source' || !instance.childIds?.length) block = { kind: 'static', label: definition.title || instance.definitionId, lines: [], captureRequired: true }
      }
    } catch (error) {
      diagnostic(instance, 'professional-data-invalid', `专业数据不能输出：${error instanceof Error ? error.message : String(error)}`, implementation)
      block = { kind: 'static', label: definition.title || instance.definitionId, lines: ['专业数据有误，保留工程数据后修复。'], captureRequired: true }
    }
    if (block) {
      const outputFrame: ComponentFrame | undefined = floatingPlacement && instance.frame ? { ...instance.frame, transform: [...matrix] } : undefined
      projection.blocks.push({ ...block, instance, ...(globalPlane ? { globalPlane } : {}),
        ...(floatingPlacement ? { floatingPlacement, ...(floatingAnchorFrame ? { floatingAnchorFrame } : {}), ...(outputFrame ? { outputFrame } : {}) } : {}) })
      if (block.kind === 'static' && !block.captureRequired) diagnostic(instance, 'static-interaction', '打印保留题面／说明和作者初值，不带学生临时答案或互动。')
    }
    instance.childIds?.forEach(child => walk(child, globalPlane, matrix, floatingPlacement, floatingAnchorFrame))
  }
  const global = (plane: 'underlay' | 'overlay') => {
    for (const id of document.global[plane]) {
      walk(id, plane)
    }
  }
  global('underlay')
  surface.childIds.forEach(id => walk(id))
  global('overlay')
  return projection
}
