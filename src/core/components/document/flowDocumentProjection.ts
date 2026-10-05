import type { ComponentEdit, ComponentInstance, CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform'
import { documentBlockSchema, documentContentSchema, type DocumentBlock } from '../../../shared/document/content'
import { documentResourceReferences } from '../../../shared/document/resources'
import type { MarkdownDocument } from '../../../shared/document/markdown'
import { createTextComponentData, textComponentDataSchema, formulaComponentDataSchema, createFormulaComponentData } from '../../../components/text/data'
import { TEXT_DEFINITION, FORMULA_DEFINITION } from '../../../components/text/adapters'
import { IMAGE_DEFINITION, imageDataSchema, createImageData } from '../../../components/image'
import { VIDEO_DEFINITION, AUDIO_DEFINITION, createVideoData, createAudioData } from '../../../components/media'
import { CHART_DEFINITION, chartDataSchema } from '../../../components/chart'
import { TABLE_DEFINITION } from '../../../components/table/adapters'
import { createTableData, parseTableData } from '../../../components/table/data'
import { componentDefinitionBuiltinKey,type ComponentSurface } from '../../../shared/contracts/component-platform'

function flowSurface(project: CourseProjectV10, surfaceId: string): ComponentSurface {
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (!surface || surface.kind !== 'flow') throw new Error('当前表面不是讲义')
  return surface
}
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../../components/document-block'
import { flowObjectExtent } from '../geometry/flowObjectExtent'
export { flowObjectExtent }
export { DOCUMENT_BLOCK_DEFINITION }
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
export function isDocumentBlock(project: CourseProjectV10, instance: ComponentInstance): boolean {
  const key = componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  return key === 'guoling.text' || key === DOCUMENT_BLOCK_DEFINITION.id
}
/** Identity and section children come from instances; this is an editor projection, never a saved body. */
export function projectFlowBlock(project: CourseProjectV10, instanceId: string): DocumentBlock {
  const instance = project.instances[instanceId]
  if (!instance) throw new Error(`正文对象已不存在：${instanceId}`)
  const implementation = project.definitions[instance.definitionId]?.implementation
  if (implementation?.kind === 'builtin' && implementation.key === 'guoling.text' && !instance.implementationOverride) {
    const text = textComponentDataSchema.parse(instance.data)
    return { id: instance.id, type: 'paragraph', content: text.content, textAlign: text.appearance.align,
      ...(text.appearance.lineSpacing!==undefined ? {lineSpacing:text.appearance.lineSpacing}:{}) }
  }
  if (implementation?.kind === 'builtin' && implementation.key === DOCUMENT_BLOCK_DEFINITION.id && !instance.implementationOverride) {
    const data = instance.data as Record<string, JsonValue>
    return documentBlockSchema.parse({ ...data, id: instance.id,
      ...(data.type === 'section' ? { blocks: (instance.childIds ?? []).map(id => projectFlowBlock(project, id)) } : {}) })
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
      ...(mediaKind==='image' ? {crop:data.crop,cropX:data.cropX,cropY:data.cropY}:{})}
  }
  if(implementation?.kind==='builtin' && implementation.key===TABLE_DEFINITION.id && !instance.implementationOverride) {
    const data=parseTableData(instance.data) as any
    return {id:instance.id,type:'table',headerEnabled:data.headerEnabled ?? data.columns.some((column:any)=>column.header),
      columns:data.columns.map((column:any)=>({id:column.id,header:column.header ?? {inlines:[]}})),
      rows:data.rows.map((row:any)=>({id:row.id,cells:Object.fromEntries(row.cells.map((cell:any)=>[cell.columnId,cell.content ?? {inlines:[{type:'text',text:cell.text}]}]))})),
      ...(data.caption ? {caption:data.caption}:{}),...(data.merges ? {merges:data.merges}:{})}
  }
  // The shared editor treats an arbitrary component as one object; its actual implementation stays in R0.
  const title = project.definitions[instance.definitionId]?.title
  return { id: instance.id, type: 'course-instance', ...(title ? { title } : {}) }
}
export function flowBodyIds(project: CourseProjectV10, surfaceId: string): string[] {
  return flowSurface(project, surfaceId).childIds.filter(id => !project.instances[id].flowPlacement
    && project.definitions[project.instances[id].definitionId]?.role !== 'behavior')
}
export function projectFlowDocument(project: CourseProjectV10, surfaceId: string): MarkdownDocument {
  const blocks=flowBodyIds(project,surfaceId).map(id=>projectFlowBlock(project,id)), refs=documentResourceReferences(blocks)
  return {content:{blocks},resources:{assets:refs.assets.map(assetId=>({assetId,source:{kind:'project'}})),components:[]}}
}
/** Only section children belong to the PM body; children of an opaque component stay in its own stage. */
export function flowDocumentBlock(project: CourseProjectV10, surfaceId: string, instanceId: string): DocumentBlock | undefined {
  const find = (blocks: readonly DocumentBlock[]): DocumentBlock | undefined => {
    for (const block of blocks) {
      if (block.id === instanceId) return block
      if (block.type === 'section') { const child = find(block.blocks); if (child) return child }
    }
  }
  return find(projectFlowDocument(project, surfaceId).content.blocks)
}
function blockInstance(project: CourseProjectV10, block: DocumentBlock): ComponentInstance {
  const previous = project.instances[block.id]
  const implementation = previous && !previous.implementationOverride ? project.definitions[previous.definitionId]?.implementation : undefined
  const key = implementation?.kind === 'builtin' ? implementation.key : undefined
  const definitionId = (builtin: string) => key === builtin ? previous.definitionId : builtin
  if (block.type === 'course-instance') {
    if (!previous) throw new Error(`正文引用的正式实例已不存在：${block.id}`)
    return previous
  }
  if(previous && same(projectFlowBlock(project,block.id),block))return previous
  if (previous && projectFlowBlock(project, block.id).type === 'course-instance') throw new Error('专业对象的内容请在组件属性中修改；正文源码仅保留该对象的正式引用和阅读顺序')
  if (block.type === 'paragraph') {
    const text = key === TEXT_DEFINITION.id ? textComponentDataSchema.parse(previous.data) : createTextComponentData()
    return { ...previous, id: block.id, definitionId: definitionId(TEXT_DEFINITION.id), data: json({ ...text, content: block.content,
      appearance: { ...text.appearance, align: block.textAlign ?? text.appearance.align,
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
    const data=block.mediaKind==='image' ? imageDataSchema.parse({...initial,assetId,alt:block.altText ?? initial.alt,...(block.crop ? {crop:block.crop}:{}),...(block.cropX!==undefined ? {cropX:block.cropX}:{}),...(block.cropY!==undefined ? {cropY:block.cropY}:{})}) : {...initial,assetId,title:block.altText ?? initial.title}
    return {...previous,id:block.id,definitionId:definitionId(builtin),data:json(data),flowLayout:{width:block.layout,...(block.wrap ? {wrap:block.wrap}:{}),...(block.caption ? {caption:block.caption}:{})}}
  }
  if(block.type==='chart')return {...previous,id:block.id,definitionId:definitionId(CHART_DEFINITION.id),data:json(chartDataSchema.parse(block.chart))}
  if(block.type==='table') {
    const initial=key===TABLE_DEFINITION.id ? parseTableData(previous.data) as any : createTableData({rows:Math.max(1,block.rows.length),columns:block.columns.length}) as any
    const columns=block.columns.map(column=>({...initial.columns.find((value:any)=>value.id===column.id),id:column.id,width:initial.columns.find((value:any)=>value.id===column.id)?.width ?? 200,
      ...(block.headerEnabled!==false || initial.columns.find((value:any)=>value.id===column.id)?.header ? {header:column.header}:{})}))
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
export function flowDocumentEdits(project: CourseProjectV10, surfaceId: string, blocks: DocumentBlock[], readingBaseline=project): ComponentEdit[] {
  const parsed = documentContentSchema.parse({ blocks }).blocks
  const surface = flowSurface(project, surfaceId), edits: ComponentEdit[] = [], desired = new Map<string, ComponentInstance>(), retained = new Set<string>()
  const retain = (id: string) => { retained.add(id); for (const child of project.instances[id]?.childIds ?? []) retain(child) }
  const visit = (items: DocumentBlock[]) => { for (const block of items) {
    desired.set(block.id, blockInstance(project, block))
    if (block.type === 'course-instance') retain(block.id)
    if (block.type === 'section') visit(block.blocks)
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
        edits.push({ type: 'instance.insert', container, index: insertionIndex, instances: [{ ...instance, ...(block.type === 'section' ? { childIds: [] } : {}) }], rootIds: [block.id] })
        place(block.id, parent, insertionIndex)
        if (block.type === 'section') { currentChildren.set(block.id, []); ordered(block.blocks, { kind: 'instance', instanceId: block.id }) }
        continue
      }
      if (previous.definitionId !== instance.definitionId) {
        // Keep identity/frame/style through an in-place professional type change.
        edits.push({ type: 'instance.definition.set', instanceId: block.id, definitionId: instance.definitionId })
      }
      if (!same(previous.data, instance.data)) edits.push({ type: 'data.set', instanceId: block.id, path: [], value: instance.data as JsonValue })
      if (!same(previous.flowLayout,instance.flowLayout)) edits.push({type:'instance.flowLayout.set',instanceId:block.id,flowLayout:instance.flowLayout ?? null})
      const siblings = currentChildren.get(parent) ?? []
      if (container.kind === 'surface' ? !siblings.includes(block.id) : siblings[index] !== block.id) {
        edits.push({ type: 'instance.move', instanceId: block.id, container, index: insertionIndex }); place(block.id, parent, insertionIndex)
      }
      if (block.type === 'section') ordered(block.blocks, { kind: 'instance', instanceId: block.id })
    }
  }
  ordered(parsed, { kind: 'surface', surfaceId })
  for (const id of oldIds) if (!desired.has(id) && !retained.has(id) && ![...oldIds].some(parent => !desired.has(parent) && !retained.has(parent) && project.instances[parent]?.childIds?.includes(id))) {
    edits.push({ type: 'instance.remove', instanceId: id })
    for (const children of currentChildren.values()) { const index = children.indexOf(id); if (index >= 0) children.splice(index, 1) }
  }
  const moveRoot = (id: string, index: number) => {
    edits.push({ type: 'instance.move', instanceId: id, container: { kind: 'surface', surfaceId }, index })
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
  return edits
}
