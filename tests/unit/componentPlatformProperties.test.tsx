import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BufferedInput, PropertyDraftBoundary, flushPropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import { componentPropertiesEdits, componentPropertiesView, propertiesFeedbackTargets, propertiesFramePatch } from '../../src/renderer/ui/properties/componentProperties'
import { projectWithBackgroundPreview } from '../../src/renderer/authoring/backgroundPreview'
import { createTextData, createFormulaData, FORMULA_DEFINITION, TEXT_DEFINITION } from '../../src/components/text'
import { FormulaAuthoringEditor } from '../../src/renderer/ui/FormulaAuthoringEditor'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { flowTextStyleEdits } from '../../src/renderer/componentPlatform/surfaces/flow/documentSelection'
import { createImageData, IMAGE_DEFINITION } from '../../src/components/image'
import { defaultShapeData, SHAPE_DEFINITION } from '../../src/components/shape'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
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
const dispose: Array<() => Promise<void>> = []
afterEach(async () => { cleanup(); for (const action of dispose.splice(0).reverse()) await action() })
const frame = { width: 220, height: 90, transform: [1.5, .4, .7, 1.2, 35, 42] as [number,number,number,number,number,number] }
const fixture = (): CourseProjectV10 => ({ schemaVersion:10,id:'properties',revision:0,title:'属性',definitions:{text: {...TEXT_DEFINITION,id:'text'}, shape:{...SHAPE_DEFINITION,id:'shape'}, group:{id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}}},
  instances:{ group:{id:'group',definitionId:'group',data:{},childIds:['text','shape'],frame:{...frame,transform:[1,.2,.1,1,10,15]}},
    text:{id:'text',definitionId:'text',data:JSON.parse(JSON.stringify(createTextData('原文'))),frame:structuredClone(frame)},
    shape:{id:'shape',definitionId:'shape',data:defaultShapeData(),frame:structuredClone(frame)},
    neighbor:{id:'neighbor',definitionId:'text',data:JSON.parse(JSON.stringify(createTextData('邻居'))),frame:structuredClone(frame)} },
  surfaces:[{id:'slide',kind:'slide',title:'第1页',childIds:['group','neighbor']}],global:{underlay:[],overlay:[]},assets:{} })
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
it('R4 delegates rich table cell undo and redo to the document owner',()=>{
  const data=createTableData({rows:1,columns:1}),first=data.rows[0].cells[0]
  data.rows[0].cells[0]={id:first.id,columnId:first.columnId,content:{inlines:[{type:'text',text:'编辑内容'}]}}
  const undo=vi.fn(),redo=vi.fn(),edit=vi.fn()
  render(<TableComponentEditor instanceId="table" data={data} onEdit={edit} onUndo={undo} onRedo={redo}/>)
  fireEvent.click(screen.getAllByRole('button',{name:'撤销'})[0])
  fireEvent.click(screen.getAllByRole('button',{name:'重做'})[0])
  expect(undo).toHaveBeenCalledOnce();expect(redo).toHaveBeenCalledOnce();expect(edit).not.toHaveBeenCalled()
})
it('shows only consumed Flow body frame controls while retaining opacity and floating geometry',()=>{
  const project=fixture(),state=useEditorStore.getState()
  project.definitions.image={...IMAGE_DEFINITION,id:'image'};project.definitions.formula={...FORMULA_DEFINITION,id:'formula'}
  project.instances.image={id:'image',definitionId:'image',data:JSON.parse(JSON.stringify(createImageData('image-asset'))),frame:structuredClone(frame)}
  project.instances.formula={id:'formula',definitionId:'formula',data:JSON.parse(JSON.stringify(createFormulaData('formula','x'))),frame:structuredClone(frame)}
  project.instances.floating={...project.instances.shape,id:'floating',flowPlacement:{space:'paper',plane:'overlay'}}
  project.assets['image-asset']={id:'image-asset',path:'assets/image.png',mimeType:'image/png'}
  project.surfaces=[{id:'flow',kind:'flow',title:'正文',childIds:['group','image','formula','floating']}]
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
  const view=(key:string,commit:typeof first,value:string)=><PropertyDraftBoundary bindingKey={key} onStale={stale}><BufferedInput label="名称" value={value} onCommit={commit}/></PropertyDraftBoundary>
  const {rerender}=render(view('first',first,'原名'));const input=screen.getByLabelText('名称');input.focus();fireEvent.change(input,{target:{value:'尚未提交'}})
  rerender(view('second',second,'邻居'));expect(screen.getByLabelText('名称')).toBe(input);expect(input).toHaveValue('尚未提交')
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(false));expect(first).not.toHaveBeenCalled();expect(second).not.toHaveBeenCalled();expect(stale).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(input,{key:'Escape'});expect(input).toHaveValue('邻居')
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
  project.surfaces[0].childIds.push('formula')
  const view=componentPropertiesView(project.instances.formula,project.definitions.formula)
  if(view.type!=='formula')throw new Error('formula view')
  expect(view.latex).toBe(source);expect(view.ast).toBeNull();expect(view.style).toMatchObject({fontSize:42,color:'#123456'})
  const commit=vi.fn((latex:string,accessibleText:string)=>{
    const edits=componentPropertiesEdits(project.instances.formula,project.definitions.formula,{latex,accessibleText})
    project=applyComponentOperation(project,captureComponentOperation(project,edits))
  })
  render(<PropertyDraftBoundary bindingKey="formula" onStale={()=>{}}><FormulaAuthoringEditor node={view} latexSource={view.latex} onCommit={()=>{throw new Error('derived AST must not become source')}} onCommitLatex={commit}/></PropertyDraftBoundary>)
  const input=screen.getByLabelText('公式内容（线性输入）');input.focus();fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:next}})
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(false));expect(commit).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(true))
  expect(commit).toHaveBeenCalledTimes(1);expect(document.activeElement).toBe(input)
  expect(project.instances.formula.data).toMatchObject({formula:{latex:next,formulaId:'math-1',style:{fontSize:42,color:'#123456'}}})
  const edits=componentPropertiesEdits(project.instances.formula,project.definitions.formula,{style:{fontSize:60,color:'#abcdef'}})
  project=applyComponentOperation(project,captureComponentOperation(project,edits))
  expect(componentPropertiesView(project.instances.formula,project.definitions.formula)).toMatchObject({style:{fontSize:60,color:'#abcdef'},latex:next})
  expect(project.instances.neighbor).toEqual(fixture().instances.neighbor)
})
it('offers mounted feedback targets from the current surface and global subtrees',()=>{
  const project=fixture()
  project.definitions.behavior={id:'behavior',role:'behavior',implementation:{kind:'builtin',key:'guoling.interactions'}}
  project.instances.behavior={id:'behavior',definitionId:'behavior',data:{}}
  project.instances.other={...project.instances.neighbor,id:'other'}
  project.instances.globalGroup={...project.instances.group,id:'globalGroup',childIds:['globalText']}
  project.instances.globalText={...project.instances.neighbor,id:'globalText',visible:false}
  project.instances.scopedGlobal={...project.instances.neighbor,id:'scopedGlobal',visibility:{mode:'include',surfaceIds:['other-page']}}
  project.surfaces[0].childIds.push('behavior')
  project.surfaces.push({id:'other-page',kind:'slide',title:'另一页',childIds:['other']})
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
  await act(async()=>{useEditorStore.getState().selectNode('neighbor')})
  expect(screen.getByLabelText('文字内容')).toBe(input)
  fireEvent.compositionEnd(input)
  expect(input).toHaveValue('原目标的中文草稿')
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(false))
  expect(useEditorStore.getState().slideContentEdit).toMatchObject({instanceId:'text',composing:false})
  fireEvent.keyDown(input,{key:'Escape'})
  expect(input).toHaveValue('邻居');expect(useEditorStore.getState().slideContentEdit).toBeNull()
  await act(async()=>{await useEditorStore.getState().drainCourseDocument(first.documentId)})
  const saved=await service.internalAPI.read(first.documentId)
  expect(saved.undoDepth).toBe(0)
  expect(saved.model).toMatchObject({kind:'course-v10',project:{instances:fixture().instances}})
})
it('previews a Flow caption range through the shared planner while retaining formula atoms and formal content',()=>{
  const project=fixture()
  project.surfaces[0].kind='flow'
  const math=createFormulaData('caption-math','x^2').formula
  project.definitions.image={...IMAGE_DEFINITION,id:'image'}
  project.assets['caption-image']={id:'caption-image',path:'assets/caption-image.png',mimeType:'image/png'}
  project.instances.media={id:'media',definitionId:'image',data:JSON.parse(JSON.stringify(createImageData('caption-image'))),frame:structuredClone(frame),
    flowLayout:{width:'wide',wrap:'left',caption:{inlines:[{type:'text',text:'甲乙',style:{bold:true}},math,{type:'text',text:'丁',style:{italic:true}}]}}}
  project.surfaces[0].childIds.push('media')
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
  expect(screen.getByLabelText('高')).toHaveValue(160)
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
