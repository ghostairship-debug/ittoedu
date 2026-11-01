import type { ComponentRuntimeScope,TeacherControllerPort } from '../../shared/contracts/component-platform'
import { mount as mountTeacherController } from '../../components/teacher-controller/defaultController'
import type { TeacherControllerData } from '../../components/teacher-controller/types'
import { defaultTeacherControllerConfig } from '../../shared/teacherControllerConfig'
import { teacherControllerLayout } from '../../shared/teacherControllerLayout'
import { hostNavigationExplicitlyHidden,type ProjectPlaybackSettings } from '../../shared/contracts/playback-v1'
import { navigationCoverage } from '../behaviors/navigation/navigationControls'
import { navigationFallbackRect,navigationProtectedRects } from './navigationFallbackPlacement'

/** Full-size author viewport. Missing navigation never changes this rectangle. */
export function createPlaybackNavigationContent(root:HTMLElement):HTMLElement {
 const content=root.ownerDocument.createElement('div');content.dataset.playbackNavigationContent=''
 Object.assign(content.style,{position:'absolute',inset:'0',overflow:'hidden',minWidth:'0',minHeight:'0'})
 if(root.ownerDocument.defaultView?.getComputedStyle(root).position==='static')root.style.position='relative'
 root.append(content);return content
}
export function mountPlaybackNavigationChrome(root:HTMLElement,navigation:TeacherControllerPort,options:{
 content:HTMLElement;playback?:ProjectPlaybackSettings;active?():boolean;report?(message:string):void
 /** Existing host-owned slot, if available; the authored viewport has already excluded it. */
 slot?:HTMLElement;graceMs?:number;onAuthoredCommand?(command:'next'|'previous'):Promise<boolean>
 authoredCommands?():readonly ('next'|'previous')[];canAuthoredCommand?(command:'next'|'previous'):boolean
}) {
 if(hostNavigationExplicitlyHidden(options.playback))return {sync(){},destroy(){}}
 const dom=root.ownerDocument,win=dom.defaultView!,container=options.slot??root
 if(win.getComputedStyle(container).position==='static')container.style.position='relative'
 let disposed=false,scope='',settled=false,timer:ReturnType<typeof setTimeout>|undefined,frame=0
 let chrome:HTMLElement|undefined,controller:ReturnType<typeof mountTeacherController>|undefined,abort:AbortController|undefined
 let collapsed=true,anchor:{x:number;y:number}|undefined
 const localListeners=new Set<()=>void>(),cleanups=new Set<()=>void>()
 const data:TeacherControllerData=defaultTeacherControllerConfig()
 const instance={id:'playback-navigation-fallback',definitionId:'guoling.navigation',data}
 const authored=options.playback?.presenter.strategy==='authored-command'
 const direction=(action:{type:string})=>action.type==='step.next'?'next':action.type==='step.previous'?'previous':undefined
 const place=()=>{
   if(!chrome)return
   const box=container.getBoundingClientRect(),gap=8,size=52
   if(!anchor){
     const free=navigationFallbackRect(box,size,size,navigationProtectedRects(options.content))
     anchor={x:(free?.left??Math.max(box.left,box.right-size-gap))-box.left,y:(free?.top??Math.max(box.top,box.bottom-size-gap))-box.top}
   }
   anchor.x=Math.max(0,Math.min(anchor.x,box.width-size));anchor.y=Math.max(0,Math.min(anchor.y,box.height-size))
   const width=collapsed?size:Math.min(teacherControllerLayout(data).width,Math.max(size,box.width-gap*2)),height=collapsed?size:64
   const left=Math.max(0,Math.min(anchor.x+size-width,box.width-width)),top=Math.max(0,anchor.y+size-height)
   Object.assign(chrome.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'})
 }
 const keepPanelInView=()=>{
   if(!chrome||collapsed)return
   const panel=chrome.querySelector<HTMLElement>('.guoling-controller'),box=container.getBoundingClientRect(),bounds=panel?.getBoundingClientRect()
   if(!bounds?.height)return
   // The shared console wraps on narrow screens. Its actual height, rather
   // than the nominal one-row frame, determines whether its buttons fit.
   const shift=Math.max(box.top-bounds.top,Math.min(0,box.bottom-bounds.bottom))
   if(shift)chrome.style.top=(parseFloat(chrome.style.top)+shift)+'px'
 }
 const localChange=()=>{place();for(const listener of localListeners)listener();keepPanelInView()}
 // This host-owned controller is not authored navigation. Registering it as
 // coverage would make the fallback hide itself as soon as it appears.
 const port:TeacherControllerPort={...navigation,
   read:()=>({...navigation.read(),collapsed}),
   subscribe:listener=>{localListeners.add(listener);return()=>{localListeners.delete(listener)}},
   registerControl:()=>()=>{},bindControl:undefined,
   viewportBounds:()=>{const box=container.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom}},
   canExecute:action=>{const command=direction(action);return authored&&command?options.authoredCommands?.().includes(command)===true&&options.canAuthoredCommand?.(command)!==false:navigation.canExecute(action)},
   execute:async(action,signal,onCommit)=>{if(disposed||signal?.aborted)return false;const command=direction(action);return authored&&command?options.onAuthoredCommand?.(command)??false:navigation.execute(action,signal,onCommit)},
   setCollapsed:value=>{collapsed=value;localChange()},
   moveBy:(dx,dy)=>{if(anchor){anchor.x+=dx;anchor.y+=dy;localChange()}},
 }
 const remove=()=>{
   abort?.abort();abort=undefined
   for(const cleanup of cleanups)cleanup();cleanups.clear();controller=undefined
   chrome?.remove();chrome=undefined;localListeners.clear();collapsed=true
 }
 const show=()=>{
   if(!chrome){
     chrome=dom.createElement('div');chrome.dataset.playbackChrome='navigation'
     Object.assign(chrome.style,{position:'absolute',pointerEvents:'none',zIndex:'30'})
     const controllerRoot=dom.createElement('div');chrome.append(controllerRoot);container.append(chrome);place()
     const controllerAbort=new AbortController();abort=controllerAbort
     const controllerScope:ComponentRuntimeScope={runScopeId:'playback-navigation-fallback',instanceId:instance.id,generation:1,signal:controllerAbort.signal,
       isActive:()=>!disposed&&!controllerAbort.signal.aborted,cleanup:cleanup=>{cleanups.add(cleanup)},target:()=>null,
       events:{emit(){},subscribe:()=>()=>{}},state:{get:()=>undefined,set(){},subscribe:()=>()=>{}}}
     controller=mountTeacherController({root:controllerRoot,instance,scope:controllerScope,teacherController:port})
   }else{place();controller?.update(instance)}
   keepPanelInView()
 }
 const schedule=()=>{if(!disposed&&!frame)frame=win.requestAnimationFrame(()=>{frame=0;sync()})}
 const sync=()=>{
   if(disposed)return
   const state=navigation.read(),nextScope=state.locationId??''
   if(nextScope!==scope||!timer&&!settled){scope=nextScope;settled=false;clearTimeout(timer);remove();timer=setTimeout(()=>{timer=undefined;settled=true;sync()},options.graceMs??2000)}
   if(!settled||options.active?.()===false||state.interactive===false){remove();return}
   const coverage=navigationCoverage(state,navigation.readControls?.()??{actions:[]})
   const commands=authored?options.authoredCommands?.()??[]:[]
   const missing={previous:(authored?commands.includes('previous'):coverage.needsPrevious)&&!coverage.previous,
     next:(authored?commands.includes('next'):coverage.needsNext)&&!coverage.next,
     directory:coverage.needsDirectory&&!coverage.directory&&!state.reading}
   const kinds=(['previous','next','directory'] as const).filter(kind=>missing[kind])
   if(!kinds.length){remove();return}
   show()
 }
 const off=navigation.subscribe(sync),offControls=navigation.subscribeControls?.(sync)
 const observer=new win.MutationObserver(records=>{if(records.some(record=>!(record.target instanceof win.Element)||!record.target.closest('[data-playback-chrome]')))schedule()})
 observer.observe(options.content,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style','class','inert']})
 const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(schedule):undefined;resize?.observe(root)
 win.addEventListener('resize',schedule);root.addEventListener('scroll',schedule,true);sync()
 return {sync,destroy(){if(disposed)return;disposed=true;clearTimeout(timer);if(frame)win.cancelAnimationFrame(frame);observer.disconnect();resize?.disconnect();off();offControls?.();win.removeEventListener('resize',schedule);root.removeEventListener('scroll',schedule,true);remove()}}
}
