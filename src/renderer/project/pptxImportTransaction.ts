import type { ComponentDefinition, ComponentEdit, ComponentInstance, ComponentFrame, JsonValue } from '../../shared/contracts/component-platform'
import type { FormulaAstNode } from '../../shared/contracts/native-v1'
import { normalizeDocumentText, type FlowInline } from '../../shared/document/content'
import { captureComponentOperation } from '../../core/drivers/courseV10Operations'
import { TEXT_DEFINITION, FORMULA_DEFINITION } from '../../components/text/adapters'
import { createFormulaComponentData, textComponentDataSchema } from '../../components/text/data'
import { IMAGE_DEFINITION, imageDataSchema } from '../../components/image'
import { SHAPE_DEFINITION, shapeDataSchema } from '../../components/shape'
import { TABLE_DEFINITION, parseTableData } from '../../components/table'
import { CHART_DEFINITION, chartDataSchema } from '../../components/chart'
import { VIDEO_DEFINITION, videoDataSchema } from '../../components/media'
import { INTERACTIONS_DEFINITION, remapComponentInteractionData } from '../interactions/componentInteractionAuthoring'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { DesignProductionStep } from '../authoring/productivity'
import type { PptxImportDraft } from './pptxImport'

type ParsedItem = PptxImportDraft['slides'][number]['items'][number]
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

