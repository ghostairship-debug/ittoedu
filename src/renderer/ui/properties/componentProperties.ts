import { resolveComponentBackground, type ComponentDefinition, type ComponentInstance, type ComponentPresentationState, type ComponentSurface, type CourseProjectV10, type JsonValue } from '../../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { ComponentFrame } from '../../../shared/contracts/component-platform/frame'
import type { FormulaAstNode, TextNode, TextRun } from '../../../shared/contracts/native-v1'
import { parseFormulaLinear } from '../../../shared/formulaLinear'
import { parseDocumentMath } from '../../../shared/document/math'
import { textComponentDataSchema, formulaComponentDataSchema, type TextComponentData } from '../../../components/text/data'
import { shapeDataSchema } from '../../../components/shape/data'
import { imageDataSchema } from '../../../components/image/data'
import { tableDataSchema, toNativeTableData, type TableData } from '../../../components/table/data'
import { chartDataSchema } from '../../../components/chart/data'
import { videoDataSchema } from '../../../components/media/data'
import { inputAuthoringContent, inputContentPatchEdits } from '../../../components/input/authoring'
import { switchShapeType } from '../../../components/shape/authoring'
import type { PropertiesItemBase, PropertiesItemView, PropertiesPatch } from './SlideNativePropertiesPanel'
import { componentDefinitionPresentation } from './componentDefinitionPresentation'

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

export function propertiesEffectiveBackground(project: CourseProjectV10, surface?: ComponentSurface, state?: ComponentPresentationState) {
  const paint = resolveComponentBackground(project, surface, state)
  const sourceOwner = state?.background && state.background.mode !== 'inherit'
    && ['color', 'assetId', 'fit'].some(field => Reflect.get(state.background!, field) !== undefined) ? 'slide-state' as const
    : surface?.background?.mode === 'own' ? surface.kind === 'slide' ? 'slide-surface' as const
      : surface.kind === 'flow' ? 'flow-surface' as const : 'spatial-surface' as const : 'course' as const
  return { ...paint, sourceOwner }
}

/** Feedback actions can address the mounted page and global trees. */
export function propertiesFeedbackTargets(project: CourseProjectV10, surfaceId: string, selectedId: string) {
  const ids = new Set<string>()
  const visit = (id: string) => { ids.add(id); for (const child of project.instances[id]?.childIds ?? []) visit(child) }
  for (const id of [...project.global.underlay, ...project.global.overlay,
    ...(project.surfaces.find(surface => surface.id === surfaceId)?.childIds ?? [])]) visit(id)
  return Object.values(project.instances).filter(instance => ids.has(instance.id) && instance.id !== selectedId
    && project.definitions[instance.definitionId]?.role !== 'behavior'
    && (!instance.visibility || instance.visibility.mode === 'all' || (instance.visibility.mode === 'include'
      ? instance.visibility.surfaceIds.includes(surfaceId) : !instance.visibility.surfaceIds.includes(surfaceId))))
    .map(instance => ({ id: instance.id, name: instance.name ?? project.definitions[instance.definitionId]?.title ?? instance.id }))
}

/** Math is an atom in a plain-text control; retaining this marker retains its source and identity. */
export function propertiesText(data: TextComponentData): string {
  return data.content.inlines.map(inline => inline.type === 'text' ? inline.text : '\uFFFC').join('')
}

export function propertiesTextRuns(data: TextComponentData): TextRun[] {
  let offset = 0
  return data.content.inlines.flatMap(inline => {
    const length = inline.type === 'text' ? Array.from(inline.text).length : 1
    const run = inline.style ? [{ start: offset, end: offset + length, style: structuredClone(inline.style) }] : []
    offset += length
    return run
  })
}

/** Original text fields show math atoms as indivisible markers; the table leaf owns rich author data. */
export function propertiesTableView(data: TableData) {
  const native = toNativeTableData(data, false)
  const cells = new Map(data.rows.flatMap(row => row.cells).map(cell => [cell.id, cell]))
  return { ...native, rows: native.rows.map(row => ({ ...row, cells: row.cells.map(cell => {
    const content = cells.get(cell.id)?.content
    return content ? { ...cell, text: content.inlines.map(inline => inline.type === 'text' ? inline.text : '\uFFFC').join('') } : cell
  }) })) }
}

