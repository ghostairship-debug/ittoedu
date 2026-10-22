import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { TextProperties } from '../../src/renderer/ui/properties/SlideNativePropertiesPanel'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { useSlideNativeTextEditor } from '../../src/renderer/ui/workspaces/useSlideNativeTextEditor'
import { TABLE_DEFINITION } from '../../src/components/table/adapters'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { layoutTable } from '../../src/components/table/render'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { JsonValue } from '../../src/shared/contracts/component-platform'
import type { FlowTextContent } from '../../src/shared/document/content'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('CA098 binds textarea selection to its current object; CA097 pressed uses the selected runs',()=>{
  const a=createTextNode({id:'a',text:'ABCDE',runs:[{start:1,end:3,style:{bold:true}}]}),b=createTextNode({id:'b',text:'YZ'}),toggleStyle=vi.fn()
  const textCommands={beginEdit:vi.fn(),updateDraft:vi.fn(),commitEdit:vi.fn(),cancelEdit:vi.fn(),setComposing:vi.fn(),toggleStyle},ui=render(<TextProperties node={a} update={()=>{}} textCommands={textCommands}/>),input=ui.getByRole('textbox',{name:'文字内容'}) as HTMLTextAreaElement
  input.focus();input.setSelectionRange(1,3);fireEvent.select(input)
  expect(ui.getByRole('button',{name:'加粗'})).toHaveAttribute('aria-pressed','true')
  fireEvent.click(ui.getByRole('button',{name:'加粗'}));expect(toggleStyle).toHaveBeenLastCalledWith('bold',{start:1,end:3})
  ui.rerender(<TextProperties node={b} update={()=>{}} textCommands={textCommands}/>);fireEvent.click(ui.getByRole('button',{name:'加粗'}))
  expect(toggleStyle).toHaveBeenLastCalledWith('bold',{start:0,end:0});expect(ui.getByRole('button',{name:'加粗'})).toHaveAttribute('aria-pressed','false')
})
it('CA097 textarea UTF16 selection reads scalar run styles after an emoji',()=>{
  const node=createTextNode({id:'emoji',text:'😀AB',runs:[{start:1,end:2,style:{bold:true}}]}),textCommands={beginEdit:vi.fn(),updateDraft:vi.fn(),commitEdit:vi.fn(),cancelEdit:vi.fn(),setComposing:vi.fn(),toggleStyle:vi.fn()},ui=render(<TextProperties node={node} update={()=>{}} textCommands={textCommands}/>),input=ui.getByRole('textbox',{name:'文字内容'}) as HTMLTextAreaElement
  input.focus();input.setSelectionRange(2,3);fireEvent.select(input);expect(ui.getByRole('button',{name:'加粗'})).toHaveAttribute('aria-pressed','true')
})
it.each([{width:600,height:120},{width:900,height:240}])('CA169 Tab append uses the actual table frame $width x $height and CA202 preserves rich content',async dimensions=>{
  const project=createBlankCourseProjectV10(),surface=componentSurfaces(project)[0],data=createTableData({rows:3,columns:3}),last=data.rows[2].cells[2]
  const rich:FlowTextContent={inlines:[{type:'text',text:'变量',style:{bold:true}},{type:'math',formulaId:'m',latex:'x^2',accessibleText:'x平方'},{type:'text',text:'链接',link:{href:'https://example.com'}}]}
  data.rows[2].cells[2]={id:last.id,columnId:last.columnId,content:rich}
  project.definitions[TABLE_DEFINITION.id]=TABLE_DEFINITION;project.instances.table={id:'table',definitionId:TABLE_DEFINITION.id,data:JSON.parse(JSON.stringify(data)) as JsonValue,frame:{...dimensions,transform:[1,0,0,1,0,0]}};testContainerInstance(project, 0).childIds=['table']
  const target={documentId:'doc',epoch:'epoch',project,editingProject:project,resources:{assets:{},components:{}},surfaceId:surface.id,activeStateId:null,instanceIds:['table'],instanceId:'table'} as CapturedCourseTarget
  let owner:ReturnType<typeof useSlideNativeTextEditor>|undefined
  const report=vi.fn()
  function Harness(){const [edit,setEdit]=useState<SlideContentEdit|null>(null),live=useRef<SlideContentEdit|null>(null)
    owner=useSlideNativeTextEditor({project,surfaceId:surface.id,edit,begin:instanceId=>{const instance=project.instances[instanceId],draft={instanceId,definitionId:instance.definitionId,target,data:structuredClone(instance.data),originalData:structuredClone(instance.data),source:'canvas' as const,composing:false};live.current=draft;setEdit(draft);return draft},update:(next,composing)=>{if(live.current){live.current={...live.current,data:next as JsonValue,composing:composing??false};setEdit(live.current)}},commit:async()=>{if(live.current)project.instances.table.data=live.current.data as JsonValue;live.current=null;setEdit(null)},cancel:()=>setEdit(null),undo(){},redo(){},host:()=>document.body,report},'doc');return owner.editor}
  const ui=render(<Harness/>),lastLayout=layoutTable(data,dimensions).cells.at(-1)!
  act(()=>{expect(owner?.begin('table',{x:lastLayout.x+1,y:lastLayout.y+1},{x:1,y:1})).toBe(true)})
  const input=ui.getByRole('textbox') as HTMLInputElement
  await act(async()=>{fireEvent.keyDown(input,{key:'Tab'});await Promise.resolve()})
  const saved=parseTableData(project.instances.table.data),next=layoutTable(saved,dimensions).cells[9]
  expect(saved.rows).toHaveLength(4);expect(saved.rows[2].cells[2].content).toEqual(rich)
  expect(ui.getByTestId('canvas-plain-text-editor').style.top).toBe(`${next.y}px`);expect(ui.getByTestId('canvas-plain-text-editor').style.left).toBe(`${next.x}px`);expect(ui.getByTestId('canvas-plain-text-editor').style.width).toBe(`${next.width}px`);expect(report).not.toHaveBeenCalled()
})
