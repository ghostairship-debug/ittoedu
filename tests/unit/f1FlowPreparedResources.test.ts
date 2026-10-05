// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge, type CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { CourseProjectV10, ComponentEdit } from '../../src/shared/contracts/component-platform'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { createCourseDocumentClipboardContext, readCourseDocumentClipboardContext } from '../../src/renderer/document/documentClipboardContext'
import { prepareDocumentClipboard } from '../../src/renderer/document/documentClipboard'
import { captureFlowPreparedDocumentResources,createFlowDocumentResourcePort, prepareFlowDocumentResourceTransaction, releaseFlowPreparedResources, type FlowPreparedDocumentResources } from '../../src/renderer/document/flowDocumentResources'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const source: CourseProjectV10 = { schemaVersion:10,id:'source',revision:0,title:'Source',
  definitions:{[IMAGE_DEFINITION.id]:IMAGE_DEFINITION,code:{id:'code',role:'content',implementation:{kind:'source',language:'javascript',workspace:{ownerId:'files',entry:'main.js'},resourceBindings:{logo:'logo'}}}},
  instances:{image:{id:'image',definitionId:IMAGE_DEFINITION.id,data:JSON.parse(JSON.stringify(createImageData('logo')))},custom:{id:'custom',definitionId:'code',data:{}}},
  surfaces:[{id:'flow',kind:'flow',title:'正文',childIds:['image','custom']}],global:{underlay:[],overlay:[]},
  assets:{logo:{id:'logo',path:'assets/logo.svg',filename:'logo.svg',mimeType:'image/svg+xml'}} }
const sourceResources = { assets:{logo:new TextEncoder().encode('<svg>source</svg>')},components:{files:{'main.js':new TextEncoder().encode("import './part.js'; export default 1"),'part.js':new TextEncoder().encode('export const value = 2')}} }
const original: CourseProjectV10 = {schemaVersion:10,id:'target',revision:0,title:'Target',
  definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION},instances:{body:{id:'body',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('原正文')))}},
  surfaces:[{id:'flow',kind:'flow',title:'正文',childIds:['body']}],global:{underlay:[],overlay:[]},
  assets:{logo:{id:'logo',path:'assets/logo.svg',filename:'logo.svg',mimeType:'image/svg+xml'}}}
