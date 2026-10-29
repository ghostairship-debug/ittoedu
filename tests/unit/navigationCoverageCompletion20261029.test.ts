import {afterEach,expect,it,vi} from 'vitest'
import {NavigationControlBindings,navigationCoverage} from '../../src/player/behaviors/navigation/navigationControls'
import {navigationFallbackRect} from '../../src/player/componentPlatform/navigationFallbackPlacement'
import {mountPlaybackNavigationChrome} from '../../src/player/componentPlatform/playbackNavigationChrome'
import type {TeacherControllerAction,TeacherControllerPort,TeacherControllerSnapshot} from '../../src/shared/contracts/component-platform/teacherController'
const snapshot=():TeacherControllerSnapshot=>({locationId:'a',interactive:true,scenes:[{id:'a',name:'A',targets:[{id:'clue',name:'Clue',kind:'state',action:{type:'scene.go',sceneId:'a',targetStateId:'clue'}}]},{id:'b',name:'B'}],progress:{sceneIndex:0,sceneCount:2,sceneName:'A',stepIndex:0,stepCount:2,stepName:''},zoom:1,muted:false,fullscreen:false})
afterEach(()=>{vi.useRealTimers();document.body.replaceChildren()})
it('registered mounts respect scoped lifetime and do not turn legitimate disabled progression into a missing control',async()=>{
 const bindings=new NavigationControlBindings();let visible=true,scope:string|null|undefined='a';const changed=vi.fn();bindings.subscribe(changed)
 const stop=bindings.register({actions:[{type:'step.next'}],present:()=>visible},()=>scope)
 await Promise.resolve();expect(changed).toHaveBeenCalledOnce();expect(bindings.read('b').actions).toEqual([])
 expect(navigationCoverage(snapshot(),bindings.read('a'))).toMatchObject({next:true,needsNext:true,needsDirectory:false})
 visible=false;expect(bindings.read('a').actions).toEqual([]);visible=true;scope=null;expect(bindings.read('a').actions).toEqual([])
 scope=undefined;expect(bindings.read('b').actions).toHaveLength(1);stop();expect(bindings.read('a').actions).toEqual([])
 bindings.dispose();bindings.register({actions:[{type:'step.next'}],present:()=>true});expect(bindings.read().actions).toEqual([])
})
it('invalid destinations do not cover navigation; directory and step bindings have different responsibilities',()=>{
 expect(navigationCoverage(snapshot(),{actions:[{type:'scene.go',sceneId:'deleted'}]})).toMatchObject({next:false,directory:false,needsDirectory:true})
 expect(navigationCoverage(snapshot(),{actions:[{type:'scene.open-picker'}]})).toMatchObject({next:false,directory:true,needsNext:true})
 const state=snapshot();state.progress!.stepIndex=1
 expect(navigationCoverage(state,{actions:[{type:'scene.go',sceneId:'a'}]}).previous).toBe(true)
 expect(navigationCoverage(state,{actions:[{type:'scene.go',sceneId:'a',targetStateId:'clue'}]}).previous).toBe(false)
})
it('safe placement uses real free space and declines a fully occupied host instead of shifting or obscuring content',()=>{
 const host={left:0,top:0,right:800,bottom:600}
 expect(navigationFallbackRect(host,190,44,[{left:20,top:10,right:780,bottom:500}])).not.toBeNull()
 expect(navigationFallbackRect(host,190,44,[host])).toBeNull()
})
function mounted(settings?: {hostNavigation?:'intentionally-hidden';presenter?:'authored-command'}){
 const root=document.createElement('main'),content=document.createElement('article');root.append(content);document.body.append(root)
 vi.spyOn(root,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:800,bottom:600,width:800,height:600,x:0,y:0,toJSON(){}})
 let state=snapshot();const listeners=new Set<()=>void>(),bindings=new NavigationControlBindings(),execute=vi.fn(async()=>true),authored=vi.fn(async()=>true)
 const navigation:TeacherControllerPort={read:()=>state,readLocation:()=>state.locationId,subscribe:f=>{listeners.add(f);return()=>{listeners.delete(f)}},execute,canExecute:()=>false,setCollapsed(){},moveBy(){},setZoom(){},resetView(){},readControls:()=>bindings.read(state.locationId??undefined),subscribeControls:bindings.subscribe}
 const chrome=mountPlaybackNavigationChrome(root,navigation,{content,playback:{controls:'none',keyboardNavigation:false,presenter:{enabled:true,strategy:settings?.presenter??'scene-navigation',additionalBindings:[]},hostNavigation:settings?.hostNavigation},authoredCommands:()=>['next'],onAuthoredCommand:authored,graceMs:20})
 return {root,content,chrome,bindings,execute,authored,set(stateValue:TeacherControllerSnapshot){state=stateValue;for(const f of listeners)f()}}
}
it('controls:none no longer suppresses missing fallback, grace prevents flashes, late completion removes UI without altering the article',async()=>{
 vi.useFakeTimers();const h=mounted()
 expect(h.root.querySelector('[data-playback-chrome]')).toBeNull()
 await vi.advanceTimersByTimeAsync(21)
 expect(h.root.querySelector('[data-fallback-control="next"]')).not.toBeNull()
 expect((h.root.querySelector('[data-fallback-control="next"]') as HTMLButtonElement).disabled).toBe(true)
 expect(h.content.style.cssText).toBe('')
 const off=h.bindings.register({actions:[{type:'step.next'}],present:()=>true});await Promise.resolve()
 expect(h.root.querySelector('[data-playback-chrome]')).toBeNull()
 off();await Promise.resolve();expect(h.root.querySelector('[data-playback-chrome]')).not.toBeNull()
 h.chrome.destroy();await vi.runOnlyPendingTimersAsync();expect(h.root.querySelector('[data-playback-chrome]')).toBeNull()
})
it('explicit opt-out stays hidden and authored-command fallback dispatches content command instead of changing scenes',async()=>{
 vi.useFakeTimers();const hidden=mounted({hostNavigation:'intentionally-hidden'});await vi.advanceTimersByTimeAsync(30);expect(hidden.root.querySelector('[data-playback-chrome]')).toBeNull();hidden.chrome.destroy()
 const h=mounted({presenter:'authored-command'});await vi.advanceTimersByTimeAsync(30)
 ;(h.root.querySelector('[data-fallback-control="next"]') as HTMLButtonElement).click();await Promise.resolve()
 expect(h.authored).toHaveBeenCalledWith('next');expect(h.execute).not.toHaveBeenCalled();h.chrome.destroy()
})
