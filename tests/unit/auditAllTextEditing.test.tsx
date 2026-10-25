import { setRootContainers } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import { CellSelection } from 'prosemirror-tables'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import * as sessions from '../../src/renderer/document/editorSession'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { fromEditorDocument, toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { documentEditorSchema as schema } from '../../src/renderer/document/editorSchema'
import { createDocumentBlock, documentBlockMenu } from '../../src/renderer/document/documentBlockCommands'
import { createDocumentInputRuleResult } from '../../src/renderer/document/documentInputRules'
import { parseDocumentMarkdown, serializeDocumentMarkdown, type MarkdownDocument } from '../../src/shared/document/markdown'
import { editMarkdownSource } from '../../src/shared/document/markdownSourceEdit'
import { documentContentSchema, plainDocumentText, type DocumentBlock, type FlowTextContent } from '../../src/shared/document/content'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import { renderDocumentMath } from '../../src/shared/document/render'
import { createTableData, parseTableData, toNativeTableData } from '../../src/components/table/data'
import { editTableData } from '../../src/components/table/edit'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { projectFlowDocument, flowDocumentEdits } from '../../src/core/components/document/flowDocumentProjection'
import { applyComponentOperation,captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createCourseDocumentClipboardContext,readCourseDocumentClipboardContext } from '../../src/renderer/document/documentClipboardContext'
import { createFlowDocumentResourcePort } from '../../src/renderer/document/flowDocumentResources'
import { fileClipboardResourcePort } from '../../src/renderer/documentFiles/fileDocumentClipboard'

const text=(value:string):FlowTextContent=>({inlines:[{type:'text',text:value}]})
const para=(id:string,value:string):DocumentBlock=>({id,type:'paragraph',content:text(value)})
const formula={type:'math' as const,formulaId:'math',latex:'x^2',accessibleText:'x平方',style:{fontSize:20,color:'#000000'}}
const documentOf=(blocks:DocumentBlock[]):MarkdownDocument=>({content:{blocks},resources:emptyDocumentResources()})
let editors:ReturnType<typeof sessions.createLayoutEditor>[]=[]
beforeEach(()=>{
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[new DOMRect(100,100,50,24)]})
  Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>new DOMRect(100,100,50,24)})
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(new DOMRect(100,100,600,400))
})
afterEach(()=>{cleanup();editors.forEach(editor=>{if(!editor.view.isDestroyed)editor.destroy()});editors=[];vi.restoreAllMocks()})
function editor(blocks:DocumentBlock[],extra:Partial<sessions.LayoutEditorOptions>={}) {
  const host=document.createElement('div');document.body.append(host)
  const change=vi.fn(()=>true),diagnostic=vi.fn(),selection=vi.fn()
  const value=sessions.createLayoutEditor(host,{document:documentOf(blocks),revision:'1',change,diagnostic,selection,undo(){},redo(){},...extra})
  editors.push(value);return {value,change,diagnostic,selection}
}
const key=(value:ReturnType<typeof sessions.createLayoutEditor>,name:string,shift=false)=>value.view.someProp('handleKeyDown',fn=>fn(value.view,new KeyboardEvent('keydown',{key:name,shiftKey:shift})))
function at(value:ReturnType<typeof sessions.createLayoutEditor>,find:(node:any)=>boolean) {let result=-1;value.view.state.doc.descendants((node,pos)=>{if(result<0 && find(node))result=pos;return result<0});return result}
function select(value:ReturnType<typeof sessions.createLayoutEditor>,from:number,to=from){value.view.dispatch(value.view.state.tr.setSelection(TextSelection.create(value.view.state.doc,from,to)))}
const current=(value:ReturnType<typeof sessions.createLayoutEditor>)=>fromEditorDocument(value.view.state.doc)
function shared(blocks:DocumentBlock[],extra:Record<string,any>={}) {
  const factory=vi.spyOn(sessions,'createLayoutEditor'),change=vi.fn(()=>true),ref=createRef<SharedDocumentEditorHandle>()
  const props={document:documentOf(blocks),revision:'1',target:'flow' as const,onChange:change,onDraft(){},onUndo(){},onRedo(){},...extra}
  const ui=render(<SharedDocumentEditor {...props} ref={ref}/>),value=factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
  // These owner tests exercise text input after Flow's explicit entry into editing.
  act(()=>{value.setInputActive(true);value.view.focus()})
  editors.push(value);return {ui,value,change,ref,props}
}
function table():Extract<DocumentBlock,{type:'table'}>{return {id:'table',type:'table',headerEnabled:false,columns:[{id:'a',header:text('H1')},{id:'b',header:text('H2')}],rows:[{id:'r1',cells:{a:text('A'),b:text('B')}},{id:'r2',cells:{a:text('C'),b:text('D')}}]}}

