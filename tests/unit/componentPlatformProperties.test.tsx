import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { setRootContainers, testContainerInstance, appendRootContainers } from '../helpers/glxWorkFixture'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BufferedInput, PropertyDraftBoundary, TextContentTextarea, discardPropertiesDrafts, flushPropertiesDrafts, preservePropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import { componentPropertiesEdits, componentPropertiesView, propertiesFeedbackTargets, propertiesFramePatch } from '../../src/renderer/ui/properties/componentProperties'
import { projectWithBackgroundPreview } from '../../src/renderer/authoring/backgroundPreview'
import { createTextData, createFormulaData, FORMULA_DEFINITION, TEXT_DEFINITION } from '../../src/components/text'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { flowTextStyleEdits } from '../../src/renderer/componentPlatform/surfaces/flow/documentSelection'
import { projectFlowBlock } from '../../src/renderer/componentPlatform/surfaces/flow/documentProjection'
import { createImageData, IMAGE_DEFINITION } from '../../src/components/image'
import { defaultShapeData, SHAPE_DEFINITION } from '../../src/components/shape'
import { resolveComponentPresentation, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { selectPropertiesAuthoringReadModel } from '../../src/renderer/composition/properties/PropertiesAuthoringReadModel'
import { buildFlowPropertiesOwner } from '../../src/renderer/ui/properties/FlowPropertiesContextBuilder'
import { CommonNodeProperties, type SlideNativePropertiesContext } from '../../src/renderer/ui/properties/SlideNativePropertiesPanel'
import { useState } from 'react'
import { ComponentPropertiesEditor } from '../../src/renderer/ui/ComponentPropertiesEditor'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData } from '../../src/components/teacher-controller/data'
import { AUDIO_DEFINITION } from '../../src/components/media/adapters'
import { createAudioData } from '../../src/components/media/data'
import { createTableData } from '../../src/components/table/data'
import { TableComponentEditor } from '../../src/components/table/editor'
import { projectWithSlideContentDraft } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../src/components/document-block'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { CourseLightToolbar } from '../../src/renderer/documents/CourseLightToolbar'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { openCoursePageProperties } from '../../src/renderer/composition/properties/openCoursePageProperties'
import { usePropertiesContext } from '../../src/renderer/ui/properties/PropertiesContextAdapter'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
const dispose: Array<() => Promise<void>> = []
afterEach(async () => { cleanup(); for (const action of dispose.splice(0).reverse()) await action() })
const contentInstances = (project: CourseProjectV10) => Object.fromEntries(Object.entries(project.instances).filter(([, instance]) => !instance.container))
const frame = { width: 220, height: 90, transform: [1.5, .4, .7, 1.2, 35, 42] as [number,number,number,number,number,number] }
const fixture = (): CourseProjectV10 => (createTestProjectFromLegacy({ schemaVersion:10,id:'properties',revision:0,title:'属性',definitions:{text: {...TEXT_DEFINITION,id:'text'}, shape:{...SHAPE_DEFINITION,id:'shape'}, group:{id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}}},
  instances:{ group:{id:'group',definitionId:'group',data:{},childIds:['text','shape'],frame:{...frame,transform:[1,.2,.1,1,10,15]}},
    text:{id:'text',definitionId:'text',data:JSON.parse(JSON.stringify(createTextData('原文'))),frame:structuredClone(frame)},
    shape:{id:'shape',definitionId:'shape',data:defaultShapeData(),frame:structuredClone(frame)},
    neighbor:{id:'neighbor',definitionId:'text',data:JSON.parse(JSON.stringify(createTextData('邻居'))),frame:structuredClone(frame)} },
  surfaces:[{id:'slide',kind:'slide',title:'第1页',childIds:['group','neighbor']}],global:{underlay:[],overlay:[]},assets:{} }))
