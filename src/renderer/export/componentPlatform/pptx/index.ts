import type PptxGenJS from 'pptxgenjs'
import { APP_COMPANY, APP_NAME } from '../../../../shared/constants'
import { courseProjectV10Schema, publishedCourseV3Schema, type ComponentInstance, type ComponentSurface } from '../../../../shared/contracts/component-platform'
import { IDENTITY_MATRIX, multiplyMatrices, type AffineMatrix } from '../../../../core/components/geometry'
import { imageDataSchema } from '../../../../components/image/data'
import { applyPptxShapeExtensions, type PptxShapeExtensions } from '../../pptxShapeGeometry'
import { pptxColor, pptxRotation, pptxTransparency, type PptxDrawingTarget } from '../../pptxShared'
import { resolveComponentBackground, isComponentVisibleAtSurface } from '../../../../shared/contracts/component-platform/project'
import { componentOutputPresentation } from '../presentation'
import { drawContainerStyle, drawImage, drawProfessional, instanceOpacity } from './drawings'
import { officeFrame } from './frame'
import { collectComponentAssetCredits, courseCreditLine } from '../../course/courseCredits'
import { applyPptxEditableGroups, type PptxEditableGroup, type PptxGroupChild, type PptxSlideGroups } from './groups'
import type { BuildComponentPptxOptions, ComponentPptxDiagnostic, ComponentPptxInput, ComponentPptxPage, ComponentPptxResult } from './types'
import { componentDeliveryPages } from '../deliveryPages'
import { resolvePrintPageSize } from '../../flowPageBox'
export type * from './types'

