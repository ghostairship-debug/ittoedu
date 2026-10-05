import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ComponentPropertiesEditor } from '../../src/renderer/ui/ComponentPropertiesEditor'
import { PropertyDraftBoundary, flushPropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import type { ComponentDefinition, ComponentInstance, JsonValue } from '../../src/shared/contracts/component-platform/project'
import { ImageProperties, type PropertiesImageView } from '../../src/renderer/ui/properties/SlideNativePropertiesPanel'
import { componentPropertiesEdits, componentPropertiesView } from '../../src/renderer/ui/properties/componentProperties'
import { createImageData, IMAGE_DEFINITION } from '../../src/components/image'

afterEach(cleanup)
const definition: ComponentDefinition = { id: 'professional', role: 'content', implementation: { kind: 'source', language: 'javascript', source: '' },
  dataSchema: { type: 'object', properties: {
    title: { type: 'string', title: '标题', default: '默认标题', maxLength: 12 },
    count: { type: 'number', title: '数量', minimum: 1, maximum: 8, multipleOf: .5 },
    enabled: { type: 'boolean', title: '启用' },
    layout: { type: 'string', title: '布局', oneOf: [{ const: 'story', title: '故事' }, { const: 'quiz', title: '测验' }] },
    nested: { type: 'object', title: '内容', properties: { image: { type: 'string', title: '图片', format: 'image' } } },
    color: { type: 'string', title: '颜色', format: 'color' },
  } } }
function Form({ commit, preview }: { commit: (data: JsonValue) => void; preview?: (data: JsonValue | null) => void }) {
  const [data, setData] = useState<JsonValue>({})
  return <PropertyDraftBoundary bindingKey="doc:epoch:instance" onStale={()=>{}}>
    <ComponentPropertiesEditor definition={definition} node={{ id: 'instance', definitionId: definition.id, data }}
      assets={{ cover: { id: 'cover', path: 'assets/cover.png', mimeType: 'image/png', filename: '封面.png' }, sound: { id: 'sound', path: 'sound.mp3', mimeType: 'audio/mpeg' } }}
      onChange={next => { commit(next); setData(next) }} onPreview={preview} />
  </PropertyDraftBoundary>
}
it('P0 renders absent professional schema fields without persisting defaults and edits enum/image/bounds', async () => {
  const commit = vi.fn(); render(<Form commit={commit} />)
  expect(screen.getByLabelText('标题')).toHaveValue('默认标题')
  expect(screen.getByLabelText('标题')).toHaveAttribute('maxlength', '12')
  const count = screen.getByLabelText('数量')
  expect(count).toHaveAttribute('min','1'); expect(count).toHaveAttribute('max','8'); expect(count).toHaveAttribute('step','0.5')
  expect(commit).not.toHaveBeenCalled()
  expect(screen.getByRole('combobox', {name:'内容 · 图片'})).toHaveTextContent('封面.png')
  expect(screen.getByRole('combobox', {name:'内容 · 图片'})).not.toHaveTextContent('sound.mp3')
  fireEvent.change(screen.getByLabelText('布局'), {target:{value:'quiz'}})
  fireEvent.change(screen.getByLabelText('内容 · 图片'), {target:{value:'cover'}})
  fireEvent.click(screen.getByLabelText('启用'))
  fireEvent.focus(count); fireEvent.change(count,{target:{value:'12'}}); fireEvent.blur(count)
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(true))
  expect(commit.mock.lastCall?.[0]).toEqual({layout:'quiz',nested:{image:'cover'},enabled:true,count:8})
})
it('P0 commits a completed color gesture once instead of every native preview input', () => {
  const commit=vi.fn(),preview=vi.fn(); render(<Form commit={commit} preview={preview}/>)
  const picker=screen.getByLabelText('颜色选择器')
  fireEvent.input(picker,{target:{value:'#123456'}}); fireEvent.input(picker,{target:{value:'#234567'}})
  expect(commit).not.toHaveBeenCalled()
  expect(preview.mock.calls).toEqual([[{color:'#123456'}],[{color:'#234567'}]])
  fireEvent.change(picker,{target:{value:'#234567'}})
  expect(commit).toHaveBeenCalledExactlyOnceWith({color:'#234567'})
  expect(preview.mock.lastCall).toEqual([null])
})
it('P0 buffers custom schema text through IME/save and refuses to retarget an unfinished draft',async()=>{
  const first=vi.fn(), second=vi.fn()
  const node:ComponentInstance={id:'first',definitionId:definition.id,data:{title:'旧标题'}}
  const view=(key:string,instance:ComponentInstance,commit:typeof first)=><PropertyDraftBoundary bindingKey={key} onStale={()=>{}}>
    <ComponentPropertiesEditor definition={definition} node={instance} onChange={commit}/>
  </PropertyDraftBoundary>
  const {rerender}=render(view('first',node,first))
  const title=screen.getByLabelText('标题'); fireEvent.focus(title); fireEvent.compositionStart(title);fireEvent.change(title,{target:{value:'  中文输入  '}})
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(false));expect(first).not.toHaveBeenCalled()
  fireEvent.compositionEnd(title)
  rerender(view('second',{...node,id:'second',data:{title:'邻居'}},second))
  await act(async()=>expect(await flushPropertiesDrafts()).toBe(false))
  expect(first).not.toHaveBeenCalled();expect(second).not.toHaveBeenCalled();expect(title).toHaveValue('  中文输入  ')
  fireEvent.keyDown(title,{key:'Escape'});expect(title).toHaveValue('邻居')
})
it('P0 reads definition pages/variants/presets from one saved metadata object and preserves unrelated data',()=>{
  const commit=vi.fn()
  const customized:ComponentDefinition={...definition,dataSchema:{...definition.dataSchema,'x-editor':{
    pages:[{id:'main',label:'主页',propertyKeys:['title','count','nested']},{id:'detail',label:'详情',propertyKeys:['layout']}],
    defaultPageId:'main',previewPageProp:'editor.previewPageId',
    variants:[{id:'quiz',label:'测验版',data:{layout:'quiz'}}],
    presets:[{id:'ready',label:'即用',data:{nested:{image:'cover'},title:'预设标题'}}],
  }}}
  function Pages(){const [data,setData]=useState<JsonValue>({title:'原标题',nested:{note:'人工备注'},retained:42})
    return <ComponentPropertiesEditor definition={customized} node={{id:'pages',definitionId:customized.id,data}}
      onChange={next=>{commit(next);setData(next)}}/>}
  render(<Pages/>);expect(screen.getByLabelText('标题')).toBeInTheDocument();expect(screen.queryByLabelText('布局')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('组件变体'),{target:{value:'quiz'}})
  fireEvent.change(screen.getByLabelText('应用组件预设'),{target:{value:'ready'}})
  expect(commit.mock.lastCall?.[0]).toEqual({title:'预设标题',nested:{note:'人工备注',image:'cover'},retained:42,layout:'quiz'})
  fireEvent.change(screen.getByLabelText('编辑预览页面'),{target:{value:'detail'}})
  expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();expect(screen.queryByLabelText('内容 · 图片')).not.toBeInTheDocument()
  expect(screen.getByLabelText('布局')).toHaveValue('quiz')
  expect(commit.mock.lastCall?.[0]).toMatchObject({editor:{previewPageId:'detail'},retained:42,nested:{note:'人工备注'}})
})
it('P0 image controls restore retained original source and patch display filters without replacing frame or guides',()=>{
  const data=createImageData('original');data.assetId='derived';data.crop.left=.2
  data.safeAreas=[{id:'guide',label:'人工安全区',x:.1,y:.1,width:.8,height:.8}]
  const frame={width:220,height:90,transform:[1,.2,.3,1,35,42] as [number,number,number,number,number,number]}
  const instance:ComponentInstance={id:'image',definitionId:IMAGE_DEFINITION.id,data,frame}
  const patch=vi.fn()
  const view=componentPropertiesView(instance,IMAGE_DEFINITION) as PropertiesImageView
  render(<ImageProperties node={view} update={patch} onReplaceImage={()=>{}}/>)
  fireEvent.click(screen.getByRole('button',{name:'恢复原图'}))
  const edits=componentPropertiesEdits(instance,IMAGE_DEFINITION,patch.mock.lastCall![0])
  expect(edits).toEqual(expect.arrayContaining([{type:'data.set',instanceId:'image',path:['assetId'],value:'original'},
    {type:'data.set',instanceId:'image',path:['crop','left'],value:0}]))
  expect(edits.some(edit=>edit.type==='frame.set')).toBe(false)
  expect(edits.some(edit=>edit.type==='data.set'&&(edit.path.includes('originalAssetId')||edit.path.includes('safeAreas')))).toBe(false)
  expect(screen.getByLabelText('亮度')).toBeInTheDocument();expect(screen.getByLabelText('灰度')).toBeInTheDocument()
})