it('R4 exposes unset navigation colors without writing defaults and can return a color to its inherited value',()=>{
  const commit=vi.fn(),initial=JSON.parse(JSON.stringify(createTeacherControllerData()))
  function Form(){
    const [data,setData]=useState(initial)
    return <ComponentPropertiesEditor definition={{...TEACHER_CONTROLLER_DEFINITION,dataSchema:undefined}}
      node={{id:'navigation',definitionId:TEACHER_CONTROLLER_DEFINITION.id,data}}
      onChange={next=>{commit(next);setData(next)}}/>
  }
  render(<Form/>)
  const background=screen.getByLabelText('外观 · 背景颜色')
  expect(background).toHaveValue('')
  expect(screen.getByLabelText('外观 · 强调颜色')).toHaveValue('')
  expect(screen.getByLabelText('外观 · 文字颜色')).toHaveValue('')
  expect(commit).not.toHaveBeenCalled()
  fireEvent.focus(background);fireEvent.change(background,{target:{value:'#123456'}});fireEvent.blur(background)
  expect(commit).toHaveBeenCalledOnce()
  expect(commit.mock.calls[0][0]).toEqual({...initial,style:{...initial.style,backgroundColor:'#123456'}})
  fireEvent.click(screen.getByRole('button',{name:'外观 · 背景颜色使用默认颜色'}))
  expect(commit.mock.calls[1][0]).toEqual(initial)
  expect(screen.getByLabelText('外观 · 背景颜色')).toHaveValue('')
})
it('R4 honors an explicit project enum instead of the builtin oneOf choices',()=>{
  const data=createAudioData('sound');data.channel='music'
  render(<ComponentPropertiesEditor definition={{...AUDIO_DEFINITION,
    dataSchema:{properties:{channel:{title:'声音角色',enum:['music']}}}}}
    node={{id:'audio',definitionId:AUDIO_DEFINITION.id,data:JSON.parse(JSON.stringify(data))}} onChange={()=>{}}/>)
  const choices=screen.getByRole('combobox',{name:'声音角色'}) as HTMLSelectElement
  expect(Array.from(choices.options).map(option=>option.value)).toEqual(['music'])
  expect(choices).toHaveValue('music')
})
it('R4 delegates rich table cell undo and redo to the document owner',async()=>{
  const data=createTableData({rows:1,columns:1}),first=data.rows[0].cells[0]
  data.rows[0].cells[0]={id:first.id,columnId:first.columnId,content:{inlines:[{type:'text',text:'编辑内容'}]}}
  const undo=vi.fn(),redo=vi.fn(),edit=vi.fn()
  const ui=render(<TableComponentEditor instanceId="table" data={data} onEdit={edit} onUndo={undo} onRedo={redo}/>)
  const editor=ui.container.querySelector<HTMLElement>('.ProseMirror')!
  fireEvent.keyDown(editor,{key:'z',code:'KeyZ',ctrlKey:true})
  await waitFor(()=>expect(undo).toHaveBeenCalledOnce())
  fireEvent.keyDown(editor,{key:'z',code:'KeyZ',ctrlKey:true,shiftKey:true})
  await waitFor(()=>expect(redo).toHaveBeenCalledOnce())
  expect(undo).toHaveBeenCalledOnce();expect(redo).toHaveBeenCalledOnce();expect(edit).not.toHaveBeenCalled()
})
it('shows only consumed Flow body frame controls while retaining opacity and floating geometry',()=>{
  const project=fixture(),state=useEditorStore.getState()
  project.definitions.image={...IMAGE_DEFINITION,id:'image'};project.definitions.formula={...FORMULA_DEFINITION,id:'formula'}
  project.instances.image={id:'image',definitionId:'image',data:JSON.parse(JSON.stringify(createImageData('image-asset'))),frame:structuredClone(frame)}
  project.instances.formula={id:'formula',definitionId:'formula',data:JSON.parse(JSON.stringify(createFormulaData('formula','x'))),frame:structuredClone(frame)}
  project.instances.floating={...project.instances.shape,id:'floating',flowPlacement:{space:'paper',plane:'overlay'}}
  project.assets['image-asset']={id:'image-asset',path:'assets/image.png',mimeType:'image/png'}
  setRootContainers(project, [{id:'flow',kind:'flow',title:'正文',childIds:['group','image','formula','floating']}])
  const controls=(id:string)=>{
    const read=selectPropertiesAuthoringReadModel({...state,slideContentEdit:null,editingScope:'scene',courseView:{...state.courseView,
      activeDocumentId:'flow-doc',surfaceId:'flow',activeStateId:null,snapshot:null,project,editingProject:project,selectedInstanceIds:[id],selectedInstanceId:id,error:null}})
    const native:SlideNativePropertiesContext={kind:'slide-native',draftBindingKey:id,view:read.selectedView!,target:{layerItemId:id},disabledReason:null,
      contentEditingEnabled:true,spatialMode:false,flowOrSpatial:true,editingScopeGlobal:false,frameEditingEnabled:true,
      notices:{surfaceBaseEditing:false,sceneOwner:false,presentationStateName:null,stateOverrideApplied:false},videoDiagnostics:[],animation:null,interaction:null,globalInteraction:null,component:null,
      commands:{patch(){},replaceImage(){},clearPresentationOverride(){},openAutomation(){},openProfessionalAutomation(){},text:{beginEdit(){},updateDraft(){},commitEdit(){},cancelEdit(){},toggleStyle(){}},table:null,chart:null},onFeedback(){}}
    const context=buildFlowPropertiesOwner({read,kernel:state.courseKernel,actions:state,documentSelection:null,selectedContext:native,assets:{},
      liveTarget(){throw new Error('read-only controls')},submit(){},preview(){},report(){}})!.native!
    render(<CommonNodeProperties node={context.view} update={()=>{}} showGeometryFields={context.frameEditingEnabled!==false}
      showDimensions={(context.frameDimensionsEditingEnabled??context.frameEditingEnabled)!==false}/>)
    const result={position:Boolean(screen.queryByLabelText('X')),angle:Boolean(screen.queryByLabelText('旋转角度')),size:Boolean(screen.queryByLabelText('宽')),opacity:Boolean(screen.queryByLabelText('透明度 %'))}
    cleanup();return result
  }
  expect(controls('formula')).toEqual({position:false,angle:false,size:false,opacity:true})
  expect(controls('image')).toEqual({position:false,angle:false,size:true,opacity:true})
  expect(controls('group')).toEqual({position:false,angle:false,size:true,opacity:true})
  expect(controls('shape')).toEqual({position:true,angle:true,size:true,opacity:true})
  expect(controls('floating')).toEqual({position:true,angle:true,size:true,opacity:true})
})
it('uses the actual Flow page controls and preserves custom reading widths through History',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-flow-settings-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery')),project=fixture()
  setRootContainers(project, [{id:'flow',kind:'flow',title:'原讲义',childIds:['group','neighbor'],
    background:{mode:'own',color:'#eeeeee',fit:'contain'},flow:{layout:{widthMode:'reading',readingWidth:720,wideContentWidth:980}}}])
  const first=await service.internalAPI.create({kind:'course-v10',project,resources:{assets:{},components:{}}},'讲义')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api);dispose.push(async()=>useEditorStore.getState().courseBridge.dispose())
  await useEditorStore.getState().courseBridge.activate(first.documentId)
  useEditorStore.getState().selectNodes([])
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  fireEvent.change(screen.getByLabelText('讲义宽度'),{target:{value:'fluid'}})
  await waitFor(()=>expect(testContainerInstance(useEditorStore.getState().courseKernel.readDocument(), 0).container!.flow?.layout.widthMode).toBe('fluid'))
  const changed=useEditorStore.getState().courseKernel.readDocument()
  expect(testContainerInstance(changed, 0).container!.flow?.layout).toEqual({...testContainerInstance(project, 0).container!.flow!.layout,widthMode:'fluid'})
  expect(testContainerInstance(changed, 0).container!.background).toEqual(testContainerInstance(project, 0).container!.background)
  expect(contentInstances(changed)).toEqual(contentInstances(project))
  expect({ ...changed.instances.flow, container: undefined }).toEqual({ ...project.instances.flow, container: undefined })
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(1)
  await act(async()=>useEditorStore.getState().courseBridge.undo(first.documentId))
  expect(testContainerInstance(useEditorStore.getState().courseKernel.readDocument(), 0).container!.flow).toEqual(testContainerInstance(project, 0).container!.flow)
  await act(async()=>useEditorStore.getState().courseBridge.redo(first.documentId))
  expect(testContainerInstance(useEditorStore.getState().courseKernel.readDocument(), 0).container!.flow).toEqual(testContainerInstance(changed, 0).container!.flow)
})
it('opens Flow page settings from an object and persists numeric paper width through History and archive reload',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-flow-page-width-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery')),project=fixture()
  setRootContainers(project, [{id:'flow',kind:'flow',title:'宽度讲义',childIds:['group','neighbor'],flow:{layout:{widthMode:'reading',readingWidth:900,wideContentWidth:1100}}}])
  const first=await service.internalAPI.create({kind:'course-v10',project,resources:{assets:{},components:{}}},'讲义')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api);dispose.push(async()=>useEditorStore.getState().courseBridge.dispose())
  await useEditorStore.getState().courseBridge.activate(first.documentId)
  useEditorStore.getState().setEditingScope('scene');useEditorStore.getState().selectNodes(['neighbor'])
  render(<CourseEditorChromeContext.Provider value={{documentId:first.documentId,mode:'light',setMode(){}}}>
    <CourseLightToolbar documentId={first.documentId} isCurrentDocument={id=>useEditorStore.getState().courseView.activeDocumentId===id}
      canUndo={false} canRedo={false} undo={()=>{}} redo={()=>{}} save={()=>{}} saveAs={()=>{}} onReplaceImage={()=>{}}
      onAddText={()=>{}} onAddImage={()=>{}} onAddVideo={()=>{}} onAddAudio={()=>{}} insertSurface="flow" editingScope="scene" spatialScope={null} mode="edit"
      reportError={message=>{throw new Error(message)}} onOpenPageProperties={()=>{void openCoursePageProperties({kernel:useEditorStore.getState().courseKernel,
        drain:id=>useEditorStore.getState().drainCourseDocument(id),open:()=>useEditorStore.getState().setActiveTab('properties')})}} />
    <PropertiesTab onReplaceImage={()=>{}} />
  </CourseEditorChromeContext.Provider>)
  expect(screen.queryByTestId('flow-page-properties')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'页面属性'}))
  await waitFor(()=>expect(screen.getByRole('spinbutton',{name:'纸面宽度'})).toHaveValue('900'))
  expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual([])
  const width=screen.getByRole('spinbutton',{name:'纸面宽度'})
  fireEvent.change(width,{target:{value:'1024'}});fireEvent.keyDown(width,{key:'Enter'})
  await waitFor(()=>expect(testContainerInstance(useEditorStore.getState().courseKernel.readDocument(), 0).container!.flow!.layout.readingWidth).toBe(1024))
  expect(testContainerInstance(useEditorStore.getState().courseKernel.readDocument(), 0).container!.flow!.layout.wideContentWidth).toBe(1100)
  expect(contentInstances(useEditorStore.getState().courseKernel.readDocument())).toEqual(contentInstances(project))
  expect({ ...useEditorStore.getState().courseKernel.readDocument().instances.flow, container: undefined }).toEqual({ ...project.instances.flow, container: undefined })
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(1)
  await act(async()=>useEditorStore.getState().courseBridge.undo(first.documentId))
  expect(testContainerInstance(useEditorStore.getState().courseKernel.readDocument(), 0).container!.flow!.layout.readingWidth).toBe(900)
  await act(async()=>useEditorStore.getState().courseBridge.redo(first.documentId))
  fireEvent.change(screen.getByLabelText('讲义宽度'),{target:{value:'fluid'}})
  await waitFor(()=>expect(screen.getByRole('spinbutton',{name:'纸面宽度'})).toHaveValue('1100'))
  const wide=screen.getByRole('spinbutton',{name:'纸面宽度'})
  fireEvent.change(wide,{target:{value:'1200'}});fireEvent.keyDown(wide,{key:'Enter'})
  await waitFor(()=>expect(testContainerInstance(useEditorStore.getState().courseKernel.readDocument(), 0).container!.flow!.layout.wideContentWidth).toBe(1200))
  expect(testContainerInstance(useEditorStore.getState().courseKernel.readDocument(), 0).container!.flow!.layout.readingWidth).toBe(1024)
  const saved=path.join(directory,'width.glx');await service.internalAPI.save(first.documentId,saved)
  const cold=await new CourseV10Driver().load(await readFile(saved))
  if(cold.kind!=='course-v10')throw new Error('Expected course archive')
  expect(testContainerInstance(cold.project, 0).container!.flow!.layout).toMatchObject({widthMode:'fluid',readingWidth:1024,wideContentWidth:1200})
})
it('keeps a later page selection when opening Flow settings is still committing input',async()=>{
  const project=fixture();setRootContainers(project, [{id:'flow',kind:'flow',title:'原讲义',childIds:['group','neighbor']},{id:'other',kind:'flow',title:'另一讲义',childIds:[]}])
  const host=await createV10StoreHost(project),gate=deferred(),opened=vi.fn();dispose.push(async()=>host.bridge.dispose())
  host.kernel.selectInstances(['neighbor'],'flow')
  const pending=openCoursePageProperties({kernel:host.kernel,drain:async id=>{await gate.promise;return host.api.read(id)},open:opened})
  host.kernel.selectSurface('other');gate.resolve();await pending
  expect(host.kernel.readView().surfaceId).toBe('other');expect(opened).not.toHaveBeenCalled()
  expect((await host.api.read(host.first.documentId)).undoDepth).toBe(0)
})
it.each(['slide','flow','spatial'] as const)('opens %s page properties from a selected object and returns to normal object editing',async kind=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-page-properties-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery')),project=fixture()
  setRootContainers(project, [{id:'page',kind,title:'当前页面',childIds:['group','neighbor'],
    ...(kind==='flow'?{flow:{layout:{widthMode:'reading' as const,readingWidth:900,wideContentWidth:1100}}}:{}),
    ...(kind==='spatial'?{spatial:{home:{x:10,y:20,zoom:1},frames:[],paths:[{id:'path-one',title:'原路径',instanceIds:['neighbor'],frameIds:[]}]}}:{})}])
  const first=await service.internalAPI.create({kind:'course-v10',project,resources:{assets:{},components:{}}},'页面属性')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api);dispose.push(async()=>useEditorStore.getState().courseBridge.dispose())
  await useEditorStore.getState().courseBridge.activate(first.documentId)
  useEditorStore.getState().setEditingScope('global')
  if(kind==='spatial')useEditorStore.getState().setSpatialGraphSelection({kind:'path',id:'path-one'},'page')
  useEditorStore.getState().selectNodes(['neighbor'])
  const initial=structuredClone(useEditorStore.getState().courseKernel.readDocument())
  function ContextKind(){const context=usePropertiesContext({onReplaceImage(){}});return <output data-testid="page-properties-kind">{context.kind}</output>}
  render(<CourseEditorChromeContext.Provider value={{documentId:first.documentId,mode:'light',setMode(){}}}>
    <CourseLightToolbar documentId={first.documentId} isCurrentDocument={id=>useEditorStore.getState().courseView.activeDocumentId===id}
      canUndo={false} canRedo={false} undo={()=>{}} redo={()=>{}} save={()=>{}} saveAs={()=>{}} onReplaceImage={()=>{}}
      onAddText={()=>{}} onAddImage={()=>{}} onAddVideo={()=>{}} onAddAudio={()=>{}} insertSurface={kind} editingScope="global" spatialScope={kind==='spatial'?'global':null} mode="edit"
      reportError={message=>{throw new Error(message)}} onOpenPageProperties={()=>{void openCoursePageProperties({kernel:useEditorStore.getState().courseKernel,
        drain:id=>useEditorStore.getState().drainCourseDocument(id),open:surfaceId=>{
          const current=useEditorStore.getState();current.setEditingScope('scene')
          if(componentSurfaces(current.courseView.project!).find(surface=>surface.id===surfaceId)?.kind==='spatial')current.setSpatialGraphSelection(null,surfaceId)
          current.setActiveTab('properties')
        }})}} />
    <ContextKind/><PropertiesTab onReplaceImage={()=>{}} />
  </CourseEditorChromeContext.Provider>)
  expect(screen.getByTestId('page-properties-kind')).toHaveTextContent(kind==='flow'?'flow-block':'slide-native')
  fireEvent.click(screen.getByRole('button',{name:'页面属性'}))
  await waitFor(()=>expect(screen.getByTestId('page-properties-kind')).toHaveTextContent(kind==='slide'?'empty-scene':`${kind}-page`))
  expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual([])
  expect(useEditorStore.getState().courseKernel.readDocument()).toEqual(initial)
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(0)
  if(kind==='spatial')expect(useEditorStore.getState().readSpatialView('page',first.documentId).graphSelection).toBeNull()
  await act(async()=>useEditorStore.getState().selectNodes(['neighbor']))
  await waitFor(()=>expect(screen.getByTestId('page-properties-kind')).toHaveTextContent(kind==='flow'?'flow-block':'slide-native'))
  if(kind==='flow'){
    const size=screen.getByLabelText('字号');fireEvent.change(size,{target:{value:'40'}});fireEvent.keyDown(size,{key:'Enter'})
    await waitFor(()=>{const block=projectFlowBlock(useEditorStore.getState().courseKernel.readDocument(),'neighbor');expect(block.type).toBe('paragraph');if(block.type==='paragraph')expect(block.content.inlines[0].style?.fontSize).toBe(40)})
  }else{
    const name=screen.getByLabelText('名称');fireEvent.change(name,{target:{value:'重新选择后编辑'}});fireEvent.keyDown(name,{key:'Enter'})
    await waitFor(()=>expect(useEditorStore.getState().courseKernel.readDocument().instances.neighbor.name).toBe('重新选择后编辑'))
  }
  await act(async()=>useEditorStore.getState().drainCourseDocument(first.documentId))
  const confirmed=await service.internalAPI.read(first.documentId)
  if(confirmed.model.kind!=='course-v10')throw new Error('Expected course model')
  const neighbor=kind==='flow'?confirmed.model.project.instances.neighbor:{...initial.instances.neighbor,name:'重新选择后编辑'}
  expect(confirmed.model.project).toEqual({...initial,revision:initial.revision+1,instances:{...initial.instances,neighbor}})
  if(kind==='flow'){
    expect(neighbor.id).toBe('neighbor');expect(neighbor.definitionId).toBe(initial.instances.neighbor.definitionId);expect(neighbor.frame).toEqual(initial.instances.neighbor.frame)
    const block=projectFlowBlock(confirmed.model.project,'neighbor');expect(block.type).toBe('paragraph');if(block.type==='paragraph')expect(block.content.inlines).toMatchObject([{text:'邻居',style:{fontSize:40}}])
  }
  expect(confirmed.revision).toBe(first.revision+1);expect(confirmed.undoDepth).toBe(1)
})
it('does not open a replacement session of the same Flow document after an older settings request',async()=>{
  const project=fixture();setRootContainers(project, [{id:'flow',kind:'flow',title:'讲义',childIds:['group','neighbor']}])
  const host=await createV10StoreHost(project),gate=deferred(),opened=vi.fn();dispose.push(async()=>host.bridge.dispose())
  const documentId=host.first.documentId,originalEpoch=host.first.read().epoch,recovery=structuredClone(host.durable.get(documentId)!)
  host.kernel.selectInstances(['neighbor'],'flow')
  const pending=openCoursePageProperties({kernel:host.kernel,drain:async id=>{await gate.promise;return host.api.read(id)},open:opened})
  await host.registry.close(documentId,{discardDirty:true});const replacement=await host.registry.restore(recovery)
  await host.bridge.connect({...host.api,bootstrapCourse:()=>host.api.read(documentId)})
  host.kernel.selectInstances(['neighbor'],'flow');gate.resolve();await pending
  expect(replacement.read().epoch).not.toBe(originalEpoch)
  expect(opened).not.toHaveBeenCalled();expect(host.kernel.readView().selectedInstanceIds).toEqual(['neighbor'])
})
it('uses the actual Flow destination control and preserves identity and world frame across a nested reading section',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-flow-destination-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery')),project=fixture()
  project.definitions.section= {...DOCUMENT_BLOCK_DEFINITION,id:'section'}
  project.instances={text:project.instances.text,neighbor:project.instances.neighbor,
    section:{id:'section',definitionId:'section',name:'嵌套正文',childIds:['text'],
      data:documentBlockData({id:'section',type:'section',title:{inlines:[]},collapsedByDefault:false,blocks:[]}),
      frame:{width:600,height:400,transform:[1,0,0,1,100,200]}},
    floating:{...project.instances.shape,id:'floating',flowPlacement:{space:'paper',plane:'overlay'}}}
  setRootContainers(project, [{id:'flow',kind:'flow',title:'正文',childIds:['neighbor','section','floating']}])
  const first=await service.internalAPI.create({kind:'course-v10',project,resources:{assets:{},components:{}}},'讲义')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api);dispose.push(async()=>useEditorStore.getState().courseBridge.dispose())
  await useEditorStore.getState().courseBridge.activate(first.documentId)
  useEditorStore.getState().selectNode('floating')
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  fireEvent.change(screen.getByLabelText('正文位置'),{target:{value:JSON.stringify(['section',1])}})
  fireEvent.click(screen.getByRole('button',{name:'转回指定正文位置'}))
  await waitFor(()=>expect(useEditorStore.getState().courseKernel.readDocument().instances.section.childIds).toEqual(['text','floating']))
  const body=useEditorStore.getState().courseKernel.readDocument()
  expect(body.instances.floating).toMatchObject({id:'floating',definitionId:'shape',data:project.instances.floating.data,
    frame:{...frame,transform:[1.5,.4,.7,1.2,-65,-158]},flowLayout:{width:'content-width',wrap:'none'}})
  expect(body.instances.floating.flowPlacement).toBeUndefined()
  expect(body.instances.neighbor).toEqual(project.instances.neighbor)
  fireEvent.click(screen.getByRole('button',{name:/^转为浮层$/}))
  await waitFor(()=>expect(useEditorStore.getState().courseKernel.readDocument().instances.floating.flowPlacement).toEqual({space:'paper',plane:'overlay'}))
  const floating=useEditorStore.getState().courseKernel.readDocument()
  expect(floating.instances.floating.frame).toEqual(frame)
  expect(floating.instances.floating.data).toEqual(project.instances.floating.data)
  expect(floating.instances.section.childIds).toEqual(['text'])
  await waitFor(async()=>expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(2))
})
it('flushes an unblurred numeric draft and preserves the focused control',async()=>{
  const commit=vi.fn(), stale=vi.fn()
  render(<PropertyDraftBoundary bindingKey="doc:epoch:slide:shape" onStale={stale}><BufferedInput label="X" value={35} type="number" onCommit={commit}/></PropertyDraftBoundary>)
  const input=screen.getByLabelText('X'); input.focus(); fireEvent.change(input,{target:{value:'85'}})
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(true))
  expect(commit).toHaveBeenCalledExactlyOnceWith('85');expect(document.activeElement).toBe(input);expect(stale).not.toHaveBeenCalled()
})
it('retains IME input during save and commits its final text after composition',async()=>{
  const commit=vi.fn()
  render(<PropertyDraftBoundary bindingKey="doc:epoch:slide:shape" onStale={()=>{}}><BufferedInput label="名称" value="原名" onCommit={commit}/></PropertyDraftBoundary>)
  const input=screen.getByLabelText('名称');input.focus();fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'中文名称'}})
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(false));expect(commit).not.toHaveBeenCalled();expect(document.activeElement).toBe(input)
  fireEvent.compositionEnd(input);await act(async()=>expect(await flushPropertiesDrafts()).toBe(true));expect(commit).toHaveBeenCalledExactlyOnceWith('中文名称')
})
it('retains a dirty draft when the captured target changes and refuses to retarget save',async()=>{
  const first=vi.fn(),second=vi.fn(),stale=vi.fn()
  const key=(id:string)=>JSON.stringify(['property-target-switch','epoch','root','slide',null,[id],false,''])
  const view=(key:string,commit:typeof first,value:string)=><PropertyDraftBoundary bindingKey={key} onStale={stale}><BufferedInput label="名称" value={value} onCommit={commit}/></PropertyDraftBoundary>
  const {rerender}=render(view(key('first'),first,'原名'));const input=screen.getByLabelText('名称');input.focus();fireEvent.change(input,{target:{value:'尚未提交'}})
  rerender(view(key('second'),second,'邻居'));expect(screen.getByLabelText('名称')).not.toBe(input);expect(screen.getByLabelText('名称')).toHaveValue('邻居')
  expect(input.isConnected).toBe(false)
  await act(async()=>expect(await flushPropertiesDrafts('property-target-switch')).toBe(true))
  expect(preservePropertiesDrafts('property-target-switch')).toEqual([expect.objectContaining({bindingKey:key('first'),raw:'尚未提交'})])
  expect(first).not.toHaveBeenCalled();expect(second).not.toHaveBeenCalled();expect(stale).not.toHaveBeenCalled()
  rerender(view(key('first'),first,'原名'));const restored=screen.getByLabelText('名称');expect(restored).toHaveValue('尚未提交')
  fireEvent.keyDown(restored,{key:'Escape'});expect(restored).toHaveValue('原名')
  expect(preservePropertiesDrafts('property-target-switch')).toEqual([])
  expect(first).not.toHaveBeenCalled();expect(second).not.toHaveBeenCalled()
  discardPropertiesDrafts('property-target-switch')
})
it('commits original text/shape properties and affine frame through one Session, undoes/redoes and reopens',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-properties-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery')), project=fixture()
  const first=await service.internalAPI.create({kind:'course-v10',project,resources:{assets:{},components:{}}},'属性.h5lesson')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  const bridge=new CourseV10DocumentBridge();await bridge.connect(api);dispose.push(async()=>bridge.dispose())
  const kernel=createEditorStoreKernel({bridge,commit:()=>{}}),before=structuredClone(kernel.readDocument())
  const edits=[...componentPropertiesEdits(before.instances.text,before.definitions.text,{style:{bold:true,fontSize:32}}),
    ...componentPropertiesEdits(before.instances.shape,before.definitions.shape,{x:85,y:97,rotation:70,style:{fillColor:'#123456'}})]
  await kernel.edit(edits)
  const changed=kernel.readDocument(), [a,b,c,d]=changed.instances.shape.frame!.transform,[oldA,oldB,oldC,oldD]=frame.transform
  expect(changed.instances.shape.frame!.transform.slice(4)).toEqual([85,97]);expect(Math.atan2(b,a)*180/Math.PI).toBeCloseTo(70)
  expect(a*a+b*b).toBeCloseTo(oldA*oldA+oldB*oldB);expect(c*c+d*d).toBeCloseTo(oldC*oldC+oldD*oldD);expect(a*c+b*d).toBeCloseTo(oldA*oldC+oldB*oldD)
  expect(changed.instances.shape.data).toMatchObject({style:{fillColor:'#123456'}});expect(changed.instances.text.data).toMatchObject({appearance:{bold:true,fontSize:32}})
  expect(changed.instances.group).toEqual(before.instances.group);expect(changed.instances.neighbor).toEqual(before.instances.neighbor);expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(1)
  await kernel.navigateHistory('undo');expect(kernel.readDocument().instances).toEqual(before.instances)
  await kernel.navigateHistory('redo');expect(kernel.readDocument().instances).toEqual(changed.instances)
  const filename=path.join(directory,'属性.h5lesson');await service.internalAPI.save(first.documentId,filename)
  const reopened=await new DocumentHostService(path.join(directory,'independent')).open(filename)
  expect(reopened.model).toMatchObject({kind:'course-v10',project:{instances:changed.instances}})
})
it('projects only the matching preview target without mutating the formal project',()=>{
  const project=fixture(),before=structuredClone(project),preview={target:{documentId:'doc',epoch:'epoch',surfaceId:'slide',stateId:null,owner:'instance' as const,instanceId:'shape'},
    edits:componentPropertiesEdits(project.instances.shape,project.definitions.shape,{style:{fillColor:'#abcdef'},x:91})}
  const result=projectWithBackgroundPreview(project,preview,'doc','slide',null,'epoch')
  expect(result.instances.shape.data).toMatchObject({style:{fillColor:'#abcdef'}});expect(result.instances.shape.frame!.transform[4]).toBe(91);expect(result.instances.neighbor).toEqual(before.instances.neighbor)
  expect(project).toEqual(before);expect(result.revision).toBe(project.revision)
  expect(projectWithBackgroundPreview(project,preview,'doc','slide',null,'new-epoch')).toBe(project)
  expect(projectWithBackgroundPreview(project,preview,'doc','slide','state','epoch')).toBe(project)
  expect(projectWithBackgroundPreview(project,preview,'other-doc','slide',null,'epoch')).toBe(project)
  const retiredInstance={...project,instances:{...project.instances}};delete retiredInstance.instances.shape
  expect(projectWithBackgroundPreview(retiredInstance,preview,'doc','slide',null,'epoch')).toBe(retiredInstance)
  const retiredSurface={...project,rootIds:[],entry:undefined,instances:{...project.instances}};delete retiredSurface.instances.slide
  expect(projectWithBackgroundPreview(retiredSurface,preview,'doc','slide',null,'epoch')).toBe(retiredSurface)

  testContainerInstance(project, 0).container!.presentation={states:[{id:'state',title:'人工状态',overrides:{shape:{frame:{...frame,width:333}}}}]}
  const resolved=resolveComponentPresentation(project,'slide','state')
  const statePreview={...preview,target:{...preview.target,stateId:'state'},edits:componentPropertiesEdits(resolved.instances.shape,project.definitions.shape,{style:{fillColor:'#abcdef'}})}
  expect(projectWithBackgroundPreview(resolved,statePreview,'doc','slide','state','epoch').instances.shape.frame).toEqual(resolved.instances.shape.frame)
  expect(projectWithBackgroundPreview(before,statePreview,'doc','slide','state','epoch')).toBe(before)

  const actions=useEditorStore.getState(),newPreview={...preview,target:{...preview.target,documentId:'new-doc'}}
  actions.setPreviewBackgroundColor(newPreview)
  actions.setPreviewBackgroundColor(null,preview.target)
  expect(useEditorStore.getState().previewBackgroundColor).toBe(newPreview)
  for(const target of [{...newPreview.target,epoch:'retired'},{...newPreview.target,surfaceId:'other'},
    {...newPreview.target,stateId:'other'},{...newPreview.target,owner:'surface' as const},{...newPreview.target,instanceId:'neighbor'}]){
    actions.setPreviewBackgroundColor(null,target)
    expect(useEditorStore.getState().previewBackgroundColor).toBe(newPreview)
  }
  actions.setPreviewBackgroundColor(null,newPreview.target)
  expect(useEditorStore.getState().previewBackgroundColor).toBeNull()
})
it('previews, cancels, confirms and undoes an original color control through the Bridge without committing the text draft or frame',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-properties-preview-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery')),project=fixture()
  const first=await service.internalAPI.create({kind:'course-v10',project,resources:{assets:{},components:{}}},'颜色预览.h5lesson')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')},dispatch=vi.fn(service.internalAPI.dispatch)
  const api:DocumentHostAPI={...service.internalAPI,dispatch,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api)
  const actions=useEditorStore.getState()
  actions.cancelTextEdit();actions.setPreviewBackgroundColor(null);actions.selectNode('text')
  actions.beginSlideDataEdit('text','canvas');actions.updateSlideDataDraft(createTextData('保留未提交文字'),false,160)
  const draft=useEditorStore.getState().slideContentEdit!
  actions.selectNode('shape')
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  const input=screen.getByLabelText('填充色'),before=await service.internalAPI.read(first.documentId)
  const rendered=()=>{
    const state=useEditorStore.getState(),view=state.courseView
    return projectWithBackgroundPreview(projectWithSlideContentDraft(view.editingProject!,state.slideContentEdit,
      {documentId:first.documentId,epoch:view.snapshot?.epoch,surfaceId:view.surfaceId,activeStateId:view.activeStateId}),
    state.previewBackgroundColor,view.activeDocumentId,view.surfaceId,view.activeStateId,view.snapshot?.epoch)
  }
  input.focus();fireEvent.change(input,{target:{value:'#abcdef'}})
  expect(rendered().instances.shape.data).toMatchObject({style:{fillColor:'#abcdef'}})
  expect(rendered().instances.shape.frame).toEqual(frame)
  expect(rendered().instances.text.data).toEqual(draft.data)
  expect(rendered().instances.text.frame?.height).toBe(160)
  expect(await service.internalAPI.read(first.documentId)).toMatchObject({revision:before.revision,dirty:before.dirty,undoDepth:0})
  expect(dispatch).not.toHaveBeenCalled()
  fireEvent.keyDown(input,{key:'Escape'})
  expect(useEditorStore.getState().previewBackgroundColor).toBeNull()
  expect(rendered().instances.shape).toEqual(project.instances.shape)
  expect(useEditorStore.getState().slideContentEdit).toBe(draft)
  input.focus();fireEvent.change(input,{target:{value:'#123456'}})
  await act(async()=>{fireEvent.keyDown(input,{key:'Enter'});await actions.courseKernel.waitForCommit()})
  expect(dispatch).toHaveBeenCalledOnce()
  const committed=await service.internalAPI.read(first.documentId)
  expect(committed).toMatchObject({revision:before.revision+1,undoDepth:1,model:{kind:'course-v10',project:{instances:{shape:{data:{style:{fillColor:'#123456'}},frame},text:project.instances.text}}}})
  expect(useEditorStore.getState().previewBackgroundColor).toBeNull()
  expect(useEditorStore.getState().slideContentEdit).toBe(draft)
  await act(async()=>{await actions.courseKernel.navigateHistory('undo')})
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(0)
  expect(actions.courseKernel.readDocument().instances.shape).toEqual(project.instances.shape)
  expect(useEditorStore.getState().slideContentEdit).toBe(draft)
  expect(rendered().instances.text.data).toEqual(draft.data)
  await act(async()=>{actions.selectNode('text')})
  const textColor=screen.getByLabelText('文字颜色'),afterUndo=await service.internalAPI.read(first.documentId),callsAfterUndo=dispatch.mock.calls.length
  textColor.focus();fireEvent.change(textColor,{target:{value:'#fedcba'}})
  expect(rendered().instances.text.data).toMatchObject({content:{inlines:[{type:'text',text:'保留未提交文字'}]},appearance:{color:'#fedcba'}})
  expect(rendered().instances.text.frame).toEqual({...frame,height:160})
  expect(useEditorStore.getState().slideContentEdit).toBe(draft)
  expect(await service.internalAPI.read(first.documentId)).toMatchObject({revision:afterUndo.revision,dirty:afterUndo.dirty,undoDepth:0})
  expect(dispatch).toHaveBeenCalledTimes(callsAfterUndo)
  fireEvent.keyDown(textColor,{key:'Escape'})
  expect(useEditorStore.getState().previewBackgroundColor).toBeNull()
  expect(rendered().instances.text.data).toEqual(draft.data)
  expect(useEditorStore.getState().slideContentEdit).toBe(draft)
  textColor.focus();fireEvent.change(textColor,{target:{value:'#aa11aa'}})
  expect(useEditorStore.getState().previewBackgroundColor?.target.instanceId).toBe('text')
  await act(async()=>{actions.selectNode('neighbor')})
  expect(useEditorStore.getState().previewBackgroundColor).toBeNull()
  expect(useEditorStore.getState().slideContentEdit).toBe(draft)
  expect(dispatch).toHaveBeenCalledTimes(callsAfterUndo)
  actions.cancelTextEdit()
})
it('binds the original PropertiesTab text field to the shared canvas draft and saves without blur',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-properties-ui-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery'))
  const first=await service.internalAPI.create({kind:'course-v10',project:fixture(),resources:{assets:{},components:{}}},'原属性.h5lesson')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api)
  useEditorStore.getState().selectNode('text')
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  const input=screen.getByLabelText('文字内容');input.focus();fireEvent.change(input,{target:{value:'未失焦的中文输入'}})
  expect(useEditorStore.getState().slideContentEdit?.data).toMatchObject({content:{inlines:[{type:'text',text:'未失焦的中文输入'}]}})
  await act(async()=>{await useEditorStore.getState().drainCourseDocument(first.documentId)})
  expect(document.activeElement).toBe(input);expect(useEditorStore.getState().slideContentEdit).toBeNull()
  const saved=await service.internalAPI.read(first.documentId)
  expect(saved.undoDepth).toBe(1);expect(saved.model).toMatchObject({kind:'course-v10',project:{instances:{text:{data:{content:{inlines:[{type:'text',text:'未失焦的中文输入'}]}}}}}})
  await act(async()=>{await useEditorStore.getState().courseKernel.navigateHistory('undo')})
  expect(input).toHaveValue('原文')
  await act(async()=>{await useEditorStore.getState().courseKernel.navigateHistory('redo')})
  expect(input).toHaveValue('未失焦的中文输入')
  const filename=path.join(directory,'原属性.h5lesson');await service.internalAPI.save(first.documentId,filename)
  const reopened=await new DocumentHostService(path.join(directory,'independent')).open(filename)
  expect(reopened.model).toMatchObject({kind:'course-v10',project:{instances:{text:{data:{content:{inlines:[{type:'text',text:'未失焦的中文输入'}]}}},neighbor:fixture().instances.neighbor}}})
})
it('edits formal formula source in the original control without flattening matrices or ignoring inline appearance',async()=>{
  let project=fixture()
  const source='\\begin{matrix}a&b\\\\c&d\\end{matrix}', next='\\begin{matrix}a&b\\\\c&e\\end{matrix}'
  project.definitions.formula={...FORMULA_DEFINITION,id:'formula'}
  const data=createFormulaData('math-1',source)
  data.formula.style={fontSize:42,color:'#123456'}
  project.instances.formula={id:'formula',definitionId:'formula',data:JSON.parse(JSON.stringify(data)),frame:structuredClone(frame)}
  testContainerInstance(project, 0).childIds.push('formula')
  const view=componentPropertiesView(project.instances.formula,project.definitions.formula)
  if(view.type!=='formula')throw new Error('formula view')
  expect(view.latex).toBe(source);expect(view.ast).toBeNull();expect(view.style).toMatchObject({fontSize:42,color:'#123456'})
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-properties-formula-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery'))
  const first=await service.internalAPI.create({kind:'course-v10',project,resources:{assets:{},components:{}}},'矩阵公式.h5lesson')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api)
  useEditorStore.getState().selectNode('formula')
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  const input=screen.getByLabelText('公式 LaTeX');input.focus();fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:next}})
  await act(async()=>expect(await flushPropertiesDrafts(first.documentId)).toBe(false))
  const composing=await service.internalAPI.read(first.documentId)
  expect(composing.undoDepth).toBe(0);expect(composing.model).toMatchObject({kind:'course-v10',project:{instances:{formula:{data:{formula:{latex:source}}}}}})
  fireEvent.compositionEnd(input)
  await act(async()=>{expect(await flushPropertiesDrafts(first.documentId)).toBe(true);await useEditorStore.getState().drainCourseDocument(first.documentId)})
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(1);expect(document.activeElement).toBe(input)
  project=useEditorStore.getState().courseKernel.readDocument()
  expect(project.instances.formula.data).toMatchObject({formula:{latex:next,formulaId:'math-1',style:{fontSize:42,color:'#123456'}}})
  const edits=componentPropertiesEdits(project.instances.formula,project.definitions.formula,{style:{fontSize:60,color:'#abcdef'}})
  project=applyComponentOperation(project,captureComponentOperation(project,edits))
  expect(componentPropertiesView(project.instances.formula,project.definitions.formula)).toMatchObject({style:{fontSize:60,color:'#abcdef'},latex:next})
  expect(project.instances.neighbor).toEqual(fixture().instances.neighbor)
})
it('keeps whole-text absolute appearance and relative font stepping on their existing professional paths',()=>{
  let project=fixture()
  const data=createTextData({inlines:[
    {type:'text',text:'显式',style:{fontSize:42,color:'#123456',italic:true,bold:false},link:{href:'https://example.test'}},
    {type:'math',formulaId:'math-original',latex:'x+1',accessibleText:'x 加一',style:{fontSize:36,color:'#345678'}},
    {type:'text',text:'默认',style:{underline:true}},
  ]})
  project.instances.text.data=JSON.parse(JSON.stringify(data))
  const edits=componentPropertiesEdits(project.instances.text,project.definitions.text,{style:{fontSize:60,color:'#abcdef'}})
  project=applyComponentOperation(project,captureComponentOperation(project,edits))
  const expected=structuredClone(data)
  expected.appearance={...expected.appearance,fontSize:60,color:'#abcdef'}
  for(const inline of expected.content.inlines.slice(0,2))Object.assign(inline.style!,{fontSize:60,color:'#abcdef'})
  expect(project.instances.text).toEqual({...fixture().instances.text,data:expected})
  expect(project.instances.neighbor).toEqual(fixture().instances.neighbor)
  const original=fixture();original.instances.text.data=JSON.parse(JSON.stringify(data))
  const step=componentPropertiesEdits(original.instances.text,original.definitions.text,{fontSizeStep:1})
  expect(step).toEqual([
    {type:'data.set',instanceId:'text',path:['appearance','fontSize'],value:28},
    {type:'data.set',instanceId:'text',path:['content','inlines','0','style','fontSize'],value:46},
    {type:'data.set',instanceId:'text',path:['content','inlines','1','style','fontSize'],value:40},
  ])
})
it('preserves a dirty formula source on target change and refuses to save it into the neighbor',async()=>{
  const project=fixture()
  project.definitions.formula={...FORMULA_DEFINITION,id:'formula'}
  for(const id of ['formula','otherFormula'])project.instances[id]={id,definitionId:'formula',
    data:JSON.parse(JSON.stringify(createFormulaData(id,'x'))),frame:structuredClone(frame)}
  testContainerInstance(project, 0).childIds.push('formula','otherFormula')
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-properties-formula-target-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery'))
  const first=await service.internalAPI.create({kind:'course-v10',project,resources:{assets:{},components:{}}},'公式目标.h5lesson')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api)
  useEditorStore.getState().selectNode('formula')
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  const input=screen.getByLabelText('公式 LaTeX');input.focus();fireEvent.change(input,{target:{value:'x+1'}})
  act(()=>useEditorStore.getState().selectNode('otherFormula'))
  expect(input.isConnected).toBe(false)
  expect(screen.getByLabelText('公式 LaTeX')).toHaveValue('x')
  await act(async()=>expect(await flushPropertiesDrafts(first.documentId)).toBe(true))
  expect(preservePropertiesDrafts(first.documentId)).toEqual([expect.objectContaining({label:'公式 LaTeX',raw:'x+1'})])
  await useEditorStore.getState().courseInputs.persist([first.documentId])
  expect((await service.internalAPI.readAuthoringDrafts(first.documentId))?.properties).toEqual([expect.objectContaining({raw:'x+1'})])
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(0)
  expect(useEditorStore.getState().courseKernel.readDocument().instances).toEqual(project.instances)
  act(()=>useEditorStore.getState().selectNode('formula'))
  const restored=screen.getByLabelText('公式 LaTeX');expect(restored).toHaveValue('x+1')
  fireEvent.keyDown(restored,{key:'Escape'})
  await act(async()=>expect(await flushPropertiesDrafts(first.documentId)).toBe(true))
  expect(restored).toHaveValue('x')
  expect(preservePropertiesDrafts(first.documentId)).toEqual([])
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(0)
})
it('offers mounted feedback targets from the current surface and global subtrees',()=>{
  const project=fixture()
  project.definitions.behavior={id:'behavior',role:'behavior',implementation:{kind:'builtin',key:'guoling.interactions'}}
  project.instances.behavior={id:'behavior',definitionId:'behavior',data:{}}
  project.instances.other={...project.instances.neighbor,id:'other'}
  project.instances.globalGroup={...project.instances.group,id:'globalGroup',childIds:['globalText']}
  project.instances.globalText={...project.instances.neighbor,id:'globalText',visible:false}
  project.instances.scopedGlobal={...project.instances.neighbor,id:'scopedGlobal',visibility:{mode:'include',surfaceIds:['other-page']}}
  testContainerInstance(project, 0).childIds.push('behavior')
  appendRootContainers(project, {id:'other-page',kind:'slide',title:'另一页',childIds:['other']})
  project.global.overlay=['globalGroup','scopedGlobal']
  expect(propertiesFeedbackTargets(project,'slide','text').map(value=>value.id).sort()).toEqual(['globalGroup','globalText','group','neighbor','shape'])
})
it('keeps an IME property draft on target change and cancels its original canvas owner without writing the neighbor',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-properties-ime-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery'))
  const first=await service.internalAPI.create({kind:'course-v10',project:fixture(),resources:{assets:{},components:{}}},'输入.h5lesson')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api)
  useEditorStore.getState().selectNode('text')
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  const input=screen.getByLabelText('文字内容');input.focus();fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'原目标的中文草稿'}})
  fireEvent.blur(input)
  await act(async()=>{useEditorStore.getState().selectNode('neighbor')})
  expect(screen.getByLabelText('文字内容')).toBe(input)
  await act(async()=>{fireEvent.compositionEnd(input,{target:{value:'原目标的中文完成'}})})
  await waitFor(()=>expect(screen.getByLabelText('文字内容')).not.toBe(input))
  expect(input.isConnected).toBe(false)
  expect(screen.getByLabelText('文字内容')).toHaveValue('邻居')
  expect(preservePropertiesDrafts(first.documentId)).toEqual([expect.objectContaining({raw:'原目标的中文完成',composing:false})])
  await act(async()=>expect(await flushPropertiesDrafts(first.documentId)).toBe(true))
  expect(useEditorStore.getState().slideContentEdit).toMatchObject({instanceId:'text',composing:false})
  act(()=>useEditorStore.getState().selectNode('text'))
  const restored=screen.getByLabelText('文字内容');expect(restored).toHaveValue('原目标的中文完成')
  fireEvent.keyDown(restored,{key:'Escape'})
  expect(restored).toHaveValue('原文');expect(useEditorStore.getState().slideContentEdit).toBeNull()
  expect(preservePropertiesDrafts(first.documentId)).toEqual([])
  await act(async()=>{await useEditorStore.getState().drainCourseDocument(first.documentId)})
  const saved=await service.internalAPI.read(first.documentId)
  expect(saved.undoDepth).toBe(0)
  expect(saved.model).toMatchObject({kind:'course-v10',project:{instances:fixture().instances}})
})
it('does not acknowledge a new target text draft while the original captured text owner still blocks admission',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-properties-admission-'))
  dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery'))
  const first=await service.internalAPI.create({kind:'course-v10',project:fixture(),resources:{assets:{},components:{}}},'两个属性目标.glx')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api)
  try {
    useEditorStore.getState().selectNode('text')
    render(<PropertiesTab onReplaceImage={()=>{}}/>)
    const a=screen.getByLabelText('文字内容');a.focus();fireEvent.change(a,{target:{value:'A 原草稿'}})
    act(()=>useEditorStore.getState().selectNode('neighbor'))
    const b=screen.getByLabelText('文字内容');expect(b).not.toBe(a);expect(b).toHaveValue('邻居')
    b.focus();fireEvent.change(b,{target:{value:'B 必须保留的新草稿'}})
    await act(async()=>{
      const completed=await flushPropertiesDrafts(first.documentId),snapshot=await service.internalAPI.read(first.documentId)
      expect(completed,JSON.stringify({completed,records:preservePropertiesDrafts(first.documentId),undoDepth:snapshot.undoDepth,
        neighbor:snapshot.model.kind==='course-v10'?snapshot.model.project.instances.neighbor.data:null})).toBe(false)
    })
    expect(b).toHaveValue('B 必须保留的新草稿')
    expect(preservePropertiesDrafts(first.documentId)).toEqual(expect.arrayContaining([
      expect.objectContaining({raw:'A 原草稿'}),expect.objectContaining({raw:'B 必须保留的新草稿'}),
    ]))
    expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(0)
    act(()=>useEditorStore.getState().selectNode('text'))
    const restoredA=screen.getByLabelText('文字内容');expect(restoredA).toHaveValue('A 原草稿')
    fireEvent.keyDown(restoredA,{key:'Escape'})
    expect(useEditorStore.getState().slideContentEdit).toBeNull()
    act(()=>useEditorStore.getState().selectNode('neighbor'))
    const restoredB=screen.getByLabelText('文字内容');expect(restoredB).toHaveValue('B 必须保留的新草稿')
    await act(async()=>expect(await flushPropertiesDrafts(first.documentId)).toBe(true))
    const filename=path.join(directory,'两个属性目标.glx')
    await useEditorStore.getState().drainCourseDocument(first.documentId)
    await service.internalAPI.save(first.documentId,filename)
    const saved=await service.internalAPI.read(first.documentId)
    expect(saved.undoDepth).toBe(1)
    expect(saved.model).toMatchObject({kind:'course-v10',project:{instances:{
      text:fixture().instances.text,neighbor:{data:{content:{inlines:[{type:'text',text:'B 必须保留的新草稿'}]}}},
    }}})
    const cold=await new DocumentHostService(path.join(directory,'cold')).internalAPI.open(filename)
    expect(cold.model).toEqual(saved.model)
  } finally { discardPropertiesDrafts(first.documentId) }
})
it('waits for the actual property text ACK and retains raw and its original owner through rejection and retry',async()=>{
  const host=await createV10StoreHost(fixture()),gate=deferred()
  await useEditorStore.getState().connectCourseDocuments(host.api)
  useEditorStore.getState().selectNode('text')
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  const kernel=useEditorStore.getState().courseKernel
  const write=vi.spyOn(kernel,'editCaptured').mockImplementationOnce(async()=>{await gate.promise;throw new Error('text ACK rejected')})
  try {
    const input=screen.getByLabelText('文字内容');input.focus();fireEvent.change(input,{target:{value:'等待正式回执的草稿'}})
    let done=false,flushing!:Promise<boolean>
    await act(async()=>{flushing=flushPropertiesDrafts(host.first.documentId);void flushing.then(()=>{done=true});await Promise.resolve()})
    expect(write).toHaveBeenCalledOnce();expect(done).toBe(false)
    expect(preservePropertiesDrafts(host.first.documentId)).toEqual([expect.objectContaining({raw:'等待正式回执的草稿',baseline:'原文'})])
    await act(async()=>{gate.resolve();expect(await flushing).toBe(false)})
    expect(input).toHaveValue('等待正式回执的草稿')
    expect(preservePropertiesDrafts(host.first.documentId)).toEqual([expect.objectContaining({raw:'等待正式回执的草稿',baseline:'原文'})])
    expect(host.first.read().undoDepth).toBe(0)
    expect(useEditorStore.getState().slideContentEdit?.instanceId).toBe('text')
    await act(async()=>expect(await flushPropertiesDrafts(host.first.documentId)).toBe(true))
    expect(write).toHaveBeenCalledTimes(2)
    expect(host.first.read().undoDepth).toBe(1)
    expect(host.model().project.instances.text.data).toMatchObject({content:{inlines:[{type:'text',text:'等待正式回执的草稿'}]}})
    expect(host.model().project.instances.neighbor).toEqual(fixture().instances.neighbor)
    expect(preservePropertiesDrafts(host.first.documentId)).toEqual([])
  } finally {write.mockRestore();discardPropertiesDrafts(host.first.documentId);host.bridge.dispose()}
})
it('still accepts synchronous text staging before a composition editor applies its outer operation',async()=>{
  const key=JSON.stringify(['local-text-stage','epoch','composition']),begin=vi.fn(),stage=vi.fn()
  let text='原片段'
  render(<PropertyDraftBoundary bindingKey={key} onStale={()=>{}}>
    <TextContentTextarea label="局部文字" value={text} onBegin={begin} onChange={next=>{text=next}} onCommit={()=>stage(text)} onCancel={()=>{}}/>
  </PropertyDraftBoundary>)
  const input=screen.getByLabelText('局部文字');input.focus();fireEvent.change(input,{target:{value:'仅暂存的新片段'}})
  await act(async()=>expect(await flushPropertiesDrafts('local-text-stage')).toBe(true))
  expect(begin).toHaveBeenCalledOnce();expect(stage).toHaveBeenCalledExactlyOnceWith('仅暂存的新片段')
  expect(preservePropertiesDrafts('local-text-stage')).toEqual([])
  discardPropertiesDrafts('local-text-stage')
})
it('keeps a resumed text owner composing when its older parked ACK arrives before the next IME change',async()=>{
  const documentId='resumed-text-ime',gate=deferred(),commitA=vi.fn(()=>gate.promise),cancelA=vi.fn(),cancelB=vi.fn(),compositionA=vi.fn()
  const key=(id:string)=>JSON.stringify([documentId,'epoch','root','slide',null,[id],false,''])
  const view=(id:'a'|'b')=><PropertyDraftBoundary bindingKey={key(id)} onStale={()=>{}}>
    <TextContentTextarea label="恢复文字" value={id==='a'?'A 原文':'B 原文'} onBegin={()=>{}} onChange={()=>{}}
      onCommit={id==='a'?commitA:()=>{}} onCancel={id==='a'?cancelA:cancelB} onCompositionChange={id==='a'?compositionA:()=>{}}/>
  </PropertyDraftBoundary>
  const ui=render(view('a'))
  const first=screen.getByLabelText('恢复文字');first.focus();fireEvent.change(first,{target:{value:'A pending'}})
  let flushing!:Promise<boolean>
  await act(async()=>{flushing=flushPropertiesDrafts(documentId);await Promise.resolve()})
  ui.rerender(view('b'));ui.rerender(view('a'))
  const resumed=screen.getByLabelText('恢复文字');expect(resumed).not.toBe(first);expect(resumed).toHaveValue('A pending')
  fireEvent.compositionStart(resumed)
  await act(async()=>{gate.resolve();expect(await flushing).toBe(true)})
  expect(preservePropertiesDrafts(documentId)).toEqual([expect.objectContaining({raw:'A pending',baseline:'A pending',composing:true})])
  await act(async()=>expect(await flushPropertiesDrafts(documentId)).toBe(false))
  ui.rerender(view('b'));expect(screen.getByLabelText('恢复文字')).toBe(resumed)
  await act(async()=>{fireEvent.compositionEnd(resumed,{target:{value:'A 中文完成'}})})
  await waitFor(()=>expect(screen.getByLabelText('恢复文字')).not.toBe(resumed))
  ui.rerender(view('a'));const final=screen.getByLabelText('恢复文字');expect(final).toHaveValue('A 中文完成')
  fireEvent.keyDown(final,{key:'Escape'})
  expect(cancelA).toHaveBeenCalledOnce();expect(cancelB).not.toHaveBeenCalled()
  expect(compositionA.mock.calls.map(call=>call[0])).toEqual([true,false])
  expect(commitA).toHaveBeenCalledExactlyOnceWith('A pending')
  expect(preservePropertiesDrafts(documentId)).toEqual([])
  discardPropertiesDrafts(documentId)
})
it('previews a Flow caption range through the shared planner while retaining formula atoms and formal content',()=>{
  const project=fixture()
  testContainerInstance(project, 0).container!.kind='flow'
  const math=createFormulaData('caption-math','x^2').formula
  project.definitions.image={...IMAGE_DEFINITION,id:'image'}
  project.assets['caption-image']={id:'caption-image',path:'assets/caption-image.png',mimeType:'image/png'}
  project.instances.media={id:'media',definitionId:'image',data:JSON.parse(JSON.stringify(createImageData('caption-image'))),frame:structuredClone(frame),
    flowLayout:{width:'wide',wrap:'left',caption:{inlines:[{type:'text',text:'甲乙',style:{bold:true}},math,{type:'text',text:'丁',style:{italic:true}}]}}}
  testContainerInstance(project, 0).childIds.push('media')
  const before=structuredClone(project)
  const edits=flowTextStyleEdits(project,{kind:'text',revision:'0',anchor:{blockId:'media',slot:{kind:'field',field:'caption'},offset:1,affinity:'before'},head:{blockId:'media',slot:{kind:'field',field:'caption'},offset:3,affinity:'after'}},{color:'#abcdef'})
  const preview={target:{documentId:'doc',epoch:'epoch',surfaceId:'slide',stateId:null,owner:'instance' as const,instanceId:'media'},edits}
  const result=projectWithBackgroundPreview(project,preview,'doc','slide',null,'epoch')
  expect(result.instances.media.flowLayout).toMatchObject({width:'wide',wrap:'left',caption:{inlines:[{type:'text',text:'甲',style:{bold:true}},{type:'text',text:'乙',style:{bold:true,color:'#abcdef'}},{...math,style:{color:'#abcdef'}},{type:'text',text:'丁',style:{italic:true}}]}})
  expect(result.instances.neighbor).toEqual(before.instances.neighbor);expect(project).toEqual(before);expect(result.revision).toBe(project.revision)
})
it('coalesces canvas text and measured frame with original property position and angle in one Session edit',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'guoling-properties-frame-'));dispose.push(()=>rm(directory,{recursive:true,force:true}))
  const service=new DocumentHostService(path.join(directory,'recovery'))
  const first=await service.internalAPI.create({kind:'course-v10',project:fixture(),resources:{assets:{},components:{}}},'同草稿.h5lesson')
  const unavailable=async():Promise<never>=>{throw new Error('fixture no dialog')}
  const api:DocumentHostAPI={...service.internalAPI,bootstrapCourse:()=>service.bootstrapCourse(),saveWithDialog:unavailable,close:unavailable,closeWithDialog:unavailable,discardRecovery:unavailable,subscribe:listener=>service.subscribeEvents(listener)}
  await useEditorStore.getState().connectCourseDocuments(api)
  useEditorStore.getState().selectNode('text')
  const initial=useEditorStore.getState().beginSlideDataEdit('text','canvas')!
  const data=createTextData('文字和框架共用草稿')
  useEditorStore.getState().updateSlideDataDraft(data,false,160)
  render(<PropertiesTab onReplaceImage={()=>{}}/>)
  expect(screen.getByRole('spinbutton',{name:'高'})).toHaveValue('160')
  const x=screen.getByLabelText('X');x.focus();fireEvent.change(x,{target:{value:'85'}})
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(true))
  expect(useEditorStore.getState().slideContentEdit).toMatchObject({target:{documentId:initial.target.documentId,epoch:initial.target.epoch},frame:{height:160,transform:[frame.transform[0],frame.transform[1],frame.transform[2],frame.transform[3],85,42]}})
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(0)
  const angle=screen.getByLabelText('旋转角度');angle.focus();fireEvent.change(angle,{target:{value:'70'}})
  await act(async()=>{useEditorStore.getState().updateSlideDataDraft(data,false,180)})
  await act(async()=>{await useEditorStore.getState().drainCourseDocument(first.documentId)})
  expect(document.activeElement).toBe(angle)
  const project=useEditorStore.getState().courseKernel.readDocument(),changed=project.instances.text
  expect(changed.data).toMatchObject({content:{inlines:[{type:'text',text:'文字和框架共用草稿'}]}})
  expect(changed.frame).toMatchObject({height:180,width:220})
  const [a,b,c,d,tx,ty]=changed.frame!.transform,[oldA,oldB,oldC,oldD]=frame.transform
  expect([tx,ty]).toEqual([85,42]);expect(Math.atan2(b,a)*180/Math.PI).toBeCloseTo(70)
  expect(a*a+b*b).toBeCloseTo(oldA*oldA+oldB*oldB);expect(c*c+d*d).toBeCloseTo(oldC*oldC+oldD*oldD);expect(a*c+b*d).toBeCloseTo(oldA*oldC+oldB*oldD)
  expect(project.instances.group).toEqual(fixture().instances.group);expect(project.instances.neighbor).toEqual(fixture().instances.neighbor)
  expect((await service.internalAPI.read(first.documentId)).undoDepth).toBe(1)
  await act(async()=>{await useEditorStore.getState().courseKernel.navigateHistory('undo')})
  expect(useEditorStore.getState().courseKernel.readDocument().instances.text).toEqual(fixture().instances.text)
  await act(async()=>{await useEditorStore.getState().courseKernel.navigateHistory('redo')})
  expect(useEditorStore.getState().courseKernel.readDocument().instances.text).toEqual(changed)
})