/** Builds a real PPTX from the current author model or its P0 projection. */
export async function buildComponentPptx(input: ComponentPptxInput, options: BuildComponentPptxOptions = {}): Promise<ComponentPptxResult> {
  const model = input.schemaVersion === 10 ? courseProjectV10Schema.parse(input) : publishedCourseV3Schema.parse(input)
  const diagnostics: ComponentPptxDiagnostic[] = [], pages: ComponentPptxPage[] = []
  const report = (diagnostic: ComponentPptxDiagnostic) => { diagnostics.push(diagnostic); options.onDiagnostic?.(diagnostic) }
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  const selected = componentDeliveryPages(model.surfaces, options.pageIds)
  const firstSlidePage = selected.find(page => model.surfaces.find(surface => surface.id === page.surfaceId)?.kind === 'slide')
  const nativeSize = model.surfaces.find(surface => surface.id === firstSlidePage?.surfaceId)?.designSize ?? { width: 1280, height: 720 }
  const paper = resolvePrintPageSize(options.pageSize ?? 'surface-native', options.orientation ?? 'auto', nativeSize)
  const outputSize = { width: paper.widthPx, height: paper.heightPx }
  pptx.defineLayout({ name: 'COMPONENT_CANVAS', width: outputSize.width / 96, height: outputSize.height / 96 })
  pptx.layout = 'COMPONENT_CANVAS'; pptx.author = APP_NAME; pptx.company = APP_COMPANY; pptx.title = model.title
  pptx.subject = '果铃统一组件专业输出'; pptx.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei' }
  const extensions: PptxShapeExtensions = new Map()
  const slideGroups: PptxSlideGroups = new Map()
  let current = model
  const warn = (surface: ComponentSurface, instance: ComponentInstance, message: string, code = 'format-difference') => report({ severity: 'warning', code, surfaceId: surface.id, instanceId: instance.id, message })
  const visit = async (slide: PptxGenJS.Slide, surface: ComponentSurface, id: string, parent: AffineMatrix,
    children: PptxGroupChild[], inheritedOpacity = 1, visualParent: AffineMatrix = parent): Promise<void> => {
    const authorInstance = current.instances[id]!, definition = current.definitions[authorInstance.definitionId]!
    const instance = inheritedOpacity === 1 ? authorInstance : { ...authorInstance,
      style: { ...authorInstance.style, opacity: instanceOpacity(authorInstance) * inheritedOpacity } }
    if (!isComponentVisibleAtSurface(instance, surface.id)) return
    const implementation = instance.implementationOverride ?? definition.implementation
    if (['guoling.navigation', 'guoling.teacher-controller'].includes(definition.id) || (implementation.kind === 'builtin' && ['guoling.navigation', 'guoling.teacher-controller'].includes(implementation.key))) {
      if (instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) && instance.data.includeInStaticExports === true) {
        // Explicit inclusion uses the real visual capture below.
      } else {
      report({ severity: 'info', code: 'teacher-controller-omitted', instanceId: id, surfaceId: surface.id, message: '教师控制台不写入静态 PPTX。' }); return
      }
    }
    if (definition.role === 'behavior') {
      warn(surface, instance, '无外观行为不写入 PPTX，工程源码和行为配置保留。', 'behavior-omitted'); return
    }
    const matrix = instance.frame ? multiplyMatrices(parent, instance.frame.transform) : parent
    // Native groups retain local coordinates, but capability diagnostics must
    // see the effective author transform rather than the group's reset basis.
    const visualMatrix = instance.frame ? multiplyMatrices(visualParent, instance.frame.transform) : visualParent
    if (implementation.kind === 'builtin' && ['guoling.table', 'guoling.chart'].includes(implementation.key)) {
      const rotation = pptxRotation(Math.atan2(visualMatrix[1], visualMatrix[0]) * 180 / Math.PI)
      if (Math.min(rotation, 360 - rotation) > 0.001) warn(surface, instance,
        'PowerPoint 原生表格与图表不呈现此有效旋转（包括祖先编组）；保留可编辑对象和数据，但旋转布局与作者图面不同。工程 frame 保留。',
        'layout-native-transform-limitation')
      if (visualMatrix[0] * visualMatrix[3] - visualMatrix[1] * visualMatrix[2] < 0) warn(surface, instance,
        'PPTX 专业表格与图表保留数据，不支持整体镜像。', 'layout-native-transform-limitation')
    }
    const isGroup = implementation.kind === 'builtin' && implementation.key === 'guoling.group'
    const isContainer = isGroup || !!instance.childIds?.length
    let frame: ReturnType<typeof officeFrame> | undefined
    let drawingChildren = children, childParent = matrix
    try {
      if (instance.frame) frame = officeFrame(instance.frame, matrix)
      else if (isGroup) frame = officeFrame({ width: 1, height: 1, transform: [1, 0, 0, 1, 0, 0] }, parent)
      else throw new Error('此内容缺少可导出的自由 frame')
      if (isContainer && frame) {
        const group: PptxEditableGroup = { name: instance.name ?? instance.id, frame,
          childWidth: instance.frame?.width ?? 1, childHeight: instance.frame?.height ?? 1, children: [] }
        children.push(group); drawingChildren = group.children
        childParent = IDENTITY_MATRIX
        const localFrame = officeFrame({ width: group.childWidth, height: group.childHeight, transform: [1, 0, 0, 1, 0, 0] }, IDENTITY_MATRIX)
        frame = localFrame
      } else if (frame && implementation.kind === 'builtin' && ['guoling.table', 'guoling.chart'].includes(implementation.key)
        && (Math.abs(frame.rotation) > 0.001 || frame.flipY)) {
        // graphicFrame has no rotation API in PptxGenJS. A native group carries
        // the transform while its table/chart and workbook remain editable.
        const group: PptxEditableGroup = { name: `${instance.name ?? instance.id} transform`, frame,
          childWidth: frame.width, childHeight: frame.height, children: [] }
        children.push(group); drawingChildren = group.children
        frame = { ...frame, x: 0, y: 0, rotation: 0, flipY: false }
      }
      if (frame) {
        const record = <T extends { objectName?: string }>(props: T): T => {
          const objectName = props.objectName ?? `${instance.id}:${drawingChildren.length}`
          drawingChildren.push(objectName); return { ...props, objectName }
        }
        const target: PptxDrawingTarget = { addText: (text, props) => { slide.addText(text, record(props ?? {})) }, addImage: props => { slide.addImage(record(props)) },
          addShape: (type, props) => { slide.addShape(type, record(props ?? {})) }, addTable: (rows, props) => { slide.addTable(rows, record(props ?? {})) }, addChart: (type, data, props) => { slide.addChart(type, data, record(props ?? {})) } }
        let done = false
        if (implementation.kind === 'builtin') {
          for (const message of drawContainerStyle(target, instance, frame)) warn(surface, instance, message)
          if (implementation.key === 'guoling.group') done = true
          else if (implementation.key === 'guoling.image') {
            const data = imageDataSchema.parse(instance.data)
            const url = await options.resolveAsset?.(data.assetId, input) ?? (input.schemaVersion === 3 ? input.assets[data.assetId]?.url : undefined)
            if (!url) throw new Error(`图片资源 ${data.assetId} 未提供可导出的字节`)
            await drawImage(target, instance, frame, url); done = true
            if (/^data:image\/gif;/i.test(url)) report({ severity: 'info', code: 'gif-static-frame', surfaceId: surface.id,
              instanceId: instance.id, message: 'GIF 已解码为实际静态 PNG 图面；PPTX 不保留动画，原 GIF 保留在工程中。' })
          } else {
            const warnings = drawProfessional(target, implementation.key, instance, frame, extensions)
            if (warnings !== null) { warnings.forEach(message => warn(surface, instance, message)); done = true }
          }
        }
        if (!done) {
          const capture = await options.captureInstance?.({ input, surface, instance })
          if (!capture?.startsWith('data:image/')) throw new Error('此源码或专业内容需实际运行捕获；未替换为默认实现或静态占位')
          target.addImage({ data: capture, x: frame.x / 96, y: frame.y / 96, w: frame.width / 96, h: frame.height / 96,
            rotate: pptxRotation(frame.rotation), flipV: frame.flipY, objectName: instance.id,
            transparency: pptxTransparency(instanceOpacity(instance)) })
          warn(surface, instance, '已使用宿主提供的实际运行图面；PPTX 中为静态图片，源码和专业数据保留在工程中。', 'runtime-static-capture')
        }
      }
      if (instance.attachments?.length) warn(surface, instance, '附着行为和运行状态不带入 PPTX。', 'attachments-omitted')
    } catch (error) {
      report({ severity: 'error', code: 'instance-unsupported', surfaceId: surface.id, instanceId: id,
        message: error instanceof Error ? error.message : String(error) })
    }
    // Capture masks descendant hosts. Preserve their editable output even when
    // this source body cannot be captured; a local failure is not a subtree loss.
    for (const child of instance.childIds ?? []) await visit(slide, surface, child, childParent, drawingChildren, instanceOpacity(instance), visualMatrix)
  }
  for (const selectedPage of selected) {
    const authorSurface = model.surfaces.find(surface => surface.id === selectedPage.surfaceId)!
    current = componentOutputPresentation(model, authorSurface.id)
    const surface = current.surfaces.find(value => value.id === authorSurface.id)!
    if (surface.kind === 'flow') {
      report({ severity: 'warning', code: 'flow-pptx-unsupported', surfaceId: surface.id, message: '阅读流不映射为 PPTX 页面，请使用文档输出。' }); continue
    }
    if (surface.kind === 'spatial') {
        const page: ComponentPptxPage = selectedPage
        try {
          const image = await options.captureSurface?.({ input, surface, page })
          if (!image?.startsWith('data:image/')) throw new Error('空间页面需 Player 实际镜头捕获，未生成静态替代')
          const width = outputSize.width / 96, height = outputSize.height / 96
          pptx.addSlide().addImage({ data: image, x: 0, y: 0, w: width, h: height, sizing: { type: 'contain', w: width, h: height } })
          pages.push(page); report({ severity: 'warning', code: 'spatial-static-capture', surfaceId: surface.id, message: '空间镜头在 PPTX 中为实际 Player 静态图面。' })
        } catch (error) { report({ severity: 'error', code: 'surface-unsupported', surfaceId: surface.id, message: error instanceof Error ? error.message : String(error) }) }
      continue
    }
    const size = surface.designSize ?? outputSize
    const scale = Math.min(outputSize.width / size.width, outputSize.height / size.height)
    const contain: AffineMatrix = [scale, 0, 0, scale, (outputSize.width - size.width * scale) / 2, (outputSize.height - size.height * scale) / 2]
    if (size.width !== outputSize.width || size.height !== outputSize.height) report({ severity: 'info', code: 'page-contain', surfaceId: surface.id,
      message: options.pageSize && options.pageSize !== 'surface-native' ? 'PPTX 使用所选纸型，此页按 contain 保留比例适配。' : 'PPTX 使用首个所选演示页规格，此页按 contain 保留比例适配。' })
    const slide = pptx.addSlide()
    const background = resolveComponentBackground(current, surface)
    slide.background = { color: pptxColor(background.color, 'FFFFFF') }
    if (background.assetId) {
      try {
        const url = await options.resolveAsset?.(background.assetId, input) ?? (input.schemaVersion === 3 ? input.assets[background.assetId]?.url : undefined)
        if (!url) throw new Error(`背景资源 ${background.assetId} 缺少实际字节`)
        const x = contain[4] / 96, y = contain[5] / 96, w = size.width * scale / 96, h = size.height * scale / 96
        slide.addImage({ data: url, x, y, w, h, ...(background.fit === 'fill' ? {} : {
          sizing: { type: background.fit === 'contain' ? 'contain' as const : 'cover' as const, w, h },
        }), objectName: `${surface.id}:background` })
      } catch (error) { report({ severity: 'error', code: 'background-asset-missing', surfaceId: surface.id, message: error instanceof Error ? error.message : String(error) }) }
    }
    const children: PptxGroupChild[] = []
    for (const id of [...current.global.underlay, ...surface.childIds, ...current.global.overlay]) await visit(slide, surface, id, contain, children)
    const groups = children.filter((child): child is PptxEditableGroup => typeof child !== 'string')
    if (groups.length) slideGroups.set(pages.length + 1, groups)
    pages.push({ id: surface.id, surfaceId: surface.id, title: surface.title })
  }
  if (!pages.length) return { bytes: new Uint8Array(), slideCount: 0, pages, status: 'empty', diagnostics }
  // The mature PPTX consumer appends attributed managed assets to the file.
  // source.url is the provenance page; a Published asset URL is media delivery.
  const credits = collectComponentAssetCredits(model.assets)
  if (credits.length) {
    const slide = pptx.addSlide(), width = outputSize.width / 96 - 1
    slide.addText('素材来源', { x: 0.5, y: 0.3, w: width, h: 0.6, fontSize: 24, bold: true, fontFace: 'Microsoft YaHei' })
    slide.addText(credits.map(credit => ({ text: courseCreditLine(credit), options: { bullet: true, breakLine: true } })),
      { x: 0.5, y: 1.0, w: width, h: outputSize.height / 96 - 1.4, fontSize: 12, valign: 'top', fontFace: 'Microsoft YaHei' })
  }
  const output = await pptx.write({ outputType: 'arraybuffer', compression: true })
  return { bytes: applyPptxShapeExtensions(applyPptxEditableGroups(new Uint8Array(output as ArrayBuffer), slideGroups), extensions), slideCount: pages.length + Number(credits.length > 0), pages,
    status: diagnostics.some(d => d.severity !== 'info') ? 'partial' : 'complete', diagnostics }
}