describe('R09 formal text positions',()=>{
  it('CA117 a header CellSelection publishes null instead of retaining the previous body context',()=>{
    const block=table();block.headerEnabled=true;const {value,selection}=editor([para('p','old'),block]);select(value,1,2);expect(selection.mock.calls.at(-1)?.[0]).toMatchObject({kind:'text'})
    const pos=at(value,node=>node.type.name==='table_header');value.view.dispatch(value.view.state.tr.setSelection(CellSelection.create(value.view.state.doc,pos)))
    expect(value.readSelection()).toBeNull();expect(selection.mock.calls.at(-1)?.[0]).toBeNull()
  })
  it('CA267 Slash menu Escape restores the original paragraph focus and selection',async()=>{
    const {ui,value}=shared([para('p','')]);act(()=>{select(value,1);value.view.focus()});const selected=value.view.state.selection
    fireEvent.keyDown(value.view.dom,{key:'/'});expect(ui.getByRole('menu',{name:'插入段落'})).toBeTruthy();expect(document.activeElement).not.toBe(value.view.dom)
    fireEvent.keyDown(window,{key:'Escape'});await act(async()=>{await Promise.resolve()});expect(ui.queryByRole('menu',{name:'插入段落'})).toBeNull();expect(document.activeElement).toBe(value.view.dom);expect(value.view.state.selection.eq(selected)).toBe(true)
  })
  it('CA096 edits the original formula after text is inserted before its dialog target',()=>{
    const {ui,value}=shared([{id:'p',type:'paragraph',content:{inlines:[{type:'text',text:'A'},formula,{type:'text',text:'B'}]}}])
    act(()=>value.view.dispatch(value.view.state.tr.setSelection(NodeSelection.create(value.view.state.doc,2))))
    fireEvent.click(ui.getByRole('button',{name:'当前选区公式'}))
    act(()=>value.view.dispatch(value.view.state.tr.insertText('prefix',1)))
    const input=ui.getByRole('textbox',{name:'公式 LaTeX'})
    fireEvent.change(input,{target:{value:'y'}});fireEvent.keyDown(input,{key:'Enter'})
    expect(current(value).blocks[0]).toMatchObject({content:{inlines:[{text:'prefixA'},{formulaId:'math',latex:'y'},{text:'B'}]}})
  })
  it('CA187 reports the actual caret after replacing BC with X',()=>{
    const {value,selection}=editor([para('p','ABCDE')])
    select(value,2,4);value.view.dispatch(value.view.state.tr.insertText('X'))
    expect(selection.mock.calls.at(-1)?.[0]).toMatchObject({kind:'text',anchor:{offset:2},head:{offset:2}})
    expect(current(value).blocks[0]).toMatchObject({content:text('AXDE')})
  })
})
describe('R25 table slots and rich cell authoring',()=>{
  it('CA013 table paste can grow a destination while assigning new stable row/column slots',()=>{
    const {value,diagnostic}=editor([table()]);const cells:number[]=[];value.view.state.doc.descendants((node,pos)=>{if(node.type.name==='table_cell')cells.push(pos)})
    value.view.dispatch(value.view.state.tr.setSelection(CellSelection.create(value.view.state.doc,cells[0],cells[1])))
    const data=new Map<string,string>(),clipboardData={setData:(k:string,v:string)=>data.set(k,v),getData:(k:string)=>data.get(k)??''},event={clipboardData,preventDefault:vi.fn()} as any
    value.view.someProp('handleDOMEvents',events=>events.copy?.(value.view,event));select(value,cells[3]+2)
    value.view.someProp('handlePaste',fn=>fn(value.view,event,value.view.state.selection.content()))
    const block=current(value).blocks[0] as ReturnType<typeof table>;expect(block.columns).toHaveLength(3);expect(Object.keys(block.rows[1].cells)).toHaveLength(3);expect(Object.values(block.rows[1].cells).map(plainDocumentText)).toEqual(['C','A','B']);expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA118 existing rowspans keep the correct covered slot when an uncovered cell is edited',()=>{
    const data=table();data.rows[1].cells.a={inlines:[]};data.merges=[{rowIds:['r1','r2'],columnIds:['a']}]
    const {value,diagnostic}=editor([data]),pos=at(value,node=>node.type.name==='slot' && node.attrs.key==='cell:["r2","b"]');select(value,pos+1,pos+2);value.view.dispatch(value.view.state.tr.insertText('E'))
    expect((current(value).blocks[0] as ReturnType<typeof table>).rows[1].cells).toEqual({a:{inlines:[]},b:text('E')});expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA013 copies and pastes a real CellSelection slice through the table owner',()=>{
    const {value,diagnostic}=editor([table()],{clipboardContext:()=>({kind:'cw-course-v10-resources'})})
    const cells:number[]=[];value.view.state.doc.descendants((node,pos)=>{if(node.type.name==='table_cell')cells.push(pos)})
    value.view.dispatch(value.view.state.tr.setSelection(CellSelection.create(value.view.state.doc,cells[0],cells[1])))
    const data=new Map<string,string>(),clipboardData={setData:(k:string,v:string)=>data.set(k,v),getData:(k:string)=>data.get(k)??''},event={clipboardData,preventDefault:vi.fn()} as any
    value.view.someProp('handleDOMEvents',events=>events.copy?.(value.view,event))
    expect(diagnostic).not.toHaveBeenCalled();expect(data.get('application/x-cw-document-slice')).toContain('table_row')
    value.view.dispatch(value.view.state.tr.setSelection(CellSelection.create(value.view.state.doc,cells[2],cells[3])))
    value.view.someProp('handlePaste',fn=>fn(value.view,event,value.view.state.selection.content()))
    expect(current(value).blocks[0]).toMatchObject({rows:[{cells:{a:text('A'),b:text('B')}},{cells:{a:text('A'),b:text('B')}}]})
    expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA013 paragraph paste stays inside the existing cell slot',()=>{
    const {value,diagnostic}=editor([table()]);const pos=at(value,node=>node.type.name==='slot' && node.attrs.key==='cell:["r1","a"]')
    select(value,pos+1,pos+2);value.view.pasteText('ABC',new Event('paste') as ClipboardEvent)
    expect(current(value).blocks).toHaveLength(1);expect((current(value).blocks[0] as ReturnType<typeof table>).rows[0].cells.a).toEqual(text('ABC'));expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA118 Delete clears selected cells without replacing their stable slots',()=>{
    const {value,diagnostic}=editor([table()]);const cells:number[]=[];value.view.state.doc.descendants((node,pos)=>{if(node.type.name==='table_cell')cells.push(pos)})
    value.view.dispatch(value.view.state.tr.setSelection(CellSelection.create(value.view.state.doc,cells[0],cells[1])))
    expect(key(value,'Delete')).toBe(true);expect((current(value).blocks[0] as ReturnType<typeof table>).rows[0].cells).toEqual({a:{inlines:[]},b:{inlines:[]}});expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA143 pure headers support table style and column width without adding body rows',()=>{
    const body=createTableData({rows:1,columns:1}),data=parseTableData({...body,rows:[],headerEnabled:true,columns:[{...body.columns[0],header:text('header')}]})
    const styled=editTableData(data,{kind:'table-style',stylePatch:{fontSize:21}}),sized=editTableData(styled,{kind:'column-width',columnId:data.columns[0].id,width:250})
    expect(sized.rows).toEqual([]);expect(sized.style.fontSize).toBe(21);expect(sized.columns[0].width).toBe(250)
  })
  it('CA201 rich virtual headers write the formal column header',()=>{
    const body=createTableData({rows:1,columns:1}),data=parseTableData({...body,columns:[{...body.columns[0],header:text('甲')}]})
    const next=editTableData(data,{kind:'cell-text',cellId:`flow_header_${data.columns[0].id}`,text:'乙'})
    expect(next.columns[0].header).toEqual(text('乙'));expect(next.rows).toEqual(data.rows)
  })
  it('CA202 both no-change and changed cell text preserve untouched styles, math and links',()=>{
    const body=createTableData({rows:1,columns:1}),cell=body.rows[0].cells[0],rich={inlines:[{type:'text' as const,text:'变量',style:{bold:true}},formula,{type:'text' as const,text:'链接',link:{href:'https://example.com'}}]}
    const data=parseTableData({...body,rows:[{...body.rows[0],cells:[{id:cell.id,columnId:cell.columnId,content:rich}]}]})
    const unchanged=editTableData(data,{kind:'cell-text',cellId:cell.id,text:plainDocumentText(rich)})
    expect(unchanged.rows[0].cells[0].content).toEqual(rich)
    const changed=editTableData(data,{kind:'cell-text',cellId:cell.id,text:'新变量x平方链接'})
    expect(changed.rows[0].cells[0].content?.inlines).toEqual([{type:'text',text:'新'},{type:'text',text:'变量',style:{bold:true}},formula,{type:'text',text:'链接',link:{href:'https://example.com'}}])
    const formulaEdit=editTableData(data,{kind:'cell-text',cellId:cell.id,text:'变量x立方链接'})
    expect(plainDocumentText(formulaEdit.rows[0].cells[0].content!)).toBe('变量x立方链接')
    expect(formulaEdit.rows[0].cells[0].content?.inlines).toEqual([{type:'text',text:'变量',style:{bold:true}},{type:'text',text:'x立方'},{type:'text',text:'链接',link:{href:'https://example.com'}}])
  })
  it('CA217 a 1000 body row table can enable its synthetic header',()=>{
    const body=createTableData({rows:1000,columns:1}),data=parseTableData({...body,headerEnabled:true,columns:[{...body.columns[0],header:text('head')}]})
    expect(data.rows).toHaveLength(1000);expect(toNativeTableData(data).rows).toHaveLength(1001)
  })
  it('CA313 a disabled header never creates an editable phantom row',()=>{
    const {value}=editor([table()]);expect(value.view.dom.querySelectorAll('tr')).toHaveLength(2);expect((current(value).blocks[0] as ReturnType<typeof table>).columns[0].header).toEqual(text('H1'))
  })
})
describe('R27 clipboard and native copy drop',()=>{
  it('CA362 the real PM copy selects only the formal package/version pair when delimiter-shaped names overlap',()=>{
    const first={id:'one',type:'component' as const,component:{packageId:'a@b',version:'c'},props:{},staticFallbackAssetId:'fallback'},second={id:'two',type:'component' as const,component:{packageId:'a',version:'b@c'},props:{},staticFallbackAssetId:'fallback'}
    const resources={assets:[{assetId:'fallback',mime:'image/png',source:{kind:'relative' as const,path:'fallback.png'}}],components:[first,second].map(block=>({...block.component,source:{kind:'relative' as const,path:block.id+'.h5component'}}))}
    const {value}=editor([first,second],{document:{content:{blocks:[first,second]},resources}}),pos=at(value,node=>node.attrs.id==='one');value.view.dispatch(value.view.state.tr.setSelection(NodeSelection.create(value.view.state.doc,pos)))
    const data=new Map<string,string>(),clipboardData={setData:(k:string,v:string)=>data.set(k,v),getData:(k:string)=>data.get(k)??''},event={clipboardData,preventDefault:vi.fn()} as any
    value.view.someProp('handleDOMEvents',events=>events.copy?.(value.view,event));expect(JSON.parse(data.get('application/x-cw-document-slice')!).resources.components.map((entry:any)=>entry.packageId)).toEqual(['a@b'])
  })
  it('CA015 ordinary HTML paste carries heading, bold, italic, links and a formal editable table',()=>{
    const {value,diagnostic}=editor([para('p','before')]);select(value,7)
    const html='<h1>标题</h1><p><strong>粗</strong><em>斜</em><a href="https://example.com">链</a></p><table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>'
    const event={clipboardData:{getData:(kind:string)=>kind==='text/html' ? html:''},preventDefault:vi.fn()} as any
    value.view.someProp('handlePaste',fn=>fn(value.view,event,value.view.state.selection.content()))
    const blocks=current(value).blocks;expect(blocks.some(block=>block.type==='heading' && block.level===1)).toBe(true)
    const rich=blocks.find(block=>block.type==='paragraph' && plainDocumentText(block.content)==='粗斜链') as Extract<DocumentBlock,{type:'paragraph'}>
    expect(rich.content.inlines).toMatchObject([{style:{bold:true}},{style:{italic:true}},{link:{href:'https://example.com'}}]);expect(blocks.find(block=>block.type==='table')).toMatchObject({rows:[{cells:expect.any(Object)},{cells:expect.any(Object)}]});expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA305 a Flow text slice with course context pastes into a Markdown file without resource preparation',async()=>{
    const source=editor([para('p','ABC')],{clipboardContext:()=>({kind:'cw-course-v10-resources'})}).value;select(source,2,3)
    const data=new Map<string,string>(),clipboardData={setData:(k:string,v:string)=>data.set(k,v),getData:(k:string)=>data.get(k)??''},event={clipboardData,preventDefault:vi.fn()} as any
    source.view.someProp('handleDOMEvents',events=>events.copy?.(source.view,event))
    const port=vi.fn(fileClipboardResourcePort),{value,change,diagnostic}=editor([para('file','File')],{clipboardResourcePort:port});select(value,5)
    value.view.someProp('handlePaste',fn=>fn(value.view,event,value.view.state.selection.content()));expect(await value.drain()).toBe(true)
    expect(current(value).blocks[0]).toMatchObject({content:text('FileB')});expect(change).toHaveBeenCalledTimes(1);expect(port).not.toHaveBeenCalled();expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA370 local cut B from p into q commits through Flow without reviving the still-present p instance',async()=>{
    let project=createBlankCourseProjectV10();const surfaceId=componentSurfaces(project)[0].id;setRootContainers(project, [...componentSurfaces(project).slice(0, 0), {...componentSurfaces(project)[0],kind:'flow',childIds:['p','q']}, ...componentSurfaces(project).slice(0 + 1)]);project.definitions[TEXT_DEFINITION.id]=TEXT_DEFINITION
    project.instances.p={id:'p',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('ABC')))};project.instances.q={id:'q',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('Q')))}
    const port=vi.fn((context:unknown)=>createFlowDocumentResourcePort({target:{documentId:'doc',epoch:'epoch',project,editingProject:project,resources:{assets:{},components:{}},surfaceId,activeStateId:null,instanceIds:[],instanceId:null} as any,source:readCourseDocumentClipboardContext(context)}))
    const {value,change,diagnostic}=editor(projectFlowDocument(project,surfaceId).content.blocks,{clipboardContext:(_resources:unknown,content:any)=>createCourseDocumentClipboardContext({documentId:'doc',project,roots:content.blocks.map((block:any)=>block.id),resources:{assets:{},components:{}}}),clipboardResourcePort:port,change:next=>{project=applyComponentOperation(project,captureComponentOperation(project,flowDocumentEdits(project,surfaceId,next.content.blocks)));return true}})
    select(value,2,3);const data=new Map<string,string>(),clipboardData={setData:(k:string,v:string)=>data.set(k,v),getData:(k:string)=>data.get(k)??''},event={clipboardData,preventDefault:vi.fn()} as any
    value.view.someProp('handleDOMEvents',events=>events.cut?.(value.view,event));const q=at(value,node=>node.attrs.id==='q');select(value,q+2);value.view.someProp('handlePaste',fn=>fn(value.view,event,value.view.state.selection.content()))
    expect(await value.drain()).toBe(true);expect((project.instances.p.data as any).content).toEqual(text('AC'));expect((project.instances.q.data as any).content).toEqual(text('QB'));expect(port).not.toHaveBeenCalled();expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA369 real Ctrl click, dragstart and copy drop preserve the original block identity',()=>{
    let project=createBlankCourseProjectV10();const surfaceId=componentSurfaces(project)[0].id;setRootContainers(project, [...componentSurfaces(project).slice(0, 0), {...componentSurfaces(project)[0],kind:'flow',childIds:['p','q']}, ...componentSurfaces(project).slice(0 + 1)]);project.definitions[TEXT_DEFINITION.id]=TEXT_DEFINITION
    const originalData=createTextComponentData('ABC');originalData.appearance.fontSize=36;originalData.appearance.color='#ff0000'
    project.instances.p={id:'p',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(originalData))};project.instances.q={id:'q',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('Q')))}
    const block={...para('p','ABC'),textDefaults:{fontSize:36,color:'#ff0000'}}, {value,diagnostic}=editor([block,para('q','Q')],{change:next=>{project=applyComponentOperation(project,captureComponentOperation(project,flowDocumentEdits(project,surfaceId,next.content.blocks)));return true}})
    vi.spyOn(value.view,'posAtCoords').mockReturnValue({pos:2,inside:0})
    const original=value.view.dom.firstElementChild!;fireEvent.mouseDown(original,{clientX:100,clientY:100,ctrlKey:true,button:0});fireEvent.mouseUp(original,{clientX:100,clientY:100,ctrlKey:true,button:0})
    expect(value.view.state.selection).toBeInstanceOf(NodeSelection)
    const data=new Map<string,string>(),transfer={files:[],clearData:()=>data.clear(),setData:(kind:string,text:string)=>data.set(kind,text),getData:(kind:string)=>data.get(kind)??'',effectAllowed:'copyMove'}
    const drag=new MouseEvent('dragstart',{bubbles:true,cancelable:true,clientX:100,clientY:100,ctrlKey:true});Object.defineProperty(drag,'dataTransfer',{value:transfer});fireEvent(original,drag);expect(value.view.dragging).not.toBeNull()
    vi.mocked(value.view.posAtCoords).mockReturnValue({pos:0,inside:-1});const drop=new MouseEvent('drop',{bubbles:true,cancelable:true,clientX:90,clientY:90,ctrlKey:true});Object.defineProperty(drop,'dataTransfer',{value:transfer});fireEvent(value.view.dom,drop)
    const blocks=current(value).blocks;expect(blocks).toHaveLength(3);expect(blocks[0].id).not.toBe('p');expect(blocks[1]).toEqual(block);expect(componentSurfaces(project)[0].childIds[1]).toBe('p');expect(project.instances.p.data).toMatchObject({appearance:{fontSize:36,color:'#ff0000'}});expect(diagnostic).not.toHaveBeenCalled()
  })
})
describe('R26 compound slot edits',()=>{
  it.each(['quote','callout'] as const)('CA171 deleting %s optional/required slots clears their formal fields',kind=>{
    const block:DocumentBlock=kind==='quote' ? {id:'x',type:'quote',content:text('BODY'),citation:text('CITE')}:{id:'x',type:'callout',tone:'note',title:text('TITLE'),body:text('BODY')}
    const {value}=editor([block]),slot=at(value,node=>node.type.name==='slot' && node.attrs.key===(kind==='quote' ? 'citation':'body')),node=value.view.state.doc.nodeAt(slot)!
    value.view.dispatch(value.view.state.tr.delete(slot,slot+node.nodeSize))
    expect(current(value).blocks[0]).toEqual(kind==='quote' ? {id:'x',type:'quote',content:text('BODY')}:{id:'x',type:'callout',tone:'note',title:text('TITLE'),body:{inlines:[]}})
  })
  it.each(['quote','callout'] as const)('CA203 multiline paste preserves the %s named body slot',kind=>{
    const block:DocumentBlock=kind==='quote' ? {id:'x',type:'quote',content:text('AB'),citation:text('CITE')}:{id:'x',type:'callout',tone:'note',title:text('TITLE'),body:text('AB')}
    const {value,diagnostic}=editor([block]),slot=at(value,node=>node.type.name==='slot' && node.attrs.key===(kind==='quote' ? 'content':'body'))
    select(value,slot+2);value.view.pasteText('x\ny',new Event('paste') as ClipboardEvent)
    expect(current(value).blocks[0]).toMatchObject(kind==='quote' ? {content:text('Ax\nyB'),citation:text('CITE')}:{title:text('TITLE'),body:text('Ax\nyB')});expect(diagnostic).not.toHaveBeenCalled()
  })
})
describe('R06 and R28 structural text editing',()=>{
  it('CA232 inserts below and types into the new paragraph',()=>{
    const {ui,value}=shared([para('a','原段落'),para('b','后文')]);act(()=>select(value,1))
    fireEvent.click(ui.getByRole('button',{name:'段落操作'}));fireEvent.click(ui.getByRole('menuitem',{name:'下方插入正文'}))
    act(()=>value.view.dispatch(value.view.state.tr.insertText('新输入')))
    expect(current(value).blocks.map(block=>block.type==='paragraph' ? plainDocumentText(block.content):'')).toEqual(['原段落','新输入','后文'])
  })
  it('CA265 focuses a heading text slot rather than leaving it as a NodeSelection',()=>{
    const {value,ref}=shared([{id:'h',type:'heading',level:2,content:text('新标题')}]);act(()=>value.view.dispatch(value.view.state.tr.setSelection(NodeSelection.create(value.view.state.doc,0))))
    act(()=>{expect(ref.current?.focusBlock('h')).toBe(true);value.view.dispatch(value.view.state.tr.insertText('输入'))})
    expect(current(value).blocks[0]).toMatchObject({type:'heading',content:text('输入新标题')})
  })
  it.each(['paragraph','2'])('CA091 code conversion to %s removes code-only attributes',type=>{
    const {ui,value}=shared([{id:'c',type:'code',language:'mermaid',code:'graph TD'}]);act(()=>select(value,1));fireEvent.click(ui.getByRole('button',{name:'当前段落类型'}));fireEvent.click(ui.getByRole('menuitem',{name:type==='paragraph' ? '正文':`标题 ${type}`}))
    const block=current(value).blocks[0];expect(block.type).toBe(type==='paragraph' ? 'paragraph':'heading');expect(block).not.toHaveProperty('code');expect(block).not.toHaveProperty('language')
  })
  it('CA092 Enter inserts a newline in a single code block',()=>{
    const {value}=editor([{id:'c',type:'code',language:'mermaid',code:'graph TD; A-->B'}]);select(value,6);expect(key(value,'Enter')).toBe(true)
    expect(current(value).blocks).toHaveLength(1);expect(current(value).blocks[0]).toMatchObject({code:'graph\n TD; A-->B'})
  })
  it('CA231 adding a sibling to a nested Markdown item retains Child and Tail depth',()=>{
    const source='- Parent\n  - Child\n',parsed=parseDocumentMarkdown(source,{createId:()=>crypto.randomUUID(),target:'file'});expect(parsed.status).toBe('valid');if(parsed.status!=='valid')return
    let saved='';const {value,diagnostic}=editor(parsed.document.content.blocks,{document:parsed.document,sourceMap:parsed.sourceMap,change:next=>{saved=editMarkdownSource(source,parsed.document,next,parsed.sourceMap,{createId:()=>crypto.randomUUID(),target:'file'})}})
    const pos=at(value,node=>node.type.name==='slot' && node.textContent==='Child');select(value,pos+6);key(value,'Enter');value.view.dispatch(value.view.state.tr.insertText('Tail'))
    const reopened=parseDocumentMarkdown(saved,{createId:()=>crypto.randomUUID(),target:'file'});expect(reopened.status).toBe('valid');if(reopened.status==='valid')expect(reopened.sourceMap.blocks[0].slots.map(slot=>slot.depth)).toEqual([0,1,1]);expect(diagnostic).not.toHaveBeenCalled()
  })
  it('CA264 Backspace cannot merge a visible paragraph into its hidden neighbor',()=>{
    const {value}=editor([para('a','A'),para('hidden','S'),para('b','B')],{hiddenBlockIds:['hidden']});const pos=at(value,node=>node.attrs.id==='b');select(value,pos+1);expect(key(value,'Backspace')).toBe(true)
    expect(current(value).blocks).toEqual([para('a','A'),para('hidden','S'),para('b','B')])
  })
  it.each(['heading','quote'] as const)('CA268 the %s input rule preserves alignment and spacing',kind=>{
    const block={...para('p',kind==='heading' ? '#':'>'),textAlign:'center' as const,lineSpacing:2.5},value=editor([block]).value
    const result=createDocumentInputRuleResult(value.view.state,{kind,level:1,from:0,to:value.view.state.doc.firstChild!.nodeSize,blockId:'p'},()=>crypto.randomUUID());value.view.dispatch(result.transaction)
    expect(current(value).blocks[0]).toMatchObject({type:kind,textAlign:'center',lineSpacing:2.5})
  })
  it('CA281 a Shared-created section contains an editable initial body',()=>{
    const {ui,value}=shared([para('p','old')]);act(()=>select(value,1));fireEvent.click(ui.getByRole('button',{name:'段落操作'}));fireEvent.click(ui.getByRole('menuitem',{name:'下方插入折叠节'}));act(()=>value.view.dispatch(value.view.state.tr.insertText('节内正文')))
    expect(current(value).blocks[1]).toMatchObject({type:'section',title:{inlines:[]},blocks:[{type:'paragraph',content:text('节内正文')}]})
  })
  it('CA348 software-default left alignment keeps list and code conversion enabled',()=>{
    const content={blocks:[{...para('p','AB'),textAlign:'left' as const}]},menu=documentBlockMenu({content,blockId:'p',apply(){}})
    for(const id of ['convert-list','convert-code'])expect(menu.find(item=>item.id===id)?.disabledReason).toBeUndefined()
  })
  it('CA352 Markdown ordered lists retain 5/6 in formal semantics and the file layout',()=>{
    const parsed=parseDocumentMarkdown('5. 五\n6. 六\n',{createId:()=>crypto.randomUUID(),target:'flow'});expect(parsed.status).toBe('valid');if(parsed.status!=='valid')return
    expect(parsed.document.content.blocks[0]).toMatchObject({type:'list',ordered:true,start:5});expect(serializeDocumentMarkdown(parsed.document,'flow')).toContain('5.')
    const {value}=editor(parsed.document.content.blocks);expect((value.view.dom.querySelector('ol') as HTMLOListElement).start).toBe(5)
  })
  it('CA231/352 a new nested ordered sibling increments only its own level',()=>{
    const source='5. Parent\n   1. Child\n6. Sibling\n',parsed=parseDocumentMarkdown(source,{createId:()=>crypto.randomUUID(),target:'file'});if(parsed.status!=='valid')throw new Error('fixture')
    const after=structuredClone(parsed.document),block=after.content.blocks[0];if(block.type!=='list')throw new Error('fixture')
    block.items.splice(2,0,{id:'tail',content:text('Tail')})
    const saved=editMarkdownSource(source,parsed.document,after,parsed.sourceMap,{createId:()=>crypto.randomUUID(),target:'file'})
    expect(saved).toContain('5. Parent\n   1. Child\n   2. Tail\n6. Sibling')
    const reopened=parseDocumentMarkdown(saved,{createId:()=>crypto.randomUUID(),target:'file'});if(reopened.status!=='valid')throw new Error('reopen')
    expect(reopened.sourceMap.blocks[0].slots.map(slot=>[slot.depth,slot.ordinal])).toEqual([[0,5],[1,1],[1,2],[0,6]])
  })
  it('CA355 a heading ShiftEnter saves and reparses as the same one heading',()=>{
    const source='# AB',parsed=parseDocumentMarkdown(source,{createId:()=>crypto.randomUUID(),target:'file'});if(parsed.status!=='valid')throw new Error('fixture')
    let saved='';const {value,diagnostic}=editor(parsed.document.content.blocks,{document:parsed.document,change:next=>{saved=editMarkdownSource(source,parsed.document,next,parsed.sourceMap,{createId:()=>crypto.randomUUID(),target:'file'})}})
    select(value,2);key(value,'Enter',true);expect(value.flush()).toBe(true);expect(diagnostic).not.toHaveBeenCalled()
    const reopened=parseDocumentMarkdown(saved,{createId:()=>crypto.randomUUID(),target:'file'});expect(reopened.status).toBe('valid');if(reopened.status==='valid')expect(reopened.document.content.blocks).toEqual([{id:parsed.document.content.blocks[0].id,type:'heading',level:1,content:text('A\nB')}])
  })
  it('CA360 applying an existing link at its caret only changes the mark',()=>{
    const {ui,value}=shared([{id:'p',type:'paragraph',content:{inlines:[{type:'text',text:'课程',link:{href:'https://old.example'}}]}}]);act(()=>select(value,2));fireEvent.click(ui.getByRole('button',{name:'当前选区链接'}));fireEvent.click(ui.getByRole('button',{name:'应用链接'}))
    expect(current(value).blocks[0]).toMatchObject({content:{inlines:[{text:'课程',link:{href:'https://old.example'}}]}})
  })
  it('keeps the original link range while its dialog is open and surrounding text changes',()=>{
    const {ui,value}=shared([para('p','前课程后')]);act(()=>select(value,2,4))
    fireEvent.click(ui.getByRole('button',{name:'当前选区链接'}))
    act(()=>{const inserted=value.view.state.tr.insertText('新增',1);value.view.dispatch(inserted.setSelection(TextSelection.create(inserted.doc,inserted.doc.content.size-1)))})
    fireEvent.change(ui.getByRole('textbox',{name:'链接地址'}),{target:{value:'https://example.com'}})
    fireEvent.click(ui.getByRole('button',{name:'应用链接'}))
    expect(current(value).blocks[0]).toMatchObject({content:{inlines:[{text:'新增前'},{text:'课程',link:{href:'https://example.com'}},{text:'后'}]}})
  })
  it('keeps quote conversion reachable through the existing block menu without discarding its citation',()=>{
    const quote:DocumentBlock={id:'q',type:'quote',content:text('引文'),citation:text('出处')}
    const {ui,value,change}=shared([quote]);act(()=>select(value,2))
    fireEvent.click(ui.getByRole('button',{name:'段落操作'}))
    const convert=ui.getByRole('menuitem',{name:'转换为正文'})
    expect(convert).toHaveAttribute('aria-disabled','true');expect(convert).toHaveAttribute('title','带出处的引用不能直接转换')
    fireEvent.click(convert)
    expect(current(value).blocks).toEqual([quote]);expect(change).not.toHaveBeenCalled()
  })
})
describe('R29 and R30 math and file presentation',()=>{
  it.each([' '+ 'id'.repeat(130)+' ', ' '])('CA128 Markdown semantic IDs preserve every V10-supported nonempty value',id=>{
    const original=documentOf([para(id,'valid')]);expect(documentContentSchema.parse(original.content)).toEqual(original.content)
    const parsed=parseDocumentMarkdown(serializeDocumentMarkdown(original,'file'),{createId:()=>crypto.randomUUID(),target:'file'});expect(parsed.status).toBe('valid');if(parsed.status==='valid')expect(parsed.document.content.blocks[0].id).toBe(id)
  })
  it('CA014 changing LaTeX preserves the current 40px red style and link in data and view',()=>{
    const {ui,value}=shared([{id:'p',type:'paragraph',content:{inlines:[formula]}}]);act(()=>{const tr=value.view.state.tr.addMark(1,2,schema.marks.style.create({value:{fontSize:40,color:'#ff0000'}})).addMark(1,2,schema.marks.link.create({href:'https://example.com'}));value.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc,1)))})
    fireEvent.click(ui.getByRole('button',{name:'当前选区公式'}));fireEvent.change(ui.getByRole('textbox',{name:'公式 LaTeX'}),{target:{value:'x^3'}});fireEvent.click(ui.getByRole('button',{name:'应用公式'}))
    expect(current(value).blocks[0]).toMatchObject({content:{inlines:[{latex:'x^3',style:{fontSize:40,color:'#ff0000'},link:{href:'https://example.com'}}]}})
    expect(value.view.dom.querySelector<HTMLElement>('[data-formula-id="math"] [data-formula-id="math"]')?.style.fontSize).toBe('40px')
  })
  it('CA347 table cell defaults appear pressed and the first toolbar click sets bold false',()=>{
    const defaults=vi.fn((_blockId:string,point:any)=>point?.slot.kind==='cell' ? {bold:true}:undefined),{ui,value}=shared([table()],{inlineStyleDefaults:defaults}),pos=at(value,node=>node.type.name==='slot' && node.attrs.key==='cell:["r1","a"]')
    act(()=>select(value,pos+1,pos+2));expect(ui.getByRole('button',{name:'加粗'})).toHaveAttribute('aria-pressed','true');fireEvent.click(ui.getByRole('button',{name:'加粗'}))
    expect((current(value).blocks[0] as ReturnType<typeof table>).rows[0].cells.a.inlines[0]).toMatchObject({text:'A',style:{bold:false}});expect(defaults.mock.calls.some(([_id,point])=>point?.slot.kind==='cell' && point.slot.rowId==='r1' && point.slot.columnId==='a')).toBe(true)
  })
  it('CA014 current marks own math style/link, including their removal',()=>{
    const {value}=editor([{id:'p',type:'paragraph',content:{inlines:[formula]}}]);value.view.dispatch(value.view.state.tr.addMark(1,2,schema.marks.style.create({value:{fontSize:40,color:'#ff0000'}})).addMark(1,2,schema.marks.link.create({href:'https://example.com'})))
    expect(current(value).blocks[0]).toMatchObject({content:{inlines:[{style:{fontSize:40,color:'#ff0000'},link:{href:'https://example.com'}}]}})
    value.view.dispatch(value.view.state.tr.removeMark(1,2));const block=current(value).blocks[0] as Extract<DocumentBlock,{type:'paragraph'}>;expect(block.content.inlines[0]).not.toHaveProperty('style');expect(block.content.inlines[0]).not.toHaveProperty('link')
  })
  it.each([' x ','x ',' x','x\n+ y'])('CA094 inline LaTeX %j round trips in its lossless carrier',latex=>{
    const original=documentOf([{id:'p',type:'paragraph',content:{inlines:[{...formula,latex}]}}]),source=serializeDocumentMarkdown(original,'file'),parsed=parseDocumentMarkdown(source,{createId:()=>crypto.randomUUID(),target:'file'})
    expect(parsed.status).toBe('valid');if(parsed.status==='valid')expect(parsed.document.content).toEqual(original.content)
  })
  it('CA095 formally accepted 50% renders without a strict KaTeX failure',()=>{
    const parsed=parseDocumentMarkdown('收益 $50%$ 与常数',{createId:()=>crypto.randomUUID(),target:'flow'});expect(parsed.status).toBe('valid');expect(()=>renderDocumentMath('50%')).not.toThrow();expect(renderDocumentMath('50%')).toContain('%')
  })
  it('CA119 ShiftEnter cannot turn a restricted formula into a paragraph',()=>{
    const block:DocumentBlock={id:'f',type:'formula',formulaId:'fmath',latex:'x',accessibleText:'x'},value=editor([block],{contentScope:'formula'}).value
    value.view.dispatch(value.view.state.tr.setSelection(NodeSelection.create(value.view.state.doc,0)));expect(key(value,'Enter',true)).toBe(true);expect(current(value).blocks).toEqual([block])
  })
  it('CA327 file formula layout consumes saved font size and color',()=>{
    const {value}=editor([{id:'f',type:'formula',formulaId:'fmath',latex:'x',accessibleText:'x',style:{fontSize:100,color:'#ff0000'}}]);expect(value.view.dom.querySelector<HTMLElement>('.document-math')?.style.fontSize).toBe('100px');expect(value.view.dom.querySelector<HTMLElement>('.document-math')?.style.color).toBe('rgb(255, 0, 0)')
  })
  it.each(['**','*','~~'])('CA333 %s around text and math keeps text marks without unsupported math marks',marker=>{
    const parsed=parseDocumentMarkdown(`${marker}结论 $x^2$ 成立${marker}`,{createId:()=>crypto.randomUUID(),target:'file'});expect(parsed.status).toBe('valid');if(parsed.status==='valid'){const block=parsed.document.content.blocks[0] as Extract<DocumentBlock,{type:'paragraph'}>;expect(block.content.inlines.find(inline=>inline.type==='math')).not.toHaveProperty('style');expect(block.content.inlines[0]).toHaveProperty('style')}
  })
  it.each(['paragraph','heading','quote'] as const)('CA188 %s alignment/spacing save and file layout use the same metadata',type=>{
    const before=documentOf([type==='heading' ? {id:'p',type,level:2,content:text('AB')}:{id:'p',type,content:text('AB')}]),source=serializeDocumentMarkdown(before,'file'),parsed=parseDocumentMarkdown(source,{createId:()=>crypto.randomUUID(),target:'file'});if(parsed.status!=='valid')throw new Error('fixture')
    const after=documentOf([{...before.content.blocks[0],textAlign:'center',lineSpacing:2.5} as DocumentBlock]),saved=editMarkdownSource(source,parsed.document,after,parsed.sourceMap,{createId:()=>crypto.randomUUID(),target:'file'}),reopened=parseDocumentMarkdown(saved,{createId:()=>crypto.randomUUID(),target:'file'})
    expect(reopened.status).toBe('valid');if(reopened.status==='valid'){expect(reopened.document.content.blocks[0]).toMatchObject({textAlign:'center',lineSpacing:2.5});const {value}=editor(reopened.document.content.blocks);expect(value.view.dom.firstElementChild?.getAttribute('style')).toContain('text-align: center')}
  })
})