export function componentPropertiesView(instance: ComponentInstance, definition?: ComponentDefinition): PropertiesItemView {
  const presentation = componentDefinitionPresentation(definition)
  const frame = instance.frame
  const transform = frame?.transform ?? [1, 0, 0, 1, 0, 0]
  const base: PropertiesItemBase = {
    id: instance.id, name: instance.name ?? presentation.title,
    x: transform[4]!, y: transform[5]!, width: frame?.width ?? 0, height: frame?.height ?? 0,
    rotation: Math.atan2(transform[1]!, transform[0]!) * 180 / Math.PI,
    opacity: typeof instance.style?.opacity === 'number' ? instance.style.opacity : 1,
    visible: instance.visible !== false, locked: instance.locked === true,
    playbackInitialVisibility: instance.playbackInitialVisibility ?? 'inherit',
  }
  // A private implementation override does not replace the definition's professional data/editor.
  const key = presentation.builtinKey
  if (key === 'guoling.text') {
    const data = textComponentDataSchema.parse(instance.data)
    const appearance = data.appearance as typeof data.appearance & Partial<TextNode['style']> & { flipX?: boolean; flipY?: boolean }
    return { ...base, type: 'text', text: propertiesText(data), runs: propertiesTextRuns(data),
      flipX: appearance.flipX ?? false, flipY: appearance.flipY ?? false,
      style: { fontFamily: appearance.fontFamily, fontSize: appearance.fontSize, color: appearance.color,
        bold: appearance.bold ?? false, italic: appearance.italic ?? false, underline: appearance.underline ?? false,
        strike: appearance.strike ?? false, emphasis: appearance.emphasis ?? false, highlightColor: appearance.highlightColor ?? null,
        align: appearance.align, verticalAlign: appearance.verticalAlign ?? 'top', writingMode: appearance.writingMode ?? 'horizontal',
        lineSpacing: appearance.lineSpacing ?? Math.max(0, appearance.fontSize * ((appearance.lineHeight === 'normal' ? 1.22 : appearance.lineHeight) - 1.22)),
        letterSpacing: appearance.letterSpacing ?? 0, padding: appearance.padding ?? 0,
        overflow: data.sizing.mode === 'grow-height' ? 'auto-height' : data.sizing.mode === 'shrink-text' ? 'shrink' : 'fixed',
        backgroundColor: appearance.backgroundColor ?? '#ffffff', backgroundOpacity: appearance.backgroundOpacity ?? 0,
        cornerRadius: appearance.cornerRadius ?? 0,
      } }
  }
  if (key === 'guoling.formula') {
    const data = formulaComponentDataSchema.parse(instance.data)
    let ast: FormulaAstNode | null = null
    try { ast = parseFormulaLinear(data.formula.latex) } catch { /* Formal math accepts additional structures. */ }
    return { ...base, type: 'formula', formulaId: data.formula.formulaId,
      ast, latex: data.formula.latex, accessibleText: data.formula.accessibleText,
      style: { fontSize: data.formula.style?.fontSize ?? data.appearance.fontSize,
        color: data.formula.style?.color ?? data.appearance.color, align: data.appearance.align } }
  }
  if (key === 'guoling.shape') return { ...base, type: 'shape', ...shapeDataSchema.parse(instance.data) }
  if (key === 'guoling.image') return { ...base, type: 'image', ...imageDataSchema.parse(instance.data) }
  if (key === 'guoling.table') return { ...base, type: 'table', ...propertiesTableView(tableDataSchema.parse(instance.data) as TableData) }
  if (key === 'guoling.chart') return { ...base, type: 'chart', ...chartDataSchema.parse(instance.data) }
  if (key === 'guoling.video') return { ...base, type: 'video', ...videoDataSchema.parse(instance.data) }
  if (key === 'guoling.input') return { ...base, type: 'input', ...inputAuthoringContent(instance) }
  if (instance.childIds) return { ...base, type: 'composition' }
  return { ...base, type: 'external-component', component: { packageId: instance.definitionId, version: definition?.version ?? '1' },
    props: instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? structuredClone(instance.data) : {} }
}

/** A rotation left-multiplies the parent-local linear part, preserving shear and scale. */
export function propertiesFramePatch(frame: ComponentFrame, patch: PropertiesPatch): ComponentFrame {
  const transform = [...frame.transform] as ComponentFrame['transform']
  if (typeof patch.rotation === 'number') {
    const old = Math.atan2(transform[1], transform[0])
    const angle = patch.rotation * Math.PI / 180 - old
    const cosine = Math.cos(angle), sine = Math.sin(angle)
    const [a, b, c, d] = transform
    transform[0] = cosine * a - sine * b; transform[1] = sine * a + cosine * b
    transform[2] = cosine * c - sine * d; transform[3] = sine * c + cosine * d
  }
  if (typeof patch.x === 'number') transform[4] = patch.x
  if (typeof patch.y === 'number') transform[5] = patch.y
  return { width: typeof patch.width === 'number' ? patch.width : frame.width,
    height: typeof patch.height === 'number' ? patch.height : frame.height, transform }
}

function leafEdits(instanceId: string, patch: unknown, path: string[] = []): ComponentEdit[] {
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) return Object.entries(patch)
    .flatMap(([key, value]) => value === undefined ? [] : leafEdits(instanceId, value, [...path, key]))
  return [{ type: 'data.set', instanceId, path, value: json(patch) }]
}

