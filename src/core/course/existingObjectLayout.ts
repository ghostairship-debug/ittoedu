import {parse,serialize,type DefaultTreeAdapterTypes as Tree} from 'parse5'
import {componentDefinitionBuiltinKey,componentIsLocked,componentContainerForInstance,owningContainer,type CourseProjectV10,type ComponentInstance} from '../../shared/contracts/component-platform/project'
import type {DocumentResources} from '../../shared/workbench/document'
import type {ComponentEdit,ComponentOperationBatch} from '../../shared/contracts/component-platform/operations'
import {textComponentDataSchema,formulaComponentDataSchema} from '../../components/text/data'
import {textComponentHtml,formulaComponentHtml} from '../../components/text/render'
import {composeMatrices,invertMatrix,scaleMatrix,IDENTITY_MATRIX,type AffineFrame,type AffineMatrix} from '../components/geometry'
import {captureComponentOperation,componentValueAt} from '../drivers/courseV10Operations'
import {equalComponentValue} from '../../shared/componentValue'
import {groupCompositeBoundary} from './courseGroupDecoration'
export interface ExistingLayoutSlot {key:string;html:string;style:Record<string,string>;width:number;height:number;kind:'text'|'bounded';autoHeight:boolean}
export interface ExistingLayoutRequest {html:string;viewport:{width:number;height:number};slots:ExistingLayoutSlot[];resourceUrls:Record<string,string>;reads:string[][];geometryReads:string[][];surfaceId:string;ids:string[]}
export interface ExistingLayoutMeasurement {key:string;frame:AffineFrame;order:number}
const element=(node:Tree.Node):node is Tree.Element=>'tagName'in node
const attribute=(node:Tree.Element,name:string)=>node.attrs.find(attr=>attr.name===name)?.value
const same=(a:unknown,b:unknown)=>equalComponentValue(a as any,b as any)
function world(project:CourseProjectV10,id:string,scope:string,seen=new Set<string>()):AffineMatrix {
 if(id===scope)return IDENTITY_MATRIX
 if(seen.has(id))throw new Error('布局对象层级循环');seen.add(id)
 const instance=project.instances[id],owner=owningContainer(project,id)
 if(!instance||!owner)throw new Error('布局对象已经不存在')
 const parent=owner.kind==='instance'?world(project,owner.instanceId,scope,seen):IDENTITY_MATRIX
 return composeMatrices(parent,instance.frame?.transform??IDENTITY_MATRIX)
}
const parentMatrix=(project:CourseProjectV10,id:string,scope:string)=>{const owner=owningContainer(project,id);return owner?.kind==='instance'?world(project,owner.instanceId,scope):IDENTITY_MATRIX}
/** Temporary CSS owns geometry only. Current formal content is injected into isolated measurement slots by software. */
export function prepareExistingObjectLayout(project:CourseProjectV10,resources:DocumentResources,ids:readonly string[],html:string,viewport?:{width:number;height:number}):ExistingLayoutRequest {
 if(!ids.length||new Set(ids).size!==ids.length)throw new Error('布局引用必须非空且不重复')
 const selected=new Set(ids),scope=componentContainerForInstance(project,ids[0]!)
 if(!scope||!['slide','spatial'].includes(scope.kind))throw new Error('此临时自由布局用于Slides/Spatial；Flow正文沿持续排版能力处理')
 const geometryReads:string[][]=[],reads:string[][]=[],slots:ExistingLayoutSlot[]=[]
 for(const [index,id]of ids.entries()){
  const instance=project.instances[id]
  if(!instance?.frame||instance.container||componentIsLocked(project,id)||componentContainerForInstance(project,id)?.id!==scope.id)throw new Error('布局需要同一表面内可写的自由对象：'+id)
  const implementation=instance.implementationOverride??project.definitions[instance.definitionId]?.implementation,key=componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  let currentId=id,owner=owningContainer(project,id),visited=new Set<string>()
  for(;;){
   if(!owner||owner.kind==='project')throw new Error('对象布局父级无法定位')
   geometryReads.push(['@owner',currentId])
   if(owner.kind!=='instance'||owner.instanceId===scope.id)break
   if(visited.has(owner.instanceId))throw new Error('对象层级循环');visited.add(owner.instanceId)
   const parent=project.instances[owner.instanceId]
   if(selected.has(parent.id))throw new Error('父组与其成员请择一重排，避免重复变换')
   if(!parent.frame||groupCompositeBoundary(parent)||/^(inline-)?(flex|grid)$/.test(String(parent.style?.display??'')))throw new Error('此父级仍承担持续布局或共同合成，请对整个组件重排：'+parent.id)
   geometryReads.push(['instances',parent.id,'frame'],['instances',parent.id,'childIds'],['instances',parent.id,'style'])
   currentId=parent.id;owner=owningContainer(project,currentId)
  }
  geometryReads.push(['instances',id,'frame'],['instances',id,'childIds'],['instances',id,'locked'],['instances',id,'flowLayout'],['instances',id,'flowPlacement'])
  reads.push(['instances',id,'definitionId'],['instances',id,'style'])
  const style=Object.fromEntries(Object.entries(instance.style??{}).filter(([,value])=>typeof value==='string'||typeof value==='number').map(([name,value])=>[name,String(value)]))
  let markup='',kind:ExistingLayoutSlot['kind']='bounded',autoHeight=false
  if(implementation?.kind==='builtin'&&key==='guoling.text'){
   const data=textComponentDataSchema.parse(instance.data);markup=textComponentHtml(data);kind='text';autoHeight=data.sizing.mode==='grow-height'&&data.appearance.writingMode==='horizontal'
   reads.push(['instances',id,'data'],['definitions',instance.definitionId])
  }else if(implementation?.kind==='builtin'&&key==='guoling.formula'){
   markup=formulaComponentHtml(formulaComponentDataSchema.parse(instance.data));kind='text';reads.push(['instances',id,'data'],['definitions',instance.definitionId])
  }
  slots.push({key:String(index),html:markup,style,width:instance.frame.width,height:instance.frame.height,kind,autoHeight})
 }
 // Width/typography must use the current effective tokens, while unrelated data edits remain mergeable.
 reads.push(['theme'],['design'])
 const tree=parse(html),found=new Set<string>()
 const scan=(node:Tree.Node)=>{
  if(!element(node))return
  const key=attribute(node,'data-layout-ref')
  if(key!==undefined){
   if(!/^\d+$/.test(key)||!slots[Number(key)]||found.has(key))throw new Error('布局引用缺失、重复或不在targets中：'+key)
   if(node.tagName!=='div')throw new Error('布局引用使用div data-layout-ref，排版包装可自由选择')
   if(node.childNodes.some(child=>element(child)||child.nodeName==='#text'&&(child as Tree.TextNode).value.trim()))throw new Error('布局引用留空，由软件注入当前正文，不重复生成内容')
   found.add(key)
  }
  if(['script','iframe','object','embed','img','video','audio','link'].includes(node.tagName)||node.attrs.some(a=>/^on/i.test(a.name)))throw new Error('临时布局只表达布局；内容、资源和运行程序使用已有对象')
  if(node.tagName==='style'&&node.childNodes.some(child=>child.nodeName==='#text'&&/(?:@import|url\s*\()/i.test((child as Tree.TextNode).value)))throw new Error('临时布局不请求外部资源；当前作品字体由软件提供')
  node.childNodes.forEach(scan)
 }
 tree.childNodes.forEach(scan)
 if(found.size!==ids.length)throw new Error('每个targets对象必须且只能引用一次；遗漏不表示删除')
 const size=viewport??scope.designSize??{width:1280,height:720}
 const resourceUrls:Record<string,string>={}
 for(const [id,asset]of Object.entries(project.assets)){const bytes=resources.assets[id];if(bytes)resourceUrls[id]='data:'+asset.mimeType+';base64,'+Buffer.from(bytes).toString('base64')}
 return {html:serialize(tree),viewport:{width:Math.ceil(size.width),height:Math.ceil(size.height)},slots,resourceUrls,reads,geometryReads,surfaceId:scope.id,ids:[...ids]}
}
export function existingLayoutChanges(before:CourseProjectV10,current:CourseProjectV10,request:ExistingLayoutRequest):'none'|'remeasure'|'conflict' {
 const changed=(path:string[])=>{const a=componentValueAt(before,path),b=componentValueAt(current,path);return a.exists!==b.exists||a.exists&&!same(a.value,b.value)}
 if(request.geometryReads.some(changed)||request.ids.some(id=>!current.instances[id]||componentIsLocked(current,id)))return 'conflict'
 return request.reads.some(changed)?'remeasure':'none'
}
export function compileExistingObjectLayout(project:CourseProjectV10,request:ExistingLayoutRequest,measurements:readonly ExistingLayoutMeasurement[]):ComponentOperationBatch {
 const byKey=new Map(measurements.map(value=>[value.key,value]));if(byKey.size!==request.ids.length||measurements.length!==request.ids.length)throw new Error('浏览器未返回每个对象的唯一有效几何')
 const edits:ComponentEdit[]=[]
 for(const [index,id]of request.ids.entries()){
  const measured=byKey.get(String(index)),instance=project.instances[id],old=instance.frame!
  if(!measured||![measured.frame.width,measured.frame.height,...measured.frame.transform].every(Number.isFinite)||measured.frame.width<=0||measured.frame.height<=0)throw new Error('对象不可见或不是可保全的二维矩形：'+id)
  const local=composeMatrices(invertMatrix(parentMatrix(project,id,request.surfaceId)),measured.frame.transform)
  const isGroup=componentDefinitionBuiltinKey(project.definitions[instance.definitionId])==='guoling.group'
  const frame=isGroup?{...old,transform:[...composeMatrices(local,scaleMatrix(measured.frame.width/old.width,measured.frame.height/old.height))] as [number,number,number,number,number,number]}:{width:measured.frame.width,height:measured.frame.height,transform:[...local] as [number,number,number,number,number,number]}
  edits.push({type:'frame.set',instanceId:id,frame})
 }
 // Temporary wrapper/order has no lasting author tree. Existing visual stacking and identity remain unchanged.
 return captureComponentOperation(project,edits,[...request.geometryReads,...request.reads])
}