const targetResources = {assets:{logo:new TextEncoder().encode('<svg>target</svg>')},components:{files:{'main.js':new TextEncoder().encode('export default 99')}}}
const copiedSource = () => readCourseDocumentClipboardContext(JSON.parse(JSON.stringify(createCourseDocumentClipboardContext({documentId:'source-doc',project:source,resources:sourceResources,roots:['image','custom']}))))
async function harness(initial=original) {
  const directory = await mkdtemp(path.join(tmpdir(),'guoling-f1-'))
  cleanup.push(() => rm(directory,{recursive:true,force:true}))
  const service = new DocumentHostService(path.join(directory,'recovery'))
  const a = await service.internalAPI.create({kind:'course-v10',project:structuredClone(initial),resources:structuredClone(targetResources)},'Target')
  const unavailable = async (): Promise<never> => {throw new Error('no dialogs')}
  const api: DocumentHostAPI = {...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  const bridge = new CourseV10DocumentBridge(); await bridge.connect(api); await bridge.activate(a.documentId)
  cleanup.push(async()=>bridge.dispose())
  return {service,bridge,a,directory}
}
it('commits copied body, instances, colliding assets and private relative files in one captured transaction with undo and independent reopen',async()=>{
  const h = await harness(), target = h.bridge.captureTarget()
  const port = createFlowDocumentResourcePort({target,source:copiedSource()})
  const pasted = await prepareDocumentClipboard(projectFlowDocument(source,'flow'),projectFlowDocument(original,'flow').resources,port)
  const blocks = [...projectFlowDocument(original,'flow').content.blocks,...pasted.document.content.blocks]
  const planned = prepareFlowDocumentResourceTransaction(target,'flow',blocks,[pasted.prepared])
  const b = await h.service.internalAPI.create({kind:'course-v10',project:{...structuredClone(original),id:'other'},resources:structuredClone(targetResources)},'Other')
  await h.bridge.activate(b.documentId)
  await h.bridge.editCaptured(h.bridge.capture(planned.edits,planned.target)); releaseFlowPreparedResources(planned.prepared)
  const snapshot = await h.service.internalAPI.read(h.a.documentId)
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  const model = snapshot.model, image = model.project.instances[pasted.document.content.blocks[0].id], custom = model.project.instances[pasted.document.content.blocks[1].id]
  expect(image.id).not.toBe('image'); expect(custom.id).not.toBe('custom'); expect(model.project.surfaces[0].childIds).toEqual(blocks.map(block=>block.id))
  expect(model.resources.assets.logo).toEqual(targetResources.assets.logo)
  expect((image.data as {assetId:string}).assetId).not.toBe('logo')
  expect(model.resources.assets[(image.data as {assetId:string}).assetId]).toEqual(sourceResources.assets.logo)
  const implementation = model.project.definitions[custom.definitionId].implementation
  if (implementation.kind !== 'source' || !implementation.workspace) throw new Error('lost private files')
  expect(implementation.workspace.ownerId).not.toBe('files')
  expect(model.resources.components[implementation.workspace.ownerId]).toEqual(sourceResources.components.files)
  expect(model.resources.components.files).toEqual(targetResources.components.files)
  expect(snapshot.undoDepth).toBe(1); expect((await h.service.internalAPI.read(b.documentId)).undoDepth).toBe(0)
  await h.bridge.undo(h.a.documentId)
  const undone = await h.service.internalAPI.read(h.a.documentId)
  expect(undone.model.kind === 'course-v10' && undone.model.resources).toEqual(targetResources)
  await h.bridge.redo(h.a.documentId)
  const filename = path.join(h.directory,'copied.h5lesson'); await h.service.internalAPI.save(h.a.documentId,filename)
  const reopened = await new DocumentHostService(path.join(h.directory,'other-recovery')).internalAPI.open(filename)
  expect(reopened.model.kind === 'course-v10' && reopened.model.resources).toEqual(model.resources)
  expect(reopened.model.kind === 'course-v10' && reopened.model.project.instances[custom.id]).toEqual(custom)
})
it('commits prepared copied roots before an existing float without looking up a new owner in the baseline',async()=>{
  const initial=structuredClone(original)
  initial.instances.float={id:'float',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('浮层'))),flowPlacement:{space:'paper',plane:'overlay'},frame:{width:200,height:70,transform:[1,.2,.3,1,17,29]}}
  initial.surfaces[0].childIds.push('float')
  const h=await harness(initial),target=h.bridge.captureTarget()
  const port=createFlowDocumentResourcePort({target,source:copiedSource()})
  const pasted=await prepareDocumentClipboard(projectFlowDocument(source,'flow'),projectFlowDocument(initial,'flow').resources,port)
  const blocks=[...projectFlowDocument(initial,'flow').content.blocks,...pasted.document.content.blocks]
  const planned=prepareFlowDocumentResourceTransaction(target,'flow',blocks,[pasted.prepared])
  await h.bridge.editCaptured(h.bridge.capture(planned.edits,planned.target));releaseFlowPreparedResources(planned.prepared)
  const snapshot=await h.service.internalAPI.read(h.a.documentId)
  if(snapshot.model.kind!=='course-v10')throw new Error('Expected V10')
  expect(snapshot.model.project.surfaces[0].childIds).toEqual([...blocks.map(block=>block.id),'float'])
  expect(snapshot.model.project.instances.float).toEqual(initial.instances.float);expect(snapshot.undoDepth).toBe(1)
})
it('retains rejected preparations for further input and a second paste without overwriting a staged private definition',async()=>{
  const target: CapturedCourseTarget = {documentId:'target-doc',epoch:'epoch',project:original,editingProject:original,resources:targetResources,surfaceId:'flow',activeStateId:null,instanceId:null,instanceIds:[]}
  const pending: FlowPreparedDocumentResources[] = []
  const port = createFlowDocumentResourcePort({target,source:copiedSource(),pending:()=>pending,onPrepared:value=>pending.push(value)})
  const first = await prepareDocumentClipboard(projectFlowDocument(source,'flow'),{assets:[],components:[]},port)
  const second = await prepareDocumentClipboard(projectFlowDocument(source,'flow'),{assets:[],components:[]},port)
  const blocks = [...projectFlowDocument(original,'flow').content.blocks,...first.document.content.blocks,...second.document.content.blocks]
  const planned = prepareFlowDocumentResourceTransaction(target,'flow',blocks,pending)
  const definitions = planned.edits.filter((edit):edit is Extract<ComponentEdit,{type:'definition.set'}>=>edit.type==='definition.set' && edit.definition.implementation.kind==='source')
  expect(definitions).toHaveLength(2); expect(definitions[0].definition.id).not.toBe(definitions[1].definition.id)
  expect(planned.target).toEqual(target)
  expect(()=>prepareFlowDocumentResourceTransaction({...target,documentId:'other'},'flow',blocks,pending)).toThrow('目标已变化')
  const captured=captureFlowPreparedDocumentResources(target,pending)
  const localSource=readCourseDocumentClipboardContext(JSON.parse(JSON.stringify(createCourseDocumentClipboardContext({documentId:captured.documentId,project:captured.editingProject,resources:captured.resources,roots:first.document.content.blocks.map(block=>block.id)}))))
  const localPort=createFlowDocumentResourcePort({target,source:localSource,pending:()=>pending,onPrepared:value=>pending.push(value)})
  const localCopy=await prepareDocumentClipboard(first.document,{assets:[],components:[]},localPort)
  expect(localCopy.document.content.blocks[1].id).not.toBe(first.document.content.blocks[1].id)
  expect(localCopy.prepared.edits.some(edit=>edit.type==='component.files.set' && JSON.stringify(Object.keys(edit.files ?? {}))===JSON.stringify(['main.js','part.js']))).toBe(true)
  await port.discard(first.prepared)
  expect(()=>prepareFlowDocumentResourceTransaction(target,'flow',blocks,pending)).toThrow('准备已失效')
})
