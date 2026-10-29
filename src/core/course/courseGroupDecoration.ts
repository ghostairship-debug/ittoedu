import type {ComponentDefinition,ComponentInstance,CourseProjectV10,JsonValue} from '../../shared/contracts/component-platform/project'
import {defaultShapeData} from '../../components/shape/data'
const css=(name:string)=>name.startsWith('--')?name:name.replace(/[A-Z]/g,v=>'-'+v.toLowerCase())
/** Simple box paint can survive independently. Descendant composition and clipping remain explicit component boundaries. */
export function groupPaintSplit(project:CourseProjectV10,group:ComponentInstance,allocate:()=>string):{instance:ComponentInstance;definition?:ComponentDefinition;remainingStyle:Record<string,JsonValue>}|null {
 const style=Object.fromEntries(Object.entries(group.style??{}).map(([key,value])=>[css(key),value]))
 const visiblePaint=Object.entries(style).some(([key,value])=>{
  const s=String(value).trim();return key==='background-color'&&!['transparent','rgba(0, 0, 0, 0)','rgba(0,0,0,0)',''].includes(s)
   || key==='background'&&!['none','transparent',''].includes(s)||key==='background-image'&&s!=='none'||key==='box-shadow'&&s!=='none'
 })
 if(!visiblePaint)return null
 const paint:Record<string,JsonValue>={},remainingStyle={...group.style}
 for(const [key,value] of Object.entries(group.style??{})){
  const name=css(key)
  if(name.startsWith('background')||name==='box-shadow'||name==='border-radius'){paint[key]=value;delete remainingStyle[key]}
  else if(name.startsWith('--')||name==='color')paint[key]=value
 }
 const existing=Object.values(project.definitions).find(d=>d.implementation.kind==='builtin'&&d.implementation.key==='guoling.shape')
 const definition:ComponentDefinition|undefined=existing?undefined:{id:allocate(),title:'形状',role:'content',implementation:{kind:'builtin',key:'guoling.shape'}}
 const data=defaultShapeData();data.style.fillColor='transparent';data.style.fillOpacity=0;data.style.borderWidth=0;data.style.cornerRadius=0
 return {definition,remainingStyle,instance:{id:allocate(),definitionId:existing?.id??definition!.id,name:'组合背景',data:JSON.parse(JSON.stringify(data)),frame:{width:group.frame!.width,height:group.frame!.height,transform:[1,0,0,1,0,0]},style:paint,...(group.visible===false?{visible:false}:{})}}
}
export function groupCompositeBoundary(group:ComponentInstance):string|null {
 for(const [raw,value] of Object.entries(group.style??{})){
  const key=css(raw),s=String(value).trim()
  if(/^(filter|backdrop-filter|clip-path|mask(?:-image)?|perspective|transform|translate|rotate|scale)$/.test(key)&&!['none',''].includes(s)
   ||key==='clip'&&!['auto','none',''].includes(s)||key==='opacity'&&Number(s)!==1
   ||key==='mix-blend-mode'&&s!=='normal'||key==='isolation'&&s==='isolate'
   ||/^overflow(?:-[xy]|-inline|-block)?$/.test(key)&&!['visible',''].includes(s)
   ||key==='position'&&['sticky','fixed'].includes(s)||key==='animation-name'&&s!=='none'
   ||key==='contain'&&/paint|layout|strict|content/.test(s)
   ||/^(border(?:-(?:top|right|bottom|left))?|outline)$/.test(key)&&!['none','0','0px',''].includes(s)
   ||/^border(?:-(top|right|bottom|left))?-style$/.test(key)&&!['none','hidden',''].includes(s)
   ||key==='outline-style'&&!['none','hidden',''].includes(s))return key
 }
 return null
}
