import type { TeacherControllerAction,TeacherControllerPort } from '../../shared/contracts/component-platform'
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
 const dom=root.ownerDocument,win=dom.defaultView!,bar=dom.createElement('nav')
 bar.dataset.playbackChrome='navigation';bar.setAttribute('aria-label','作品导航补充')
 Object.assign(bar.style,{position:'absolute',height:'44px',boxSizing:'border-box',display:'none',alignItems:'center',gap:'6px',padding:'4px 6px',borderRadius:'10px',background:'#f8fafc',color:'#0f172a',border:'1px solid #cbd5e1',font:'14px system-ui,sans-serif',zIndex:'30'})
 let disposed=false,busy=false,scope='',settled=false,timer:ReturnType<typeof setTimeout>|undefined,frame=0,reported=false,dialog:HTMLDialogElement|undefined
 const controls=new Map<'previous'|'next'|'directory',HTMLButtonElement>()
 const authored=options.playback?.presenter.strategy==='authored-command'
 const execute=async(direction:'next'|'previous')=>authored ? options.onAuthoredCommand?.(direction)??false : navigation.execute({type:direction==='next'?'step.next':'step.previous'})
 const close=()=>{dialog?.close();dialog?.remove();dialog=undefined}
 const directory=()=>{
   close();dialog=dom.createElement('dialog');dialog.dataset.playbackChrome='directory';dialog.setAttribute('aria-label','作品目录')
   Object.assign(dialog.style,{padding:'16px',maxWidth:'min(440px,90vw)',maxHeight:'80vh',overflow:'auto',border:'1px solid #cbd5e1',borderRadius:'12px'})
   const state=navigation.read()
   for(const scene of state.scenes)for(const target of [{name:scene.name,action:{type:'scene.go' as const,sceneId:scene.id}},...(scene.targets??[])]){
     const button=dom.createElement('button');button.type='button';button.textContent=target.name;button.disabled=!navigation.canExecute(target.action)
     Object.assign(button.style,{display:'block',width:'100%',textAlign:'left',padding:'10px',margin:'3px 0'})
     button.onclick=()=>{if(!busy&&navigation.canExecute(target.action)){busy=true;void navigation.execute(target.action).then(ok=>{if(ok)close()},error=>options.report?.(String(error))).finally(()=>{busy=false;sync()})}}
     dialog.append(button)
   }
   const done=dom.createElement('button');done.type='button';done.textContent='关闭目录';done.onclick=close;dialog.append(done);root.append(dialog);dialog.showModal()
 }
 for(const [kind,label] of [['previous','上一步'],['next','下一步'],['directory','目录']] as const){
   const button=dom.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',label);button.dataset.fallbackControl=kind
   Object.assign(button.style,{height:'34px',minWidth:'54px',border:'0',borderRadius:'6px',font:'inherit',cursor:'pointer',padding:'0 8px'})
   button.onclick=()=>{if(disposed||busy||button.disabled)return;if(kind==='directory'){directory();return}busy=true;sync();void execute(kind).catch(error=>options.report?.(String(error))).finally(()=>{busy=false;sync()})}
   controls.set(kind,button);bar.append(button)
 }
 const remove=()=>{bar.remove();bar.style.display='none';close()}
 const schedule=()=>{if(!disposed&&!frame)frame=win.requestAnimationFrame(()=>{frame=0;sync()})}
 const sync=()=>{
   if(disposed)return
   const state=navigation.read(),nextScope=state.locationId??''
   if(nextScope!==scope||!timer&&!settled){scope=nextScope;settled=false;reported=false;clearTimeout(timer);remove();timer=setTimeout(()=>{timer=undefined;settled=true;sync()},options.graceMs??2000)}
   if(!settled||options.active?.()===false||state.interactive===false){remove();return}
   const coverage=navigationCoverage(state,navigation.readControls?.()??{actions:[]})
   const commands=authored?options.authoredCommands?.()??[]:[]
   const missing={previous:(authored?commands.includes('previous'):coverage.needsPrevious)&&!coverage.previous,
     next:(authored?commands.includes('next'):coverage.needsNext)&&!coverage.next,
     directory:coverage.needsDirectory&&!coverage.directory&&!state.reading}
   const kinds=(['previous','next','directory'] as const).filter(kind=>missing[kind])
   if(!kinds.length){remove();return}
   for(const [kind,button] of controls){button.hidden=!missing[kind];button.style.display=missing[kind]?'':'none';button.disabled=busy||kind!=='directory'&&(authored?options.canAuthoredCommand?.(kind)===false:!navigation.canExecute({type:kind==='next'?'step.next':'step.previous'}))}
   const width=kinds.length*60+12,height=44
   const container=options.slot??root,box=container.getBoundingClientRect()
   const placement=options.slot?{left:box.left,top:box.top,right:box.left+width,bottom:box.top+height}:navigationFallbackRect(box,width,height,navigationProtectedRects(options.content))
   if(!placement){remove();if(!reported){reported=true;options.report?.('导航通路缺失，但当前宿主没有不遮挡内容的控件位置；保留正文尺寸与现有键盘/宿主入口，请为导航提供内容内位置。')}return}
   reported=false;bar.style.width=width+'px';bar.style.left=(placement.left-box.left)+'px';bar.style.top=(placement.top-box.top)+'px';bar.style.display='flex';if(bar.parentElement!==container)container.append(bar)
 }
 const off=navigation.subscribe(sync),offControls=navigation.subscribeControls?.(sync)
 const observer=new win.MutationObserver(records=>{if(records.some(record=>!(record.target instanceof win.Element)||!record.target.closest('[data-playback-chrome]')))schedule()})
 observer.observe(options.content,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style','class','inert']})
 const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(schedule):undefined;resize?.observe(root)
 win.addEventListener('resize',schedule);root.addEventListener('scroll',schedule,true);sync()
 return {sync,destroy(){if(disposed)return;disposed=true;clearTimeout(timer);if(frame)win.cancelAnimationFrame(frame);observer.disconnect();resize?.disconnect();off();offControls?.();win.removeEventListener('resize',schedule);root.removeEventListener('scroll',schedule,true);remove()}}
}