/** Convert the original professional controls to actual V10 field operations. */
export function componentPropertiesEdits(instance: ComponentInstance, definition: ComponentDefinition | undefined, patch: PropertiesPatch): ComponentEdit[] {
  const view = componentPropertiesView(instance, definition)
  const edits: ComponentEdit[] = []
  const metadata: Extract<ComponentEdit, { type: 'instance.patch' }>['patch'] = {}
  if (typeof patch.name === 'string') metadata.name = patch.name
  if (typeof patch.visible === 'boolean') metadata.visible = patch.visible
  if (typeof patch.locked === 'boolean') metadata.locked = patch.locked
  if (patch.playbackInitialVisibility) metadata.playbackInitialVisibility = patch.playbackInitialVisibility
  if (Object.keys(metadata).length) edits.push({ type: 'instance.patch', instanceId: instance.id, patch: metadata })
  if (typeof patch.opacity === 'number') edits.push({ type: 'style.set', instanceId: instance.id, path: ['opacity'], value: patch.opacity })
  if (['x', 'y', 'width', 'height', 'rotation'].some(key => key in patch)) {
    if (!instance.frame) throw new Error('正文实例没有自由 frame；请使用正文版式控件。')
    edits.push({ type: 'frame.set', instanceId: instance.id, frame: propertiesFramePatch(instance.frame, patch) })
  }
  const content = Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== undefined
    && !['id', 'name', 'type', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked', 'playbackInitialVisibility'].includes(key)))
  if (view.type === 'text') {
    const style = content.style as Partial<TextNode['style']> | undefined
    if (style) {
      const { overflow, ...appearance } = style
      edits.push(...leafEdits(instance.id, appearance, ['appearance']))
      if (overflow) edits.push({ type: 'data.set', instanceId: instance.id, path: ['sizing', 'mode'],
        value: overflow === 'auto-height' ? 'grow-height' : overflow === 'shrink' ? 'shrink-text' : 'fixed' })
    }
    for (const key of ['flipX', 'flipY']) if (key in content) edits.push(...leafEdits(instance.id, content[key], ['appearance', key]))
  } else if (view.type === 'formula') {
    const formula = formulaComponentDataSchema.parse(instance.data).formula
    if (typeof content.latex === 'string') {
      parseDocumentMath(content.latex)
      edits.push({ type: 'data.set', instanceId: instance.id, path: ['formula', 'latex'], value: content.latex })
    }
    if (content.ast) {
      const latex = formulaAstLatex(content.ast as FormulaAstNode)
      parseDocumentMath(latex)
      edits.push({ type: 'data.set', instanceId: instance.id, path: ['formula', 'latex'], value: latex })
    }
    if (typeof content.accessibleText === 'string') edits.push({ type: 'data.set', instanceId: instance.id, path: ['formula', 'accessibleText'], value: content.accessibleText })
    if (content.style) for (const [field, value] of Object.entries(content.style)) {
      // Inline formula size/color override the block appearance in the shared renderer.
      const owner = (field === 'fontSize' || field === 'color') && formula.style?.[field] !== undefined
        ? ['formula', 'style', field] : ['appearance', field]
      if (value !== undefined) edits.push(...leafEdits(instance.id, value, owner))
    }
  } else if (view.type === 'shape' && content.shapeType) {
    edits.push(switchShapeType({ ...instance, data: shapeDataSchema.parse(instance.data) }, content.shapeType as typeof view.shapeType))
    const { shapeType: _shapeType, ...rest } = content
    edits.push(...leafEdits(instance.id, rest))
  } else if (view.type === 'external-component') {
    if (content.props) edits.push(...leafEdits(instance.id, content.props))
  } else if (view.type === 'input') {
    if (Object.keys(content).length) edits.push(...inputContentPatchEdits(instance, content))
  } else if (view.type === 'table') {
    if (content.style) edits.push(...leafEdits(instance.id, content.style, ['style']))
    if (Array.isArray(content.rows)) for (const row of content.rows as typeof view.rows) {
      const rowIndex = view.rows.findIndex(value => value.id === row.id)
      if (rowIndex < 0) continue
      for (const cell of row.cells) {
        const cellIndex = view.rows[rowIndex].cells.findIndex(value => value.id === cell.id)
        if (cellIndex < 0) continue
        const old = view.rows[rowIndex].cells[cellIndex]
        if (cell.style && JSON.stringify(cell.style) !== JSON.stringify(old.style)) edits.push(...leafEdits(instance.id, cell.style, ['rows', String(rowIndex), 'cells', String(cellIndex), 'style']))
      }
    }
  } else {
    edits.push(...leafEdits(instance.id, content))
  }
  return edits
}

/** The AST is derived by the original editor. LaTeX remains the sole persisted formula source. */
export function formulaAstLatex(ast: FormulaAstNode): string {
  switch (ast.type) {
    case 'row': return ast.children.map(formulaAstLatex).join(' ')
    case 'token': case 'operator': return ast.value
    case 'fraction': return `\\frac{${formulaAstLatex(ast.numerator)}}{${formulaAstLatex(ast.denominator)}}`
    case 'root': return `\\sqrt${ast.index ? `[${formulaAstLatex(ast.index)}]` : ''}{${formulaAstLatex(ast.radicand)}}`
    case 'script': return `{${formulaAstLatex(ast.base)}}${ast.subscript ? `_{${formulaAstLatex(ast.subscript)}}` : ''}${ast.superscript ? `^{${formulaAstLatex(ast.superscript)}}` : ''}`
    case 'fenced': return `\\left${ast.open === '{' ? '\\{' : ast.open}${formulaAstLatex(ast.body)}\\right${ast.close === '}' ? '\\}' : ast.close}`
  }
}
