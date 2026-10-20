import type { PublishedInstance } from '../../../shared/contracts/component-platform/published'
import type { CourseProjectV10, ComponentRuntimeContext } from '../../../shared/contracts/component-platform'
import { defaultBuiltinRuntimeImplementations } from '../../../player/components/defaultBuiltinRuntimeImplementations'
import { componentLayoutInput } from '../../../components/web/measuredFragmentBox'
/** Only trusted professional adapters run during compilation; authored programs remain inert. */
export async function renderCompiledBuiltin(instance:PublishedInstance,key:string,project:CourseProjectV10,dom:Document):Promise<string>{
 if(key==='guoling.group')return ''
 const controller=new AbortController(),cleanups:Array<()=>void>=[],root=dom.createElement('div');root.style.cssText=`position:relative;width:${instance.frame?.width??860}px;height:${instance.frame?.height??'auto'}${instance.frame?'px':''};pointer-events:none`
 const container=dom.createElement('div');container.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden';container.append(root);dom.body.append(container)
 const implementations=defaultBuiltinRuntimeImplementations({assetUrl:id=>(project.assets[id] as unknown as {url?:string})?.url,reportImage() {}})
 const scope:ComponentRuntimeContext['scope']={runScopeId:'publish-compile',instanceId:instance.id,generation:1,signal:controller.signal,isActive:()=>!controller.signal.aborted,cleanup:fn=>cleanups.push(fn),target:()=>null,events:{emit(){},subscribe:()=>()=>{}},state:{get:()=>undefined,set(){},subscribe:()=>()=>{}}}
 const input=componentLayoutInput(instance,{project,kind:instance.frame?'free-frame':'flow',inlineSize:860,definition:project.definitions[instance.definitionId]})
 try{
  const implementation=implementations.get(key);if(!implementation)throw new Error(`组件 ${key} 的专业渲染未接入`)
  await implementation.mount({root,instance,scope,layout:{read:()=>input,subscribe:()=>()=>{},reportSize(){}}})
  await dom.fonts?.ready
  if(instance.frame&&['guoling.text','guoling.formula'].includes(key)){
   // The runtime's earlier observer measures the exact local content box and
   // restores authored fonts before this static projection captures its scale.
   const Observer=dom.defaultView?.ResizeObserver
   if(Observer)await new Promise<void>(resolve=>{
    const observer=new Observer(entries=>{const box=entries.find(entry=>entry.target===root)?.contentRect
     if(box){observer.disconnect();resolve()}})
    cleanups.push(()=>observer.disconnect());observer.observe(root)
   })
   const element=root.querySelector<HTMLElement>('[data-text-component]'),content=element?.querySelector<HTMLElement>('[data-text-component-content]')
   if(element&&content){
    // CSSOM serializes px widths with fewer digits than the browser's layout
    // unit. The formal parent owns fixed axes; only an automatic block axis
    // keeps the professional renderer's measured growth in this projection.
    const vertical=content.style.writingMode.startsWith('vertical')||content.style.writingMode.startsWith('sideways')
    element.style[vertical?'height':'width']='100%'
    const sizing=instance.data&&typeof instance.data==='object'&&!Array.isArray(instance.data)?instance.data.sizing:undefined
    const growing=sizing&&typeof sizing==='object'&&!Array.isArray(sizing)&&sizing.mode==='grow-height'
    if(!growing)element.style[vertical?'width':'height']='100%'
   }
  }
  return root.innerHTML
 }
 finally{controller.abort();for(const cleanup of cleanups)cleanup();container.remove()}
}