/** The parsed professional AST becomes the formula component's one editable source. */
function formulaSource(ast: FormulaAstNode): string {
  const text = (value: string) => value.replaceAll('\\', '\\backslash ').replaceAll('{', '\\{').replaceAll('}', '\\}')
  switch (ast.type) {
    case 'row': return ast.children.map(formulaSource).join(' ')
    case 'token': return /^[\p{L}\p{N}.]+$/u.test(ast.value) ? ast.value : `\\text{${text(ast.value)}}`
    case 'operator': return ast.value
    case 'fraction': return `\\frac{${formulaSource(ast.numerator)}}{${formulaSource(ast.denominator)}}`
    case 'root': return `\\sqrt${ast.index ? `[${formulaSource(ast.index)}]` : ''}{${formulaSource(ast.radicand)}}`
    case 'script': return `{${formulaSource(ast.base)}}${ast.subscript ? `_{${formulaSource(ast.subscript)}}` : ''}${ast.superscript ? `^{${formulaSource(ast.superscript)}}` : ''}`
    case 'fenced': return `\\left${ast.open === '{' ? '\\{' : ast.open || '.'}${formulaSource(ast.body)}\\right${ast.close === '}' ? '\\}' : ast.close || '.'}`
  }
}
function importedFrame(item: ParsedItem): ComponentFrame {
  const { x, y, width, height } = item.frame
  const radians = item.rotation * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians)
  // PPT placement rotates about the centre; V10 stores its exact parent transform.
  return { width, height, transform: [c, s, -s, c, x + width / 2 - c * width / 2 + s * height / 2,
    y + height / 2 - s * width / 2 - c * height / 2] }
}
function importedData(item: ParsedItem): { definition: ComponentDefinition; data: JsonValue } {
  if (item.kind !== 'native') throw new Error('对象没有可编辑的专业内容')
  const content = item.content
  switch (content.nativeType) {
    case 'text': {
      const { text, runs, style, flipX, flipY } = content.data
      const chars = Array.from(text), cuts = [...new Set([0, chars.length, ...runs.flatMap(run => [run.start, run.end])])].sort((a, b) => a - b)
      const inlines: FlowInline[] = cuts.slice(0, -1).map((from, index) => {
        const styles = runs.filter(run => run.start <= from && run.end >= cuts[index + 1]!).map(run => run.style)
        return { type: 'text', text: chars.slice(from, cuts[index + 1]).join(''), ...(styles.length ? { style: Object.assign({}, ...styles) } : {}) }
      })
      const { overflow, ...appearance } = style
      return { definition: TEXT_DEFINITION, data: json(textComponentDataSchema.parse({
        content: normalizeDocumentText({ inlines }), appearance: { ...appearance, flipX: flipX ?? false, flipY: flipY ?? false },
        sizing: { mode: overflow === 'auto-height' ? 'grow-height' : overflow === 'shrink' ? 'shrink-text' : 'fixed', minHeight: item.frame.height, overflow: 'visible' },
      })) }
    }
    case 'formula': {
      const data = createFormulaComponentData(crypto.randomUUID(), formulaSource(content.data.ast))
      data.appearance = { ...data.appearance, ...content.data.style }
      data.sizing = { mode: 'fixed', minHeight: item.frame.height, overflow: 'visible' }
      return { definition: FORMULA_DEFINITION, data: json(data) }
    }
    case 'image': {
      const data = content.data
      return { definition: IMAGE_DEFINITION, data: json(imageDataSchema.parse({ ...data, originalAssetId: data.assetId, alt: item.label })) }
    }
    case 'shape': return { definition: SHAPE_DEFINITION, data: json(shapeDataSchema.parse(content.data)) }
    case 'table': return { definition: TABLE_DEFINITION, data: json(parseTableData(content.data)) }
    case 'chart': return { definition: CHART_DEFINITION, data: json(chartDataSchema.parse(content.data)) }
    case 'video': return { definition: VIDEO_DEFINITION, data: json(videoDataSchema.parse({ ...content.data, title: item.label })) }
    default: throw new Error('此专业对象尚未提供导入适配')
  }
}
/** Stage one captured V10 batch; the caller commits through the existing Session. */
export function planPptxImportTransaction(target: CapturedCourseTarget, draft: PptxImportDraft, title: string,
  options: { canvas?: { width: number; height: number }; source?: { bytes: Uint8Array; filename: string } } = {}): DesignProductionStep {
  if (!draft.slides.length) throw new Error('没有可导入的页面')
  const { project } = target, edits: ComponentEdit[] = [], definitions = new Map<string, ComponentDefinition>(), ids = new Map<string, string>()
  const surfaces = draft.slides.map(() => crypto.randomUUID())
  const canvas = options.canvas ?? project.surfaces.find(surface => surface.id === target.surfaceId)?.designSize ?? { width: 1280, height: 720 }
  const addDefinition = (definition: ComponentDefinition) => {
    const existing = project.definitions[definition.id]
    if (existing && (existing.implementation.kind !== 'builtin' || definition.implementation.kind !== 'builtin' || existing.implementation.key !== definition.implementation.key)) throw new Error(`专业组件身份已由另一实现占用：${definition.id}`)
    if (!existing) definitions.set(definition.id, definition)
  }
  const convert = (item: ParsedItem, page?: number): ComponentInstance | null => {
    try {
      const { definition, data } = importedData(item); addDefinition(definition)
      const id = crypto.randomUUID(); ids.set(item.layerItemId, id)
      return { id, definitionId: definition.id, name: item.label, data, frame: importedFrame(item), style: { opacity: item.opacity },
        visible: item.visible, locked: item.locked, playbackInitialVisibility: item.playbackInitialVisibility }
    } catch (error) {
      draft.issues.push({ ...(page === undefined ? {} : { page }), type: '专业内容', message: `${item.label}：${error instanceof Error ? error.message : String(error)}；原件保留` })
      return null
    }
  }
  const shared: ComponentInstance[] = []
  for (const group of draft.shared ?? []) {
    const surfaceIds = surfaces.filter((_id, index) => draft.slides[index]!.sharedKeys?.includes(group.key))
    if (!surfaceIds.length) continue
    for (const item of [...group.items].sort((a, b) => a.order - b.order)) {
      const instance = convert(item)
      if (instance) shared.push({ ...instance, visibility: { mode: 'include', surfaceIds } })
    }
  }
  const pageInstances = draft.slides.map(slide => [...slide.items].sort((a, b) => a.order - b.order)
    .map(item => convert(item, slide.sourcePage)).filter((instance): instance is ComponentInstance => Boolean(instance)))
  // Page order, titles and backgrounds remain useful even when an empty page has
  // no objects, or a local professional object could not be carried across.
  for (const imported of draft.assets) edits.push({ type: 'asset.add', asset: structuredClone(imported.meta), bytes: imported.bytes })
  if (options.source) {
    const id = crypto.randomUUID()
    edits.push({ type: 'asset.add', asset: { id, path: `assets/${id}.pptx`, filename: options.source.filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', byteLength: options.source.bytes.byteLength }, bytes: options.source.bytes })
  }
  for (const [index, slide] of draft.slides.entries()) {
    const surfaceId = surfaces[index]!, instances = pageInstances[index]!, known = new Set(ids.keys())
    const rules = (slide.interactions ?? []).filter(rule => {
      const valid = !('nodeId' in rule.trigger) || known.has(rule.trigger.nodeId)
      if (!valid) draft.issues.push({ page: slide.sourcePage, type: '互动', message: `“${rule.name}”的触发对象无法导入，规则未附到其他对象` })
      return valid
    }).map(rule => ({ ...rule, actions: rule.actions.filter(step => !('nodeId' in step.action) || known.has(step.action.nodeId)) })).filter(rule => rule.actions.length)
    if (rules.length) {
      addDefinition(INTERACTIONS_DEFINITION)
      const id = crypto.randomUUID()
      instances.push({ id, definitionId: INTERACTIONS_DEFINITION.id, name: '导入互动',
        data: remapComponentInteractionData(json({ rules }), { instances: ids, surfaces: new Map() }),
        attachments: [{ instanceId: id, target: { kind: 'surface', surfaceId } }] })
    }
    edits.push({ type: 'surface.insert', index: project.surfaces.length + index,
      surface: { id: surfaceId, kind: 'slide', title: slide.title || `${title} ${index + 1}`, childIds: [], designSize: canvas, background: { mode: 'own', color: slide.backgroundColor } } },
      { type: 'instance.insert', container: { kind: 'surface', surfaceId }, index: 0, instances, rootIds: instances.map(item => item.id) })
  }
  if (shared.length) edits.push({ type: 'instance.insert', container: { kind: 'global', plane: 'underlay' }, index: project.global.underlay.length, instances: shared, rootIds: shared.map(item => item.id) })
  if (Object.keys(draft.sounds ?? {}).length) {
    const audio = project.media?.audio ?? { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 }, sounds: {}, narrationDucking: { enabled: false, musicVolume: .25, fadeMs: 300 } }
    edits.push({ type: 'project.media.set', media: { audio: { ...audio, sounds: { ...audio.sounds, ...draft.sounds } } } })
  }
  edits.unshift(...[...definitions.values()].map(definition => ({ type: 'definition.set' as const, definition })))
  return { ...captureComponentOperation(project, edits), documentId: target.documentId, epoch: target.epoch, createdSurfaceId: surfaces[0], originSurfaceId: target.surfaceId }
}
