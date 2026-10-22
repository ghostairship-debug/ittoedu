import { createTestProjectFromLegacy, setRootContainers } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import * as sessions from '../../src/renderer/document/editorSession'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { ComponentNavigationOwner, type ComponentObservationBinding } from '../../src/renderer/components/ComponentNavigationOwner'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { createImageData } from '../../src/components/image'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import {projectFlowDocument} from '../../src/core/components/document/flowDocumentProjection'
import {serializeDocumentMarkdown} from '../../src/shared/document/markdown'
import {prepareDocumentClipboard} from '../../src/renderer/document/documentClipboard'
import {createFlowDocumentResourcePort,prepareFlowDocumentResourceTransaction} from '../../src/renderer/document/flowDocumentResources'
const probe = vi.hoisted(()=>({state:{} as Record<string,unknown>,runtime:{} as Record<string,unknown>}))
vi.mock('../../src/renderer/store/editorStore',()=>({useEditorStore:Object.assign((select:(state:typeof probe.state)=>unknown)=>select(probe.state),{getState:()=>probe.state})}))
vi.mock('../../src/renderer/components/CourseV10RuntimeView',()=>({useCourseV10Runtime:()=>probe.runtime}))
vi.mock('../../src/renderer/ui/useAssetObjectUrls',()=>({useAssetObjectUrls:()=>({})}))
vi.mock('../../src/renderer/workbench/NativeSelectionContext',()=>({NativeSelectionContext:()=>null}))
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'
import { drainFlowWorkspace } from '../../src/renderer/document/flowWorkspaceRegistry'
import { FlowMediaCropEditor } from '../../src/renderer/ui/flow/FlowMediaCropEditor'
const geometry = ['getClientRects','getBoundingClientRect'] as const
const descriptors = geometry.map(key=>Object.getOwnPropertyDescriptor(Range.prototype,key))
beforeAll(()=>{
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[]})
  Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>new DOMRect()})
  vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}})
  vi.stubGlobal('PointerEvent',MouseEvent)
})
afterAll(()=>{geometry.forEach((key,index)=>{if(descriptors[index])Object.defineProperty(Range.prototype,key,descriptors[index]!);else Reflect.deleteProperty(Range.prototype,key)});vi.unstubAllGlobals()})
const disposers:Array<()=>void>=[]
afterEach(()=>{cleanup();for(const dispose of disposers.splice(0))dispose();vi.restoreAllMocks()})
function deferred<T>() {let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}}
/** Keep DOM rendering isolated; target capture, ACKs, History and navigation use their real owners. */
async function workspaceFixture(project:CourseProjectV10,selectedInstanceIds:readonly string[]=[]) {
  const host=await createV10StoreHost(project),documentId=host.first.documentId
  host.bridge.selectInstances(documentId,selectedInstanceIds,'flow')
  const navigation=new ComponentNavigationOwner({project:()=>host.bridge.read().project ?? project,surfaceId:()=>host.bridge.read().surfaceId,
    select:(surfaceId,_signal,onCommit)=>{host.bridge.selectSurface(documentId,surfaceId);onCommit?.()}})
  disposers.push(()=>{navigation.dispose();host.bridge.dispose()})
  const drafts=vi.fn((value:unknown,ownerId:string)=>{
    const current={...probe.state.flowDocumentDrafts as Record<string,unknown>}
    if(value===null)delete current[ownerId];else current[ownerId]=value
    probe.state.flowDocumentDrafts=current
  })
  probe.state={courseBridge:host.bridge,courseKernel:host.kernel,get courseView(){return host.bridge.read()},editingScope:'surface',
    flowDocumentDrafts:{},setFlowDocumentDraft:drafts,setFlowContextSelection:()=>{},flowEditingInstance:null,slideContentEdit:null,
    beginSlideDataEdit:()=>{},commitSlideContentEdit:async()=>{}}
  const contents=new Map<string,HTMLElement>(),targets=new Map<string,HTMLElement>()
  probe.runtime={documentId,project,resources:host.model().resources,surfaceId:'flow',player:false,
    get selectedInstanceIds(){return host.bridge.read().selectedInstanceIds},
    selectInstances:(ids:readonly string[],surfaceId='flow')=>host.bridge.selectInstances(documentId,ids,surfaceId),
    onElement:(id:string,element:HTMLElement|null)=>{if(element)contents.set(id,element);else contents.delete(id)},
    onTargetElement:(id:string,element:HTMLElement|null)=>{if(element)targets.set(id,element);else targets.delete(id)},
    world:{authorSpots:()=>[],subscribeAuthorSpots:()=>()=>{},contentElement:(id:string)=>contents.get(id),targetElement:(id:string)=>targets.get(id),
      beforeProjectionMutation:()=>{},afterProjectionMutation:()=>{},beforeProjectionRemoval:()=>{}},
    renderInstance:()=>null,renderContainer:()=>null,navigation,
    registerObservation:(id:string,binding:ComponentObservationBinding)=>navigation.registerObservation(id,binding)}
  return {host,documentId,navigation,drafts}
}
it('waits for the Flow body ACK during drain and preserves rejected input with the original document target',async()=>{
  const project:CourseProjectV10=createTestProjectFromLegacy({schemaVersion:10,id:'flow-ack',revision:0,title:'讲义',definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION},
    instances:{body:{id:'body',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('原文')))}},
    surfaces:[{id:'flow',kind:'flow',title:'正文',childIds:['body']}],global:{underlay:[],overlay:[]},assets:{}})
  const {host,documentId,drafts}=await workspaceFixture(project)
  const target=host.bridge.captureTarget(documentId),ack=deferred<void>(),rejected=deferred<void>()
  const dispatch=host.api.dispatch.bind(host.api)
  vi.spyOn(host.api,'dispatch').mockImplementationOnce(async(operation,options)=>{await ack.promise;return dispatch(operation,options)})
    .mockImplementationOnce(async operation=>{await rejected.promise;return {status:'failed',documentId:operation.documentId,operationId:operation.operationId,
      code:'fixture-flow-body-refused',message:'正式ACK拒绝',applied:false}})
  const editCaptured=vi.spyOn(host.bridge,'editCaptured'),factory=vi.spyOn(sessions,'createLayoutEditor')
  const ui=render(<FlowWorkspace documentId={documentId} project={project} surfaceId="flow" onSelectImageAsset={async()=>null}/>)
  const editor=factory.mock.results.at(-1)!.value
  await act(async()=>editor.view.dispatch(editor.view.state.tr.insertText('新',1)))
  let settled=false
  const drain=drainFlowWorkspace(documentId).then(result=>{settled=true;return result})
  await waitFor(()=>expect(editCaptured).toHaveBeenCalledTimes(1))
  expect(settled).toBe(false)
  expect(editCaptured.mock.calls[0][0]).toMatchObject({documentId,epoch:target.epoch})
  expect(host.first.read().undoDepth).toBe(0)
  await act(async()=>{ack.resolve();expect(await drain).toEqual({ok:true})})
  expect(editCaptured).toHaveBeenCalledTimes(1)
  const accepted=host.model().project
  expect(serializeDocumentMarkdown(projectFlowDocument(accepted,'flow'))).toContain('新原文')
  expect(host.first.read().undoDepth).toBe(1)
  await act(async()=>editor.view.dispatch(editor.view.state.tr.insertText('保留',1)))
  await waitFor(()=>expect(editCaptured).toHaveBeenCalledTimes(2))
  await act(async()=>rejected.resolve())
  expect(await drainFlowWorkspace(documentId)).toMatchObject({ok:false})
  expect(ui.getAllByRole('alert').some(element=>element.textContent?.includes('正式ACK拒绝'))).toBe(true)
  expect(editor.view.state.doc.textContent).toBe('保留新原文')
  expect(drafts.mock.calls.at(-1)).toEqual([expect.objectContaining({source:expect.stringContaining('保留新原文'),diagnostics:expect.any(Array)}),documentId])
  expect(editCaptured.mock.calls[1][0]).toMatchObject({documentId,epoch:target.epoch})
  expect(host.model().project).toEqual(accepted)
  expect(host.first.read().undoDepth).toBe(1)
})
it('binds the original Flow observation session while rendering floating children and preserving custom teacher chrome',async()=>{
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1280)
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(720)
  const project:CourseProjectV10=createTestProjectFromLegacy({schemaVersion:10,id:'observation',revision:0,title:'Flow',definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION,
    group:{id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}},'guoling.navigation':{id:'guoling.navigation',role:'content',professionalBuiltinKey:'guoling.navigation',implementation:{kind:'source',language:'javascript',source:'export default 1'}}},
    instances:{body:{id:'body',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('正文')))},
      group:{id:'group',definitionId:'group',data:{},frame:{width:300,height:180,transform:[1,.2,.3,1,30,40]},flowPlacement:{space:'paper',plane:'overlay'},childIds:['child']},
      child:{id:'child',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('组内文字'))),frame:{width:100,height:60,transform:[1,0,0,1,14,17]}},
      teacher:{id:'teacher',definitionId:'guoling.navigation',data:{},frame:{width:240,height:90,transform:[1,0,0,1,5,6]}}},
    surfaces:[{id:'flow',kind:'flow',title:'Flow',childIds:['body','group']}],global:{underlay:[],overlay:['teacher']},assets:{}})
  const {host,documentId,navigation}=await workspaceFixture(project,['group','teacher'])
  const editCaptured=vi.spyOn(host.bridge,'editCaptured'),capture=vi.spyOn(host.bridge,'capture')
  const bindings:ComponentObservationBinding[]=[],release=vi.fn(),register=navigation.registerObservation
  vi.spyOn(navigation,'registerObservation').mockImplementation((id,binding)=>{
    bindings.push(binding);const stop=register(id,binding);return ()=>{release();stop()}
  })
  const renderInstance=vi.fn((id:string)=><div key={id} data-testid={id}/>)
  probe.runtime.renderInstance=renderInstance
  const ui=render(<FlowWorkspace documentId={documentId} project={project} surfaceId="flow" toolbarContainer={document.createElement('div')} onSelectImageAsset={async()=>null}/>)
  expect(renderInstance).toHaveBeenCalledWith('child',project,'free')
  expect(bindings).toHaveLength(1)
  act(()=>bindings[0].setZoom(2))
  expect(bindings[0].readZoom()).toBe(2)
  const content=ui.container.querySelector<HTMLElement>('[data-playback-content]')!,teacher=ui.container.querySelector<HTMLElement>('[data-flow-overlay-id="teacher"]')!
  expect(content.style.transform).toContain('scale(2)');expect(content.contains(teacher)).toBe(false)
  expect(ui.queryByTestId('teacher-controller-authoring-chrome')).toBeNull();expect(editCaptured).not.toHaveBeenCalled()
  const move=async(id:string)=>{
    const overlay=ui.container.querySelector<HTMLElement>(`[data-flow-overlay-id="${id}"]`)!,button=id==='teacher' ? overlay : overlay.querySelector<HTMLButtonElement>('button')!
    button.setPointerCapture=()=>{}
    fireEvent.pointerDown(button,{clientX:100,clientY:200,pointerId:1})
    fireEvent.pointerMove(button,{clientX:120,clientY:220,pointerId:1})
    await act(async()=>fireEvent.pointerUp(button,{clientX:120,clientY:220,pointerId:1}))
  }
  await move('group');await waitFor(()=>expect(host.model().project.instances.group.frame?.transform).toEqual([1,.2,.3,1,40,50]))
  expect(capture.mock.calls.at(-1)![0]).toEqual([expect.objectContaining({type:'frame.set',instanceId:'group',frame:expect.objectContaining({transform:[1,.2,.3,1,40,50]})})])
  await move('teacher');await waitFor(()=>expect(host.model().project.instances.teacher.frame?.transform).toEqual([1,0,0,1,25,26]))
  expect(capture.mock.calls.at(-1)![0]).toEqual([expect.objectContaining({type:'frame.set',instanceId:'teacher',frame:expect.objectContaining({transform:[1,0,0,1,25,26]})})])
  expect(host.first.read().undoDepth).toBe(2)
  ui.unmount();expect(release).toHaveBeenCalledTimes(1)
})
it('keeps the crop draft while its ACK is pending or rejected and permits an explicit retry',async()=>{
  const data=createImageData('image'), pending=deferred<void>(), onConfirm=vi.fn().mockImplementationOnce(()=>pending.promise).mockResolvedValueOnce(undefined)
  const ui=render(<FlowMediaCropEditor instance={{id:'image',definitionId:'guoling.image',data:JSON.parse(JSON.stringify(data))}} imageData={data} onConfirm={onConfirm} onCancel={()=>{}}/>)
  fireEvent.change(ui.getByLabelText('左裁剪'),{target:{value:'0.2'}})
  fireEvent.click(ui.getByRole('button',{name:'确认裁剪'}))
  expect(ui.getByRole('button',{name:'确认裁剪'})).toBeDisabled()
  await act(async()=>pending.reject(new Error('裁剪ACK拒绝')))
  expect(ui.getByRole('alert')).toHaveTextContent('裁剪ACK拒绝');expect(ui.getByLabelText('左裁剪')).toHaveValue('0.2')
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:'确认裁剪'})))
  expect(onConfirm).toHaveBeenCalledTimes(2);expect(onConfirm.mock.calls[1][0].crop.left).toBe(.2)
})
it('explicitly discards restored valid rejected source and its resource preparations without replaying it',async()=>{
  const project:CourseProjectV10=createTestProjectFromLegacy({schemaVersion:10,id:'restore',revision:0,title:'Flow',definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION},instances:{body:{id:'body',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('原文')))}},surfaces:[{id:'flow',kind:'flow',title:'Flow',childIds:['body']}],global:{underlay:[],overlay:[]},assets:{}})
  const {host,documentId,drafts}=await workspaceFixture(project),resources=host.model().resources,target=host.bridge.captureTarget(documentId)
  const editCaptured=vi.spyOn(host.bridge,'editCaptured')
  const source:CourseProjectV10={...project,id:'source',definitions:{group:{id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}}},instances:{foreign:{id:'foreign',definitionId:'group',data:{}}}}
  setRootContainers(source,[{...componentSurfaces(project)[0],childIds:['foreign']}])
  const port=createFlowDocumentResourcePort({target,source:{documentId:'source-doc',project:source,resources,roots:['foreign']}})
  const pasted=await prepareDocumentClipboard(projectFlowDocument(source,'flow'),{assets:[],components:[]},port)
  const changed={content:{blocks:[...projectFlowDocument(project,'flow').content.blocks,...pasted.document.content.blocks]},resources:pasted.document.resources}
  const draft={surfaceId:'flow',revision:0,source:serializeDocumentMarkdown(changed),composing:false,diagnostics:[{message:'恢复的正式ACK拒绝',offset:0,endOffset:0,line:1,column:1}],preparedResources:[pasted.prepared]}
  probe.state.flowDocumentDrafts={[documentId]:draft}
  const ui=render(<FlowWorkspace documentId={documentId} project={project} surfaceId="flow" onSelectImageAsset={async()=>null}/>)
  expect(await drainFlowWorkspace(documentId)).toMatchObject({ok:false})
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:'丢弃待修草稿'})))
  expect(drafts).toHaveBeenCalledWith(null,documentId);expect(editCaptured).not.toHaveBeenCalled()
  expect(host.model().project).toEqual(project);expect(host.first.read().undoDepth).toBe(0)
  expect(()=>prepareFlowDocumentResourceTransaction(target,'flow',changed.content.blocks,[pasted.prepared])).toThrow('准备已失效')
  expect(await drainFlowWorkspace(documentId)).toEqual({ok:true})
})
