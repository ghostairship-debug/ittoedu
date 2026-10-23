import { componentContainers } from '../../../shared/contracts/component-platform/project'
import { componentDataEdits } from '../../course/componentDataEdits'
import { equalComponentValue, prepareComponentTextRelationships } from '../../drivers/courseV10Operations'
import { professionalElementDefaultSize } from '../../course/professionalElementDefaults'
import { allDocumentTextSlots, inlineComponentIds, documentTextRanges, projectDataTextRanges, type DocumentRangeProjection } from '../../../shared/document/textInteraction'
import type { ComponentEdit, ComponentInstance, CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform'
import { documentBlockChildren, documentBlockSchema, documentContentSchema, documentTextSlots, normalizeDocumentText, type DocumentBlock } from '../../../shared/document/content'
import { documentResourceReferences } from '../../../shared/document/resources'
import type { MarkdownDocument } from '../../../shared/document/markdown'
import { createTextComponentData, textComponentDataSchema, formulaComponentDataSchema, createFormulaComponentData } from '../../../components/text/data'
import { TEXT_DEFINITION, FORMULA_DEFINITION } from '../../../components/text/adapters'
import { IMAGE_DEFINITION, imageDataSchema, createImageData } from '../../../components/image'
import { replaceImageSource } from '../../../components/image/data'
import { clampCrop } from '../../../shared/imageCrop'
import { VIDEO_DEFINITION, AUDIO_DEFINITION, createVideoData, createAudioData } from '../../../components/media'
import { CHART_DEFINITION, chartDataSchema } from '../../../components/chart'
import { TABLE_DEFINITION } from '../../../components/table/adapters'
import { createTableData, parseTableData } from '../../../components/table/data'
import { componentDefinitionBuiltinKey,type ComponentSurface } from '../../../shared/contracts/component-platform'
import { isNativeFlowLayoutGroup } from '../../../shared/flowNativeLayout'
import { componentLayoutInput } from '../../../components/web/measuredFragmentBox'

function flowSurface(project: CourseProjectV10, surfaceId: string): ComponentSurface {
  const surface = componentContainers(project).find(value => value.id === surfaceId)
  if (!surface || surface.kind !== 'flow') throw new Error('当前表面不是讲义')
  return surface
}
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../../components/document-block'
import { flowObjectExtent } from '../geometry/flowObjectExtent'
import { normalizeDocumentColor } from '../../../shared/document/color'
export { flowObjectExtent }
export { DOCUMENT_BLOCK_DEFINITION }
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
export interface FlowProjectionDiagnostic { instanceId: string; field: string; message: string }
export function isDocumentBlock(project: CourseProjectV10, instance: ComponentInstance): boolean {
  const key = componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  return key === 'guoling.text' || key === DOCUMENT_BLOCK_DEFINITION.id
}
/** Natural reading groups expose native content, while free composition and programs stay atomic. */
export function isFlowReadingGroup(project: CourseProjectV10, instanceId: string): boolean {
  const group = project.instances[instanceId]
  return Boolean(group && !group.container && isNativeFlowLayoutGroup(group, project.definitions[group.definitionId]))
}
/** Identity and section children come from instances; this is an editor projection, never a saved body. */
export function projectFlowBlock(project: CourseProjectV10, instanceId: string, diagnostics?: FlowProjectionDiagnostic[]): DocumentBlock {
  const instance = project.instances[instanceId]
  if (!instance) throw new Error(`正文对象已不存在：${instanceId}`)
  const implementation = project.definitions[instance.definitionId]?.implementation
  const atomic = () => ({ id: instance.id, type: 'course-instance' as const,
    ...(project.definitions[instance.definitionId]?.title ? { title: project.definitions[instance.definitionId].title } : {}) })
  if (instance.container) return atomic()
  if (implementation?.kind === 'builtin' && implementation.key === 'guoling.text' && !instance.implementationOverride) {
    if (componentLayoutInput(instance, { project, definition: project.definitions[instance.definitionId], kind: 'flow', inlineSize: 1 }).mode !== 'flow-content') return atomic()
    const text = textComponentDataSchema.parse(instance.data)
    const defaults = Object.fromEntries(Object.entries(text.appearance).filter(([key]) => ['fontFamily','fontSize','color','bold','italic','underline','strike','emphasis','highlightColor'].includes(key)))
    let colorUnavailable = false
    for (const field of ['color', 'highlightColor'] as const) {
      const value = text.appearance[field]
      if (value === null) continue
      const normalized = normalizeDocumentColor(value)
      if (normalized !== undefined) defaults[field] = normalized
      else {
        colorUnavailable = true
        diagnostics?.push({ instanceId: instance.id, field: `appearance.${field}`,
          message: `appearance.${field}=${JSON.stringify(value).slice(0, 160)} 无法表示为正文颜色；原对象与颜色已保留，可在对象数据中修改该字段。` })
      }
    }
    // CSS appearance is owned by the actual component. A document projection
    // cannot resolve every authored CSS color, so retain that editable instance.
    if (colorUnavailable) return atomic()
    return { id: instance.id, type: 'paragraph', content: text.content, textAlign: text.appearance.align, textDefaults: defaults,
      ...(text.appearance.lineSpacing!==undefined ? {lineSpacing:text.appearance.lineSpacing}:{}) }
  }
  if (implementation?.kind === 'builtin' && implementation.key === DOCUMENT_BLOCK_DEFINITION.id && !instance.implementationOverride) {
    const data = instance.data as Record<string, JsonValue>
    return documentBlockSchema.parse({ ...data, id: instance.id,
      ...(data.type === 'section' ? { blocks: (instance.childIds ?? []).map(id => projectFlowBlock(project, id, diagnostics)) } : {}) })
  }
  if (implementation?.kind === 'builtin' && implementation.key === FORMULA_DEFINITION.id && !instance.implementationOverride) {
    const data=formulaComponentDataSchema.parse(instance.data)
    return {id:instance.id,type:'formula',formulaId:data.formula.formulaId,latex:data.formula.latex,accessibleText:data.formula.accessibleText,style:data.formula.style ?? {fontSize:data.appearance.fontSize,color:data.appearance.color}}
  }
  if (implementation?.kind === 'builtin' && [IMAGE_DEFINITION.id,VIDEO_DEFINITION.id,AUDIO_DEFINITION.id].includes(implementation.key) && !instance.implementationOverride) {
    const data=instance.data as any, mediaKind=implementation.key.slice(8) as 'image'|'video'|'audio'
    return {id:instance.id,type:'media',assetId:data.assetId,mediaKind,altText:mediaKind==='image' ? data.alt:data.title,
      layout:instance.flowLayout?.width ?? 'content-width',...(instance.flowLayout?.wrap ? {wrap:instance.flowLayout.wrap}:{}),
      ...(instance.flowLayout?.caption ? {caption:instance.flowLayout.caption}:{}),
      ...(mediaKind==='image' ? {crop:clampCrop(data.crop),cropX:data.cropX,cropY:data.cropY}:{})}
  }
  if(implementation?.kind==='builtin' && implementation.key===TABLE_DEFINITION.id && !instance.implementationOverride) {
    const data=parseTableData(instance.data) as any
    return {id:instance.id,type:'table',headerEnabled:data.headerEnabled ?? data.columns.some((column:any)=>column.header?.inlines.length),
      columns:data.columns.map((column:any)=>({id:column.id,header:column.header ?? {inlines:[]}})),
      rows:data.rows.map((row:any)=>({id:row.id,cells:Object.fromEntries(row.cells.map((cell:any)=>[cell.columnId,cell.content ?? {inlines:[{type:'text',text:cell.text}]}]))})),
      ...(data.caption ? {caption:data.caption}:{}),...(data.merges ? {merges:data.merges}:{})}
  }
  if (isFlowReadingGroup(project, instanceId)) {
    const title = project.definitions[instance.definitionId]?.title
    return { id: instance.id, type: 'course-instance', ...(title ? { title } : {}), blocks: (instance.childIds ?? [])
      .filter(id => project.definitions[project.instances[id]?.definitionId]?.role !== 'behavior').map(id => projectFlowBlock(project, id, diagnostics)) }
  }
  if (implementation?.kind === 'builtin' && implementation.key === CHART_DEFINITION.id && !instance.implementationOverride) {
    return { id: instance.id, type: 'chart', chart: chartDataSchema.parse(instance.data), height: instance.frame?.height ?? 400 }
  }
  // The shared editor treats an arbitrary component as one object; its actual implementation stays in R0.
  return atomic()
}
export function flowBodyIds(project: CourseProjectV10, surfaceId: string): string[] {
  return flowSurface(project, surfaceId).childIds.filter(id => !project.instances[id].flowPlacement
    && project.definitions[project.instances[id].definitionId]?.role !== 'behavior')
}
export function projectFlowDocument(project: CourseProjectV10, surfaceId: string, diagnostics?: FlowProjectionDiagnostic[]): MarkdownDocument {
  const blocks=flowBodyIds(project,surfaceId).map(id=>projectFlowBlock(project,id,diagnostics)), refs=documentResourceReferences(blocks)
  return {content:{blocks},resources:{assets:refs.assets.map(assetId=>({assetId,source:{kind:'project'}})),components:[]}}
}
/** Only section children belong to the PM body; children of an opaque component stay in its own stage. */
export function flowDocumentBlock(project: CourseProjectV10, surfaceId: string, instanceId: string): DocumentBlock | undefined {
  const find = (blocks: readonly DocumentBlock[]): DocumentBlock | undefined => {
    for (const block of blocks) {
      if (block.id === instanceId) return block
      const children = documentBlockChildren(block)
      if (children) { const child = find(children); if (child) return child }
    }
  }
  return find(projectFlowDocument(project, surfaceId).content.blocks)
}
/** PM and Markdown coalesce adjacent equal text runs. That projection change alone is not an edit to the formal block. */
function sameFlowBlock(previous: DocumentBlock, block: DocumentBlock): boolean {
  if (equalComponentValue(previous, block)) return true
  if (previous.id !== block.id || previous.type !== block.type) return false
  const slots = new Map(documentTextSlots(previous).map(slot => [slot.key, slot.content]))
  const nextSlots = documentTextSlots(block)
  if (slots.size !== nextSlots.length) return false
  for (const slot of nextSlots) {
    const before = slots.get(slot.key)
    if (!before || !equalComponentValue(before, slot.content) && !equalComponentValue(normalizeDocumentText(before), normalizeDocumentText(slot.content))) return false
  }
  // Compare all remaining attributes and structure against the original slot values.
  let retainedSlots: DocumentBlock = block.type === 'list' ? { ...block, items: block.items.map(item => ({ ...item, content: slots.get(`item:${item.id}`)! })) }
    : block.type === 'table' ? { ...block,
      columns: block.columns.map(column => ({ ...column, header: slots.get(`column:${column.id}`)! })),
      rows: block.rows.map(row => ({ ...row, cells: Object.fromEntries(Object.keys(row.cells).map(column => [column, slots.get(`cell:${JSON.stringify([row.id, column])}`)!])) })),
      ...(block.caption ? { caption: slots.get('caption')! } : {}),
    } : { ...block, ...Object.fromEntries(slots) }
  const children = documentBlockChildren(previous), nextChildren = documentBlockChildren(block)
  if (children || nextChildren) {
    if (!children || !nextChildren || children.length !== nextChildren.length || !children.every((child, index) => sameFlowBlock(child, nextChildren[index]))) return false
    retainedSlots = { ...retainedSlots, blocks: children } as DocumentBlock
  }
  return equalComponentValue(previous, retainedSlots)
}
function blockInstance(project: CourseProjectV10, block: DocumentBlock): ComponentInstance {
  const previous = project.instances[block.id]
  const implementation = previous && !previous.implementationOverride ? project.definitions[previous.definitionId]?.implementation : undefined
  const key = implementation?.kind === 'builtin' ? implementation.key : undefined
  const definitionId = (builtin: string) => key === builtin ? previous.definitionId : builtin
  if (block.type === 'course-instance') {
    if (!previous) throw new Error(`正文引用的正式实例已不存在：${block.id}`)
    if (block.blocks !== undefined && !isFlowReadingGroup(project, block.id)) throw new Error('此对象不是可连续编辑的原生阅读组，原对象与输入已保留')
    return previous
  }
  const priorBlock = previous ? projectFlowBlock(project, block.id) : undefined
  if (priorBlock && sameFlowBlock(priorBlock, block)) return previous
  if (priorBlock?.type === 'course-instance') throw new Error('专业对象的内容请在组件属性中修改；正文源码仅保留该对象的正式引用和阅读顺序')
  if (block.type === 'paragraph') {
    const text = key === TEXT_DEFINITION.id ? textComponentDataSchema.parse(previous.data) : createTextComponentData()
    const { align: _align, lineSpacing: _lineSpacing, ...appearance } = text.appearance
    return { ...previous, id: block.id, definitionId: definitionId(TEXT_DEFINITION.id), data: json({ ...text, content: block.content,
      appearance: { ...appearance, ...block.textDefaults, align: block.textAlign ?? 'left',
        ...(block.lineSpacing!==undefined ? {lineSpacing:block.lineSpacing}:{}) } }) }
  }
  if(block.type==='formula') {
    const data=key === FORMULA_DEFINITION.id ? formulaComponentDataSchema.parse(previous.data) : createFormulaComponentData(block.formulaId,block.latex)
    const {id:_id,type:_type,...formula}=block
    return {...previous,id:block.id,definitionId:definitionId(FORMULA_DEFINITION.id),data:json({...data,formula:{...formula,type:'math'}})}
  }
  if(block.type==='media') {
    const assetId=block.assetId ?? Object.values(project.assets).find(asset=>asset.path===block.source)?.id
    if(!assetId)throw new Error(`媒体素材未找到：${block.source ?? block.id}`)
    const builtin=block.mediaKind==='image' ? IMAGE_DEFINITION.id : block.mediaKind==='video' ? VIDEO_DEFINITION.id : AUDIO_DEFINITION.id
    const initial=key===builtin ? previous.data as any : block.mediaKind==='image' ? createImageData(assetId) : block.mediaKind==='video' ? createVideoData(assetId):createAudioData(assetId)
    const imageInitial = block.mediaKind === 'image' && initial.assetId !== assetId ? replaceImageSource(imageDataSchema.parse(initial), assetId) : initial
    const data=block.mediaKind==='image' ? imageDataSchema.parse({...imageInitial,assetId,alt:block.altText ?? initial.alt,crop:block.crop ?? createImageData(assetId).crop,cropX:block.cropX ?? 0.5,cropY:block.cropY ?? 0.5}) : {...initial,assetId,title:block.altText ?? initial.title}
    return {...previous,id:block.id,definitionId:definitionId(builtin),data:json(data),flowLayout:{width:block.layout,...(block.wrap ? {wrap:block.wrap}:{}),...(block.caption ? {caption:block.caption}:{})}}
  }
  if(block.type==='chart')return {...previous,id:block.id,definitionId:definitionId(CHART_DEFINITION.id),data:json(chartDataSchema.parse(block.chart)),
    frame: { ...(previous?.frame ?? { ...professionalElementDefaultSize('chart'), transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }), height: block.height } }
  if(block.type==='table') {
    const initial=key===TABLE_DEFINITION.id ? parseTableData(previous.data) as any : createTableData({rows:Math.max(1,block.rows.length),columns:block.columns.length}) as any
    const columns=block.columns.map(column=>({...initial.columns.find((value:any)=>value.id===column.id),id:column.id,width:initial.columns.find((value:any)=>value.id===column.id)?.width ?? 200,
      header:column.header}))
    const rows=block.rows.map(row=>{const old=initial.rows.find((value:any)=>value.id===row.id);return {...old,id:row.id,height:old?.height ?? 40,cells:block.columns.map(column=>{
      const cell=old?.cells.find((value:any)=>value.columnId===column.id)
      if(cell?.text!==undefined && same(row.cells[column.id],{inlines:[{type:'text',text:cell.text}]}))return cell
      const {text:_text,content:_content,...fields}=cell ?? {}
      return {...fields,id:cell?.id ?? `${row.id}_${column.id}`,columnId:column.id,content:row.cells[column.id]}
    })}})
    return {...previous,id:block.id,definitionId:definitionId(TABLE_DEFINITION.id),data:json(parseTableData({...initial,columns,rows,headerEnabled:block.headerEnabled ?? true,caption:block.caption,merges:block.merges}))}
  }
  return { ...previous, id: block.id, definitionId: definitionId(DOCUMENT_BLOCK_DEFINITION.id), data: documentBlockData(block),
    ...(block.type === 'section' ? { childIds: block.blocks.map(child => child.id) } : {}) }
}
/** Convert one edit projection into canonical instance edits while retaining unrelated floating/behavior roots. */
export function flowDocumentEdits(project: CourseProjectV10, surfaceId: string, blocks: DocumentBlock[], readingBaseline=project, rangeProjection?: readonly DocumentRangeProjection[], changedBlockIds?: readonly string[],
  options: { deferTextRelationshipCleanup?: boolean } = {}): ComponentEdit[] {
  // The layout editor supplies this hint only for text/mark steps. Check the
  // structural carrier identities too; source/structural edits keep reconciliation.
  if (changedBlockIds?.length) {
    const indexed = new Map<string, DocumentBlock>()
    const matches = (items: readonly DocumentBlock[], ids: readonly string[]): boolean => items.length === ids.length && items.every((block, index) => {
      if (block.id !== ids[index]) return false
      indexed.set(block.id, block)
      const instance = readingBaseline.instances[block.id]
      const section = instance && componentDefinitionBuiltinKey(readingBaseline.definitions[instance.definitionId]) === DOCUMENT_BLOCK_DEFINITION.id
        && (instance.data as Record<string, JsonValue>).type === 'section'
      const children = documentBlockChildren(block)
      if (block.type === 'section') return Boolean(section && matches(block.blocks, instance.childIds ?? []))
      if (block.type === 'course-instance' && children) return isFlowReadingGroup(readingBaseline, block.id)
        && matches(children, (instance.childIds ?? []).filter(id => readingBaseline.definitions[readingBaseline.instances[id]?.definitionId]?.role !== 'behavior'))
      return !section && !isFlowReadingGroup(readingBaseline, block.id)
    })
    if (matches(blocks, flowBodyIds(readingBaseline, surfaceId)) && changedBlockIds.every(id => indexed.has(id) && project.instances[id])) {
      const local: ComponentEdit[] = []
      for (const id of new Set(changedBlockIds)) {
        const block = documentBlockSchema.parse(indexed.get(id)!)
        if (block.type === 'section' || block.type === 'course-instance') return flowDocumentEdits(project, surfaceId, blocks, readingBaseline, rangeProjection, undefined, options)
        const instance = blockInstance(project, block)
        if (!same(project.instances[id].data, instance.data)) local.push(...componentDataEdits(project, { surfaceId, instanceId: id }, {
          kind: 'replace', data: instance.data as JsonValue,
          ...(rangeProjection?.some(field => field.blockId === id) ? { rangeProjection: projectDataTextRanges(instance.data) } : {}),
        }))
      }
      return prepareComponentTextRelationships(project, local, options)
    }
  }
  const parsed = documentContentSchema.parse({ blocks }).blocks
  const surface = flowSurface(project, surfaceId), edits: ComponentEdit[] = [], desired = new Map<string, ComponentInstance>(), retained = new Set<string>()
  const retain = (id: string) => { retained.add(id); for (const child of project.instances[id]?.childIds ?? []) retain(child) }
  const visit = (items: DocumentBlock[]) => { for (const block of items) {
    desired.set(block.id, blockInstance(project, block))
    if (block.type === 'course-instance' && block.blocks === undefined) retain(block.id)
    const previous = project.instances[block.id]
    if (previous) {
      const exposed = new Set(documentBlockChildren(projectFlowBlock(project, block.id))?.map(child => child.id) ?? [])
      for (const child of previous.childIds ?? []) if (!exposed.has(child)) retain(child)
    }
    const children = documentBlockChildren(block)
    if (children) visit(children)
  } }
  visit(parsed)
  for(const definition of [TEXT_DEFINITION,DOCUMENT_BLOCK_DEFINITION,FORMULA_DEFINITION,IMAGE_DEFINITION,VIDEO_DEFINITION,AUDIO_DEFINITION,CHART_DEFINITION,TABLE_DEFINITION]) {
    if([...desired.values()].some(instance=>instance.definitionId===definition.id) && !project.definitions[definition.id])edits.push({type:'definition.set',definition})
  }
  const oldBody = flowBodyIds(project, surfaceId)
  const roots = parsed.map(block => block.id), rootSet = new Set(roots), oldRootSet = new Set(flowBodyIds(readingBaseline,surfaceId))
  const rootOrder: string[] = []
  let nextRoot = 0, insertAt: number | undefined
  for (const id of flowSurface(readingBaseline,surfaceId).childIds) {
    if (oldRootSet.has(id)) {
      insertAt ??= rootOrder.length
      if (rootSet.has(id)) { rootOrder.push(roots[nextRoot++]); insertAt = rootOrder.length }
    } else rootOrder.push(id)
  }
  rootOrder.splice(insertAt ?? rootOrder.length, 0, ...roots.slice(nextRoot))
  const oldIds = new Set<string>()
  const oldVisit = (ids: string[]) => { for (const id of ids) { oldIds.add(id); oldVisit(project.instances[id]?.childIds ?? []) } }
  oldVisit(oldBody)
  const currentChildren = new Map<string, string[]>([['surface', [...surface.childIds]]])
  for (const instance of Object.values(project.instances)) currentChildren.set(instance.id, [...(instance.childIds ?? [])])
  const place = (id: string, parent: string, index: number) => {
    for (const children of currentChildren.values()) { const old = children.indexOf(id); if (old >= 0) children.splice(old, 1) }
    const children = currentChildren.get(parent) ?? []; children.splice(index, 0, id); currentChildren.set(parent, children)
  }
  // Move surviving descendants out before deleting a section that held them.
  const ordered = (items: DocumentBlock[], container: { kind: 'surface'; surfaceId: string } | { kind: 'instance'; instanceId: string }) => {
    for (const [index, block] of items.entries()) {
      const instance = desired.get(block.id)!, previous = project.instances[block.id]
      const parent = container.kind === 'surface' ? 'surface' : container.instanceId
      // Surface roots include floating and behavior objects that are absent from the editor projection.
      // Defer their ordering until obsolete body roots have been removed.
      let insertionIndex = container.kind === 'surface' ? (currentChildren.get(parent)?.length ?? 0) : index
      if (!previous) {
        if (container.kind === 'surface') {
          // New roots are inserted in their final interval between the fixed floating/behavior roots.
          // Only original body instances are moved later, so capture never needs a new instance's owner.
          const siblings = currentChildren.get(parent) ?? [], position = rootOrder.indexOf(block.id)
          const fixed = (id: string) => !rootSet.has(id) || !project.instances[id]
          const after = rootOrder.slice(position + 1).find(id => fixed(id) && siblings.includes(id))
          const before = rootOrder.slice(0, position).reverse().find(id => fixed(id) && siblings.includes(id))
          insertionIndex = after ? siblings.indexOf(after) : before ? siblings.indexOf(before) + 1 : siblings.length
        }
        edits.push({ type: 'instance.insert', container, index: insertionIndex, instances: [{ ...instance, ...(documentBlockChildren(block) ? { childIds: [] } : {}) }], rootIds: [block.id] })
        place(block.id, parent, insertionIndex)
        const children = documentBlockChildren(block)
        if (children) { currentChildren.set(block.id, []); ordered(children, { kind: 'instance', instanceId: block.id }) }
        continue
      }
      if (previous.definitionId !== instance.definitionId) {
        // Keep identity/frame/style through an in-place professional type change.
        edits.push({ type: 'instance.definition.set', instanceId: block.id, definitionId: instance.definitionId })
      }
      if (!same(previous.data, instance.data)) edits.push(...componentDataEdits(project, { surfaceId, instanceId: block.id }, { kind: 'replace', data: instance.data as JsonValue, ...(rangeProjection?.some(field => field.blockId === block.id) ? { rangeProjection: projectDataTextRanges(instance.data) } : {}) }))
      if (!same(previous.frame, instance.frame)) edits.push({ type: 'frame.set', instanceId: block.id, frame: instance.frame ?? null })
      if (!same(previous.flowLayout,instance.flowLayout)) edits.push({type:'instance.flowLayout.set',instanceId:block.id,flowLayout:instance.flowLayout ?? null})
      const siblings = currentChildren.get(parent) ?? []
      if (container.kind === 'surface' ? !siblings.includes(block.id) : siblings[index] !== block.id) {
        edits.push({ type: 'instance.move', instanceId: block.id, container, index: insertionIndex, ...(instance.frame ? { frame: instance.frame } : {}) }); place(block.id, parent, insertionIndex)
      }
      const children = documentBlockChildren(block)
      if (children) ordered(children, { kind: 'instance', instanceId: block.id })
    }
  }
  ordered(parsed, { kind: 'surface', surfaceId })
  for (const id of oldIds) if (!edits.some(edit => edit.type === 'instance.remove' && edit.instanceId === id) && !desired.has(id) && !retained.has(id) && ![...oldIds].some(parent => !desired.has(parent) && !retained.has(parent) && project.instances[parent]?.childIds?.includes(id))) {
    edits.push({ type: 'instance.remove', instanceId: id })
    for (const children of currentChildren.values()) { const index = children.indexOf(id); if (index >= 0) children.splice(index, 1) }
  }
  const moveRoot = (id: string, index: number) => {
    edits.push({ type: 'instance.move', instanceId: id, container: { kind: 'surface', surfaceId }, index, ...(desired.get(id)?.frame ? { frame: desired.get(id)!.frame } : {}) })
    place(id, 'surface', index)
  }
  const siblings = currentChildren.get('surface')!
  for (const [index, id] of rootOrder.entries()) {
    if (rootSet.has(id) && project.instances[id]) { if (siblings[index] !== id) moveRoot(id, index) }
    else {
      // An unrelated root stays in place; move the body objects preceding it to their own slots.
      while (siblings[index] !== id) moveRoot(siblings[index], rootOrder.indexOf(siblings[index]))
    }
  }
  const destinations = [...desired].flatMap(([instanceId, instance]) => allDocumentTextSlots(instance.data).map(slot => ({ instanceId, dataPath: slot.path, content: slot.content })))
  const slotMigrations = [...oldIds].flatMap(instanceId => allDocumentTextSlots(project.instances[instanceId]?.data).map(slot => ({
    from: { instanceId, dataPath: slot.path }, to: destinations.filter(candidate => [...documentTextRanges(slot.content).keys()]
      .some(rangeId => documentTextRanges(candidate.content).has(rangeId))).map(({ instanceId, dataPath }) => ({ instanceId, dataPath })),
  })))
  return prepareComponentTextRelationships(project, edits, { ...options, slotMigrations })
}
