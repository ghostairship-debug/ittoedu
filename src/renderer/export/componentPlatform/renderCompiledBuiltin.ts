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
 try{const implementation=implementations.get(key);if(!implementation)throw new Error(`组件 ${key} 的专业渲染未接入`);await implementation.mount({root,instance,scope,layout:{read:()=>input,subscribe:()=>()=>{},reportSize(){}}});await dom.fonts?.ready;return root.innerHTML}
 finally{controller.abort();for(const cleanup of cleanups)cleanup();container.remove()}
}
