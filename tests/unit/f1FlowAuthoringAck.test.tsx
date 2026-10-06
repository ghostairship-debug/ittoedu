import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import * as sessions from '../../src/renderer/document/editorSession'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { createImageData } from '../../src/components/image'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import {projectFlowDocument} from '../../src/core/components/document/flowDocumentProjection'
import {serializeDocumentMarkdown} from '../../src/shared/document/markdown'
import {prepareDocumentClipboard} from '../../src/renderer/document/documentClipboard'
import {createFlowDocumentResourcePort,prepareFlowDocumentResourceTransaction} from '../../src/renderer/document/flowDocumentResources'
const probe = vi.hoisted(()=>({state:{} as Record<string,unknown>,runtime:{} as Record<string,unknown>}))
vi.mock('../../src/renderer/store/editorStore',()=>({useEditorStore:(select:(state:typeof probe.state)=>unknown)=>select(probe.state)}))
vi.mock('../../src/renderer/components/CourseV10RuntimeView',()=>({useCourseV10Runtime:()=>probe.runtime}))
vi.mock('../../src/renderer/ui/useAssetObjectUrls',()=>({useAssetObjectUrls:()=>({})}))
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
afterEach(()=>{cleanup();vi.restoreAllMocks()})
function deferred<T>() {let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}}
it('waits for the Flow body ACK during drain and preserves rejected input with the original document target',async()=>{
  const project:CourseProjectV10={schemaVersion:10,id:'flow-ack',revision:0,title:'讲义',definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION},
    instances:{body:{id:'body',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('原文')))}},
    surfaces:[{id:'flow',kind:'flow',title:'正文',childIds:['body']}],global:{underlay:[],overlay:[]},assets:{}}
  const resources={assets:{},components:{}}, target={documentId:'flow-doc',epoch:'epoch',project,editingProject:project,resources,surfaceId:'flow',activeStateId:null,instanceIds:[],instanceId:null}
  const ack=deferred<unknown>(), rejected=deferred<unknown>(), drafts=vi.fn()
  const editCaptured=vi.fn().mockImplementationOnce(()=>ack.promise).mockImplementationOnce(()=>rejected.promise)
  const bridge={captureTarget:()=>target,capture:(edits:Parameters<typeof captureComponentOperation>[1],captured:typeof target)=>({...captureComponentOperation(captured.project,edits),documentId:captured.documentId,epoch:captured.epoch}),editCaptured,read:()=>({activation:1}),undo:async()=>{},redo:async()=>{}}
  probe.state={courseBridge:bridge,courseKernel:bridge,flowDocumentDrafts:{},setFlowDocumentDraft:drafts,setFlowContextSelection:()=>{},flowEditingInstance:null,slideContentEdit:null}
  probe.runtime={resources,selectedInstanceIds:[],selectInstances:()=>{},onElement:()=>{},onTargetElement:()=>{},world:{beforeProjectionMutation:()=>{},afterProjectionMutation:()=>{}},renderInstance:()=>null,registerObservation:()=>()=>{},navigation:{changed:()=>{}}}
  const factory=vi.spyOn(sessions,'createLayoutEditor')
  const ui=render(<FlowWorkspace documentId="flow-doc" project={project} surfaceId="flow" onSelectImageAsset={async()=>null}/>)
  const editor=factory.mock.results.at(-1)!.value
  await act(async()=>editor.view.dispatch(editor.view.state.tr.insertText('新',1)))
  let settled=false
  const drain=drainFlowWorkspace('flow-doc').then(result=>{settled=true;return result})
  await act(async()=>{await Promise.resolve()})
  expect(settled).toBe(false); expect(editCaptured).toHaveBeenCalledTimes(1)
  expect(editCaptured.mock.calls[0][0]).toMatchObject({documentId:'flow-doc',epoch:'epoch'})
  await act(async()=>ack.resolve({revision:1}))
  expect(await drain).toEqual({ok:true});expect(editCaptured).toHaveBeenCalledTimes(1)
  await act(async()=>editor.view.dispatch(editor.view.state.tr.insertText('保留',1)))
  await act(async()=>rejected.reject(new Error('正式ACK拒绝')))
  expect(await drainFlowWorkspace('flow-doc')).toMatchObject({ok:false})
  expect(ui.getAllByRole('alert').some(element=>element.textContent?.includes('正式ACK拒绝'))).toBe(true)
  expect(editor.view.state.doc.textContent).toBe('保留新原文')
  expect(drafts.mock.calls.at(-1)).toEqual([expect.objectContaining({source:expect.stringContaining('保留新原文'),diagnostics:expect.any(Array)}),'flow-doc'])
})
it('binds the original Flow observation session while rendering floating children and preserving custom teacher chrome',async()=>{
  const project:CourseProjectV10={schemaVersion:10,id:'observation',revision:0,title:'Flow',definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION,
    group:{id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}},'guoling.navigation':{id:'guoling.navigation',role:'content',professionalBuiltinKey:'guoling.navigation',implementation:{kind:'source',language:'javascript',source:'export default 1'}}},
    instances:{body:{id:'body',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('正文')))},
      group:{id:'group',definitionId:'group',data:{},frame:{width:300,height:180,transform:[1,.2,.3,1,30,40]},flowPlacement:{space:'paper',plane:'overlay'},childIds:['child']},
      child:{id:'child',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('组内文字'))),frame:{width:100,height:60,transform:[1,0,0,1,14,17]}},
      teacher:{id:'teacher',definitionId:'guoling.navigation',data:{},frame:{width:240,height:90,transform:[1,0,0,1,5,6]}}},
    surfaces:[{id:'flow',kind:'flow',title:'Flow',childIds:['body','group']}],global:{underlay:[],overlay:['teacher']},assets:{}}
  const resources={assets:{},components:{}},editCaptured=vi.fn(),target={documentId:'observe-doc',epoch:'epoch',project,editingProject:project,resources,surfaceId:'flow',activeStateId:null,instanceIds:[],instanceId:null}
  const capture=vi.fn((edits:unknown)=>({edits})),bridge={captureTarget:()=>target,capture,editCaptured,read:()=>({activation:1})}
  const bindings: {readZoom():number;setZoom(value:number):void;reset():void}[]=[],release=vi.fn(),navigation={changed:vi.fn()},renderInstance=vi.fn((id:string)=><div key={id} data-testid={id}/>)
  probe.state={courseBridge:bridge,courseKernel:bridge,flowDocumentDrafts:{},setFlowDocumentDraft:()=>{},setFlowContextSelection:()=>{},flowEditingInstance:null,slideContentEdit:null}
  probe.runtime={resources,selectedInstanceIds:['group','teacher'],selectInstances:()=>{},onElement:()=>{},onTargetElement:()=>{},world:{beforeProjectionMutation:()=>{},afterProjectionMutation:()=>{}},renderInstance,navigation,registerObservation:(_id:string,binding:typeof bindings[number])=>{bindings.push(binding);return release}}
  const ui=render(<FlowWorkspace documentId="observe-doc" project={project} surfaceId="flow" onSelectImageAsset={async()=>null}/>)
  expect(renderInstance).toHaveBeenCalledWith('child',project,'free')
  expect(bindings).toHaveLength(1)
  act(()=>bindings[0].setZoom(2))
  expect(bindings[0].readZoom()).toBe(2)
  const content=ui.container.querySelector<HTMLElement>('[data-playback-content]')!,teacher=ui.container.querySelector<HTMLElement>('[data-flow-overlay-id="teacher"]')!
  expect(content.style.transform).toContain('scale(2)');expect(content.contains(teacher)).toBe(false)
  expect(ui.queryByTestId('teacher-controller-authoring-chrome')).toBeNull();expect(editCaptured).not.toHaveBeenCalled()
  const move=async(id:string)=>{
    const overlay=ui.container.querySelector<HTMLElement>(`[data-flow-overlay-id="${id}"]`)!,button=overlay.querySelector<HTMLButtonElement>('button')!
    button.setPointerCapture=()=>{}
    fireEvent.pointerDown(button,{clientX:100,clientY:200,pointerId:1})
    fireEvent.pointerMove(button,{clientX:120,clientY:220,pointerId:1})
    await act(async()=>fireEvent.pointerUp(button,{clientX:120,clientY:220,pointerId:1}))
  }
  await move('group');expect(capture.mock.calls.at(-1)![0]).toEqual([expect.objectContaining({type:'frame.set',instanceId:'group',frame:expect.objectContaining({transform:[1,.2,.3,1,40,50]})})])
  await move('teacher');expect(capture.mock.calls.at(-1)![0]).toEqual([expect.objectContaining({type:'frame.set',instanceId:'teacher',frame:expect.objectContaining({transform:[1,0,0,1,25,26]})})])
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
  const project:CourseProjectV10={schemaVersion:10,id:'restore',revision:0,title:'Flow',definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION},instances:{body:{id:'body',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('原文')))}},surfaces:[{id:'flow',kind:'flow',title:'Flow',childIds:['body']}],global:{underlay:[],overlay:[]},assets:{}}
  const resources={assets:{},components:{}},target={documentId:'restore-doc',epoch:'epoch',project,editingProject:project,resources,surfaceId:'flow',activeStateId:null,instanceIds:[],instanceId:null}
  const source:CourseProjectV10={...project,id:'source',definitions:{group:{id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}}},instances:{foreign:{id:'foreign',definitionId:'group',data:{}}},surfaces:[{...project.surfaces[0],childIds:['foreign']}]}
  const port=createFlowDocumentResourcePort({target,source:{documentId:'source-doc',project:source,resources,roots:['foreign']}})
  const pasted=await prepareDocumentClipboard(projectFlowDocument(source,'flow'),{assets:[],components:[]},port)
  const changed={content:{blocks:[...projectFlowDocument(project,'flow').content.blocks,...pasted.document.content.blocks]},resources:pasted.document.resources}
  const draft={surfaceId:'flow',revision:0,source:serializeDocumentMarkdown(changed),composing:false,diagnostics:[{message:'恢复的正式ACK拒绝',offset:0,endOffset:0,line:1,column:1}],preparedResources:[pasted.prepared]}
  const drafts=vi.fn(),editCaptured=vi.fn(),bridge={captureTarget:()=>target,capture:()=>{},editCaptured,read:()=>({activation:1})}
  probe.state={courseBridge:bridge,courseKernel:bridge,flowDocumentDrafts:{'restore-doc':draft},setFlowDocumentDraft:drafts,setFlowContextSelection:()=>{},flowEditingInstance:null,slideContentEdit:null}
  probe.runtime={resources,selectedInstanceIds:[],selectInstances:()=>{},onElement:()=>{},onTargetElement:()=>{},world:{beforeProjectionMutation:()=>{},afterProjectionMutation:()=>{}},renderInstance:()=>null,registerObservation:()=>()=>{},navigation:{changed:()=>{}}}
  const ui=render(<FlowWorkspace documentId="restore-doc" project={project} surfaceId="flow" onSelectImageAsset={async()=>null}/>)
  expect(await drainFlowWorkspace('restore-doc')).toMatchObject({ok:false})
  fireEvent.click(ui.getByLabelText('更多正文操作'))
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:'丢弃待修草稿'})))
  expect(drafts).toHaveBeenCalledWith(null,'restore-doc');expect(editCaptured).not.toHaveBeenCalled()
  expect(()=>prepareFlowDocumentResourceTransaction(target,'flow',changed.content.blocks,[pasted.prepared])).toThrow('准备已失效')
  expect(await drainFlowWorkspace('restore-doc')).toEqual({ok:true})
})
