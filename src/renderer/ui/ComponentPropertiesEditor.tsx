import { useEffect, useRef, useState } from 'react'
import { BufferedInput, usePropertyDraftBindingKey, usePropertyDraftFlush } from './properties/PropertyControls'
import { SlidersHorizontal } from 'lucide-react'
import type { ComponentAsset, ComponentDefinition, ComponentInstance, JsonValue } from '../../shared/contracts/component-platform/project'
import { componentDefinitionPresentation, componentFieldPresentation, componentEditorPresentation } from './properties/componentDefinitionPresentation'
import { ColorInput } from './ColorInput'
export interface ComponentPropertiesEditorProps {
  definition: ComponentDefinition
  node: ComponentInstance
  assets?: Readonly<Record<string, ComponentAsset>>
  onChange(nextData: JsonValue): void | Promise<void>
  onPreview?(nextData: JsonValue | null): void
  title?: string
  groups?: readonly {title:string;matches(key:string):boolean}[]
}
function StructuredField({label,value,onChange,structured=true,maxLength,placeholder}:{label:string;value:JsonValue;onChange(value:JsonValue):void|Promise<void>;structured?:boolean;maxLength?:number;placeholder?:string}){
  const source=()=>structured?JSON.stringify(value,null,2):String(value??'')
  const bindingKey=usePropertyDraftBindingKey(),[draft,setDraft]=useState(source),[error,setError]=useState('')
  const session=useRef<{key:string;dirty:boolean;composing:boolean;blurPending:boolean;serial:number;pending?:Promise<boolean>;commit:(value:JsonValue)=>void|Promise<void>}>({key:bindingKey,dirty:false,composing:false,blurPending:false,serial:0,commit:onChange})
  const fresh=()=>({key:bindingKey,dirty:false,composing:false,blurPending:false,serial:0,commit:onChange})
  useEffect(()=>{if(!session.current.dirty){setDraft(source());setError('');session.current=fresh()}else if(session.current.key===bindingKey)session.current.commit=onChange},[value,bindingKey,onChange])
  const reset=()=>{session.current=fresh();setDraft(source());setError('')}
  const commit=(candidate=draft):boolean|Promise<boolean>=>{
    if(session.current.pending)return session.current.pending
    if(!session.current.dirty)return true
    if(session.current.composing)return false
    if(session.current.key!==bindingKey){setError('编辑目标已改变；输入保留，请按 Esc 放弃后重试。');return false}
    let parsed:JsonValue
    try{parsed=structured?JSON.parse(candidate) as JsonValue:candidate}catch{setError('请输入有效的 JSON；输入保留，尚未改写工程。');return false}
    const owner=session.current,serial=owner.serial
    const finish=()=>{if(session.current===owner){if(owner.serial===serial&&!owner.composing&&!owner.blurPending)owner.dirty=false;setError('');return !owner.dirty}return true}
    const fail=(error:unknown)=>{if(session.current===owner)setError(error instanceof Error?error.message:String(error));return false}
    try{
      const result=owner.commit(parsed)
      if(!result)return finish()
      const pending=Promise.resolve(result).then(()=>{owner.pending=undefined;return finish()},error=>{owner.pending=undefined;return fail(error)})
      owner.pending=pending
      return pending
    }catch(error){return fail(error)}
  }
  usePropertyDraftFlush(()=>commit())
  return <><textarea aria-label={label} rows={structured?5:draft.includes('\n')?4:2} maxLength={maxLength} placeholder={placeholder} value={draft} onFocus={()=>{if(!session.current.dirty)session.current=fresh()}} onChange={event=>{session.current.dirty=true;session.current.serial++;setDraft(event.currentTarget.value)}} onBlur={()=>{if(session.current.composing)session.current.blurPending=true;else commit()}} onCompositionStart={()=>{session.current.composing=true}} onCompositionEnd={event=>{session.current.composing=false;if(session.current.blurPending){session.current.blurPending=false;commit(event.currentTarget.value)}}} onKeyDown={event=>{if(event.key==='Escape'&&!session.current.composing)reset()}}/>{error&&<small role="alert" className="component-property-description">{error}</small>}</>
}
/** The original properties panel now edits the definition's formal author data. */
export function ComponentPropertiesEditor({definition,node,assets={},onChange,onPreview,title,groups}:ComponentPropertiesEditorProps){
  const data=node.data
  const editor=componentEditorPresentation(definition)
  const [previewPage,setPreviewPage]=useState<string|undefined>()
  useEffect(()=>{setPreviewPage(undefined)},[node.id,definition.id])
  const pagePath=editor.previewPageProp?.split('.')
  const persistedPage=pagePath?.reduce<JsonValue|undefined>((value,key)=>value&&typeof value==='object'&&!Array.isArray(value)?value[key]:undefined,data)
  const activePage=editor.pages?.find(page=>page.id===(typeof persistedPage==='string'?persistedPage:previewPage??editor.defaultPageId))??editor.pages?.[0]
  type Field = { path: string[]; value: JsonValue | undefined }
  const fieldKeys=(path:string[],value:Record<string,JsonValue>)=>[...new Set([...Object.keys(value),
    ...Object.keys(componentFieldPresentation(definition,path).properties)])]
  const collect=(path:string[],value:JsonValue|undefined):Field[]=>{
    const metadata=componentFieldPresentation(definition,path)
    if((value===undefined||(value&&typeof value==='object'&&!Array.isArray(value)))&&Object.keys(metadata.properties).length){
      const children=value as Record<string,JsonValue>|undefined
      const keys=fieldKeys(path,children??{})
      if(keys.length)return keys.flatMap(key=>collect([...path,key],children?.[key]))
    }
    return [{path,value}]
  }
  const pageKeys=editor.pages?.flatMap(page=>page.propertyKeys)??[]
  const includesField=(keys:readonly string[],path:string)=>keys.some(key=>path===key||path.startsWith(`${key}.`))
  const fields=(data&&typeof data==='object'&&!Array.isArray(data)?fieldKeys([],data).flatMap(key=>collect([key],data[key])):[])
    .filter(field=>!activePage||!includesField(pageKeys,field.path.join('.'))||includesField(activePage.propertyKeys,field.path.join('.')))
  const updatedData=(path:string[],value:JsonValue|undefined)=>{
    const next=structuredClone(data) as Record<string,JsonValue>
    let parent=next
    for(const key of path.slice(0,-1)){
      if(!parent[key]||typeof parent[key]!=='object'||Array.isArray(parent[key]))parent[key]={}
      parent=parent[key] as Record<string,JsonValue>
    }
    if(value===undefined)delete parent[path[path.length-1]]
    else parent[path[path.length-1]]=value
    return next
  }
  const update=(path:string[],value:JsonValue|undefined)=>onChange(updatedData(path,value))
  const render=({path,value}:Field)=>{
    const metadata=componentFieldPresentation(definition,path)
    const displayed=value===undefined?metadata.defaultValue:value
    const label=path.map((_,index)=>componentFieldPresentation(definition,path.slice(0,index+1)).label).join(' · ')
    const change=(next:JsonValue|undefined)=>update(path,next)
    return <div className={`property-row${typeof value==='boolean'?' property-row--checkbox':''}`} key={path.join('.')}><span>{label}</span>{
      metadata.image?<select aria-label={label} value={typeof displayed==='string'?displayed:''} onChange={event=>change(event.currentTarget.value||undefined)}>
        <option value="">未选择工程图片</option>
        {typeof displayed==='string'&&displayed&&!assets[displayed]&&<option value={displayed}>{displayed}（资源未找到）</option>}
        {Object.values(assets).filter(asset=>asset.kind==='image'||asset.mimeType?.startsWith('image/')).sort((a,b)=>(a.filename??a.path).localeCompare(b.filename??b.path,'zh-CN')).map(asset=><option key={asset.id} value={asset.id}>{asset.filename??asset.path.split(/[\\/]/u).at(-1)??asset.id}</option>)}
      </select>
      :metadata.color?<ColorInput id={`component-${node.id}-${path.join('.')}`} label={label} value={typeof displayed==='string'?displayed:''} onChange={change}
        onPreviewChange={onPreview?color=>onPreview(color===null?null:updatedData(path,color)):undefined}/>
      :typeof displayed==='boolean'||metadata.type==='boolean'?<input aria-label={label} type="checkbox" checked={displayed===true} onChange={event=>change(event.currentTarget.checked)}/>
      :typeof displayed==='number'||metadata.type==='number'||metadata.type==='integer'?<BufferedInput label={label} type="number" value={typeof displayed==='number'?displayed:''} min={metadata.minimum} max={metadata.maximum} step={metadata.step??(metadata.type==='integer'?1:undefined)}
        onCommit={next=>{const number=Number(next);if(Number.isFinite(number))return change(number)}}/>
      :metadata.choices.length?<select aria-label={label} value={typeof displayed==='string'?displayed:''} onChange={event=>change(event.currentTarget.value||undefined)}>
        {displayed===undefined&&<option value="">未选择</option>}
        {typeof displayed==='string'&&!metadata.choices.some(option=>option.value===displayed)&&<option value={displayed}>{displayed}</option>}
        {metadata.choices.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      :typeof displayed==='string'||metadata.type==='string'?<StructuredField label={label} value={typeof displayed==='string'?displayed:''} structured={false} maxLength={metadata.maxLength} placeholder={metadata.placeholder} onChange={change}/>
      :displayed===undefined?<BufferedInput label={label} value="" placeholder={metadata.placeholder??'未设置'} allowEmpty onCommit={next=>change(next||undefined)}/>
      :<StructuredField label={label} value={displayed} onChange={change}/>
    }{metadata.color&&metadata.optional&&value!==undefined&&<button type="button" aria-label={`${label}使用默认颜色`} onClick={()=>change(undefined)}>使用默认颜色</button>}
    {metadata.description&&<small className="component-property-description">{metadata.description}</small>}</div>
  }
  const merge=(base:JsonValue,patch:JsonValue):JsonValue=>{
    if(!base||typeof base!=='object'||Array.isArray(base)||!patch||typeof patch!=='object'||Array.isArray(patch))return structuredClone(patch)
    const result={...base};for(const [key,value] of Object.entries(patch))result[key]=merge(result[key]??null,value)
    return result
  }
  return <section className="component-properties-editor"><div className="section-heading"><SlidersHorizontal size={16}/><span>{title??`${componentDefinitionPresentation(definition).title}参数`}</span></div>
  {Boolean(editor.pages?.length)&&<label className="property-row"><span>编辑预览页面</span><select aria-label="编辑预览页面" value={activePage?.id??''} onChange={event=>{const id=event.currentTarget.value;setPreviewPage(id);if(pagePath?.length)update(pagePath,id)}}>
    {editor.pages?.map(page=><option key={page.id} value={page.id}>{page.label}</option>)}
  </select></label>}
  {(['variants','presets'] as const).map(kind=>editor[kind]?.length?<label className="property-row" key={kind}><span>{kind==='variants'?'组件变体':'应用组件预设'}</span><select aria-label={kind==='variants'?'组件变体':'应用组件预设'} value="" onChange={event=>{const option=editor[kind]?.find(item=>item.id===event.currentTarget.value);if(option)onChange(merge(data,option.data))}}>
    <option value="">{kind==='variants'?'选择变体':'选择预设'}</option>{editor[kind]?.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
  </select></label>:null)}
  {fields.length?(groups??[{title:'',matches:()=>true}]).map((group,index,all)=>{
    const grouped=fields.filter(field=>group.matches(field.path.join('.'))&&!all.slice(0,index).some(prior=>prior.matches(field.path.join('.'))))
    return grouped.length?<div className="controller-property-group" key={group.title}>{group.title&&<h4>{group.title}</h4>}{grouped.map(render)}</div>:null
  }):<label className="property-row"><span>组件数据</span><StructuredField label="组件数据" value={data} onChange={onChange}/></label>}</section>
}
