import {allDocumentTextSlots,inlineComponentIds,documentInlineChildIds} from '../../shared/document/textInteraction'
import {isMeasuredWebFragmentBox,measuredFragmentRootCss} from '../../components/web/measuredFragmentBox'
import {restorePublishedWebMarkup} from '../../core/publish/componentPlatform/compactWebStyles'
import type {CompiledCoursePlayback} from '../../core/publish/componentPlatform/compiledContract'
import {compiledViewSignature,compiledProgramSignature} from '../../core/publish/componentPlatform/compiledContract'
import type {CourseProjectV10,ComponentRuntimeImplementation,ComponentInstance,MountedComponent} from '../../shared/contracts/component-platform'
import {resolveComponentPresentation,resolveComponentBackground,owningContainer,componentDefinitionBuiltinKey} from '../../shared/contracts/component-platform'
import {ComponentRuntimeWorld} from '../components/ComponentRuntimeWorld'
import {ComponentNavigationOwner} from '../../renderer/components/ComponentNavigationOwner'
import {createCompiledContentEnvironment} from './compiledContentEnvironment'
import {PlaybackViewSession,createPlaybackContent} from '../playbackViewSession'
import {resolveComponentOuterPresentation} from '../../shared/componentPresentation'
import {applyComponentBackgroundPaint} from '../../shared/componentBackgroundPaint'
import {applyComponentPaintStyle} from '../components/componentPlacementStyle'
import {createComponentSpatialCameraPort,componentSpatialCameraMatrix,type ComponentSpatialCameraPort} from '../surfaces/spatial/componentSpatialAdapter'
import {bindSpatialInput} from './spatialInput'
import {paintComponentSpatialGraph} from './paintSpatialGraph'
import {createTeacherControllerHudGeometry,projectTeacherControllerInstances,teacherControllerReferenceSize,isViewportComponent} from '../../shared/teacherControllerViewportGeometry'
import {flowParagraphAnchoredFrame,type FlowParagraphBlockRect} from '../../shared/flowParagraphAnchors'
import {resolveFlowPaperBackground,flowPaperMaxWidth} from '../../shared/flowBodyPresentation'
import {mountComponentFlowToc} from './flowToc'
import {attachComponentPlatformNavigationKeys} from '../behaviors/navigation/shortcuts'
import {preparePublishedNativeComponent,type SandboxRuntimeSnapshots} from '../components/runtime/SandboxComponentRuntime'
import {webContentRealmSource} from '../../components/web/contentRealmImplementation'
import {hasWebContentData} from '../../components/web/sourcePreparation'
import {resolveWebResourceBindings,refreshWebResourceReferences} from '../../components/web/resources'
import {createDomAuthoring} from '../../components/web/authoringDom'
import {DomTextOverrides} from '../lightEdit/domTextOverrides'
import type {WebRuntimeData} from '../../components/web/moduleGraph'
import {createPlaybackNavigationContent,mountPlaybackNavigationChrome} from './playbackNavigationChrome'
import {createWebResourceUrlLease,webRuntimeResourceAddress} from '../../components/web/resourceUrlLease'
import {componentFragmentStateKey,createComponentFragmentProjection} from './fragments'

interface SurfaceView {root:HTMLElement;host:HTMLElement;content:HTMLElement;view:PlaybackViewSession;camera?:ComponentSpatialCameraPort;off:()=>void;toc?:ReturnType<typeof mountComponentFlowToc>}
type Factory=(globals:Record<string,unknown>)=>Record<string,any>|Promise<Record<string,any>>
type WebFactory=(globals:Record<string,unknown>)=>unknown
function waitForSourceValue<T>(pending:PromiseLike<T>,signal:AbortSignal,retire?:(value:T)=>void|Promise<void>):Promise<T|undefined>{
 return new Promise((resolve,reject)=>{
  const cleanup=()=>signal.removeEventListener('abort',cancel)
  const cancel=()=>{cleanup();resolve(undefined)}
  signal.addEventListener('abort',cancel,{once:true})
  Promise.resolve(pending).then(value=>{cleanup();if(signal.aborted)return retire?.(value);resolve(value)},error=>{cleanup();reject(error)}).catch(reject)
  if(signal.aborted)cancel()
 })
}
/** Materialized DOM plus the same navigation/action/media/state owners used by the editor. */
export async function mountCompiledCourse(artifact:CompiledCoursePlayback,root:HTMLElement,options:{report?:(message:string,diagnostic?:{severity:'warning'|'error';code?:string;instanceId?:string})=>void;fontFaceCss?:string;keyboardNavigation?:boolean;preparedAssetBytes?:Readonly<Record<string,Uint8Array>>}={}){
 if(artifact.format!=='compiled-course-v1')throw new Error('未知编译播放制品')
 const hostRoot=root;root=createPlaybackNavigationContent(hostRoot)
 const dom=root.ownerDocument,browser=dom.defaultView!,controller=new AbortController(),report=(message:string,diagnostic?:{severity:'warning'|'error';code?:string;instanceId?:string})=>options.report?.(message,diagnostic)
 const assetLease=createWebResourceUrlLease(),views=new Map<string,SurfaceView>()
 let stopped=false,world!:ComponentRuntimeWorld,navigation!:ComponentNavigationOwner,
  observer:ResizeObserver|undefined,pointerChrome:ReturnType<typeof mountPlaybackNavigationChrome>|undefined,
  navigationTasks:ReturnType<ComponentNavigationOwner['createKeyTasks']>|undefined,keys:ReturnType<typeof attachComponentPlatformNavigationKeys>|undefined,
  offPlacement:(()=>void)|undefined,offNavigation:(()=>void)|undefined,removeLayoutListeners:(()=>void)|undefined,disposal:Promise<void>|undefined
 const dispose=():Promise<void>=>{
  if(disposal)return disposal
  stopped=true
  return disposal=(async()=>{
   let failed=false,firstError:unknown
   const attempt=async(action:()=>unknown|Promise<unknown>)=>{try{await action()}catch(error){if(!failed){failed=true;firstError=error}}}
   await attempt(()=>controller.abort());await attempt(()=>observer?.disconnect());await attempt(()=>offPlacement?.());await attempt(()=>offNavigation?.())
   await attempt(()=>keys?.destroy());await attempt(()=>pointerChrome?.destroy());await attempt(()=>navigationTasks?.dispose());await attempt(()=>navigation?.dispose());await attempt(()=>removeLayoutListeners?.())
   await attempt(()=>world?.dispose());await attempt(()=>assetLease.release())
   for(const view of views.values()){await attempt(()=>view.off());await attempt(()=>view.toc?.destroy());await attempt(()=>view.camera?.dispose());await attempt(()=>view.view.destroy())}
   await attempt(()=>root.remove())
   if(failed)throw firstError
  })()
 }
 try{
 // These objects retain Published V3 semantics. No author model/driver/observer projection is restored.
 const original=artifact.course as unknown as CourseProjectV10
 const assetSources=Object.fromEntries(Object.entries(artifact.course.assets).flatMap(([id,asset])=>asset.url?[[id,new URL(asset.url,dom.baseURI).href]]:[]))
 const assetUrls=assetLease.update(assetSources)
 const nativeResourceUrls=()=>Object.fromEntries(Object.entries({...assetSources,...world.resourceUrls()}).map(([id,url])=>[id,url.startsWith('blob:')&&assetSources[id]?assetSources[id]:url]))
 const replaceDeliveryAssets=(source:string)=>source.replace(/cw-delivery:([a-zA-Z0-9_.%~-]+)/g,(all,id)=>assetUrls[decodeURIComponent(id)]??all)
 const nativeDeliveryAssets=(source:string)=>source.replace(/cw-delivery:([a-zA-Z0-9_.%~-]+)/g,(all,id)=>assetSources[decodeURIComponent(id)]?webRuntimeResourceAddress(decodeURIComponent(id)):all)
 const webBindings=(instance:ComponentInstance)=>({...((instance.data as unknown as WebRuntimeData).resourceBindings??{}),...instance.authoring?.resourceBindings})
 const replaceAssets=(source:string,instance?:ComponentInstance)=>replaceDeliveryAssets(source).replace(/cw-resource:[a-zA-Z0-9_.-]+/g,ref=>assetUrls[(instance&&webBindings(instance)[ref])??ref]??ref)
 root.innerHTML=replaceAssets(artifact.html)
 const shell=root.querySelector<HTMLElement>('[data-compiled-course]')!,roots=new Map<string,HTMLElement>(),targets=new Map<string,HTMLElement>()
 for(const node of shell.querySelectorAll<HTMLElement>('[data-compiled-node]'))targets.set(node.dataset.compiledNode!,node)
 for(const node of shell.querySelectorAll<HTMLElement>('[data-compiled-runtime-root]'))roots.set(node.dataset.compiledRuntimeRoot!,node)
 let surfaceId=artifact.course.surfaces[0]?.id??null,stateId=artifact.course.surfaces[0]?.presentation?.initialStateId??null,project=original,ready:Promise<void>=Promise.resolve()
 const webFactories=new Map(Object.entries(artifact.webPrograms).map(([id,entries])=>[id,entries.map(entry=>({...entry,factories:entry.program.scriptFactories.map(code=>new Function(`return (${code})`)() as WebFactory),classicPrograms:entry.program.classicPrograms.map(program=>({index:program.index,kind:program.kind,activate:new Function(`return (${program.factorySource})`)() as WebFactory})),handlerFactories:entry.program.handlerFactories.map(code=>new Function(`return (${code})`)() as WebFactory)}))]))
 // Share code; each instance creates its own module namespace and lexical state.
 const sourceFactories=new Map(Object.entries(artifact.sourceFactories).map(([key,code])=>[key,new Function(`return (${code})`)() as Factory]))
 const nativeBuiltinHelpers:Record<string,unknown>={__eventMethod:(target:any,method:string)=>target[method].bind(target),__eventProperty:(target:any,name:string,value:unknown)=>(target[name]=value),__ownerDocument:(node:Node)=>node.ownerDocument}
 const builtinGlobals=new Proxy(nativeBuiltinHelpers,{get:(target,key)=>{if(Object.hasOwn(target,key))return Reflect.get(target,key);const value=Reflect.get(browser,key,browser);return typeof value==='function'&&!value.prototype?value.bind(browser):value}})
 const builtins=new Map<string,ComponentRuntimeImplementation>()
 for(const [key,code]of Object.entries(artifact.builtinFactories)){const factory=new Function(`return (${code})`)() as Factory,module=await factory(builtinGlobals);builtins.set(key,module.default??module)}
 const staticImplementation:ComponentRuntimeImplementation={mount:({root})=>{if(root)root.hidden=true;return{update(){},dispose(){}}}}
 for(const key of artifact.staticKeys)builtins.set(key,staticImplementation)
 navigation=new ComponentNavigationOwner({project:()=>original,surfaceId:()=>surfaceId,stateId:()=>stateId,presentationRoot:()=>hostRoot,viewportBounds:()=>{const r=root.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom}},courseState:{get:<T,>(key:string)=>world?.getState(key) as T|undefined,set:(key,value)=>world?.setState(key,value)},audio:()=>world?.audio(),report,
  restart:()=>world?.resetPlayback(true,{preserveNavigation:true}),
  select:async(id,signal,onCommit)=>{if(stopped||signal?.aborted||!views.has(id))return false;surfaceId=id;stateId=original.surfaces.find(surface=>surface.id===id)?.presentation?.initialStateId??null;onCommit?.();await update();return true},
  selectState:async(id,_surface,signal,onCommit)=>{if(stopped||signal?.aborted)return false;stateId=id;onCommit?.();await update();return true},
 })
 const teacher=navigation.teacherPort()
 const webEntry=(instance:ComponentInstance)=>webFactories.get(instance.id)?.find(entry=>entry.signature===compiledProgramSignature(instance))
 const sourceAuthorHtml=(instance:ComponentInstance)=>{const key=componentDefinitionBuiltinKey(original.definitions[instance.definitionId]),data=instance.data;return ['guoling.web','guoling.html-program'].includes(key??'')&&data&&typeof data==='object'&&!Array.isArray(data)&&typeof data.html==='string'?data.html:undefined}
 const currentWebData=(data:WebRuntimeData,instance:ComponentInstance)=>{const current=instance.data as unknown as WebRuntimeData;return{...data,resourceBindings:current.resourceBindings,textOverrides:current.textOverrides,resourceSources:current.resourceSources}}
 const nativeInstance=(instance:ComponentInstance)=>{const data=webEntry(instance)?.program.nativeData;if(!data)return instance;return resolveWebResourceBindings({...instance,data:{...currentWebData(data,instance),html:nativeDeliveryAssets(data.html),css:data.css&&nativeDeliveryAssets(data.css)} as any},id=>(assetSources[id]??world?.contentAssetUrl(id))?webRuntimeResourceAddress(id):undefined,report)}
 const authorContent=(root:HTMLElement,read:()=>ComponentInstance,web=false,resourceRoot:HTMLElement=root)=>{
  const pageText=web?new DomTextOverrides([root],(read().data as unknown as WebRuntimeData).textOverrides??[]):undefined
  const bindings=()=>web?webBindings(read()):read().authoring?.resourceBindings??{}
  const urls=()=>({...assetUrls,...world.resourceUrls()})
  const author=createDomAuthoring(root,{records:()=>read().authoring?.records??{},
   ...(pageText?{originalText:(node:Text)=>pageText.originalText(node),claimText:(node:Text,text:string|null)=>pageText.setLocalText(node,text)}:{}),
   resolveResource:reference=>urls()[bindings()[reference]??reference]??assetLease.resolve(reference,bindings())??reference,
   matchesResource:(reference,liveUrl)=>assetLease.matches(reference,liveUrl,bindings()),
   resourceReference:url=>Object.entries(bindings()).find(([,id])=>urls()[id]===url)?.[0]??Object.entries(urls()).find(([,value])=>value===url)?.[0],
   report:(authorKey,status)=>{if(status==='unresolved')report(`${read().id} 内部作者对象 ${authorKey} 当前无法唯一重绑定；原内容与作者修改已保留，尚未应用`)}})
  const refresh=()=>{
   pageText?.setRules((read().data as unknown as WebRuntimeData).textOverrides??[])
   refreshWebResourceReferences(resourceRoot,urls(),bindings());author.refresh()
  }
  refresh()
  return{refresh,dispose(){author.dispose();pageText?.destroy()}}
 }
 const nativeSnapshots=():SandboxRuntimeSnapshots=>({state:()=>world.stateSnapshot(),targets:profile=>world.targetSnapshots(profile),teacherController:teacher,authorHtml:sourceAuthorHtml,themeCss:()=>world.themeCss(),resources:nativeResourceUrls,connectOrigins:()=>original.logic?.network?.connectOrigins??[]})
 const connectFragments=(context:import('../../shared/contracts/component-platform').ComponentRuntimeContext,root:HTMLElement)=>{
  const key=componentFragmentStateKey(context.instance.id),projection=createComponentFragmentProjection(root,()=>context.scope.state.get(key),()=>context.layout?.read().mode==='flow-content')
  context.scope.cleanup(context.scope.state.subscribe(key,projection.apply));context.scope.cleanup(projection.dispose)
  if(context.layout)context.scope.cleanup(context.layout.subscribe(projection.apply))
 }
 world=new ComponentRuntimeWorld(`compiled:${artifact.id}`,{mode:'play',authoring:false,readInstanceData:instance=>{const program=webEntry(instance)?.program;if(program?.nativeData)return nativeInstance(instance).data;const source=program?.semanticData;return source?{...currentWebData(source.data,instance),html:replaceAssets(restorePublishedWebMarkup(source.data.html,source.declarations,dom),instance),css:source.data.css&&replaceAssets(source.data.css,instance)} as any:instance.data},fixedViewport:instance=>webEntry(instance)?.program.fixedViewport,teacherController:teacher,studentNavigation:navigation,builtins,report,fontFaceCss:options.fontFaceCss,resolveAssetUrl:id=>assetUrls[id],
  resolveSource:async(implementation,signal)=>{
   const key=implementation.source??'',factory=sourceFactories.get(key)
   if(factory){let webDocument=false;return{isWebDocument:()=>webDocument,implementation:{mount:async context=>{
    const env=createCompiledContentEnvironment(context,{html:'',css:[world.courseThemeCss(),replaceAssets(artifact.sourceStyles[key]??'',context.instance)].join('\n')});context.scope.cleanup(env.dispose)
    try{
     const pending=factory(env.globals)
     let module:Record<string,any>|undefined
     if(pending&&typeof pending.then==='function'){
      const initialized=env.initialize([])
      module=await waitForSourceValue(pending as PromiseLike<Record<string,any>>,context.scope.signal)
      await initialized
     }else module=pending as Record<string,any>
     if(!module||!context.scope.isActive())return{update(){},dispose(){}}
     const source=module.default??module
     if(typeof source.mount!=='function')throw new Error('局部程序没有 Component API5 mount')
     webDocument=source.document==='web'
     const mounting=Promise.resolve(source.mount({...context,root:context.root?env.root:undefined})) as Promise<MountedComponent>
     const [mounted]=await Promise.all([waitForSourceValue(mounting,context.scope.signal,async value=>{try{await value.dispose()}catch(error){report(`组件 ${context.instance.id} 退役清理失败：${String(error)}`)}}),env.initialize([])])
     // Early values remain Host-owned, including its API5 validation and the
     // original mounted receiver. Only an aborted wait returns the empty lease.
     if(context.scope.signal.aborted&&mounted===undefined)return{update(){},dispose(){}}
     if(!mounted||typeof mounted.update!=='function'||typeof mounted.dispose!=='function')return mounted as MountedComponent
     if(webDocument&&context.root)connectFragments(context,env.root)
     let current=context.instance
     const author=context.root?authorContent(env.root,()=>current,sourceAuthorHtml(current)!==undefined,env.root.parentElement??env.root):undefined
     if(author){context.scope.cleanup(author.dispose);context.scope.cleanup(context.scope.events.subscribe('__runtime.resources',author.refresh))}
     return{update:async next=>{current=next;await mounted.update(next);author?.refresh()},
      updatePlacement:mounted.updatePlacement?frame=>mounted.updatePlacement!(frame):undefined,
      suspend:mounted.suspend?()=>mounted.suspend!():undefined,resume:mounted.resume?()=>mounted.resume!():undefined,
      dispose:async()=>{author?.dispose();await mounted.dispose()}}
    }catch(error){env.dispose();throw error}
   }}}}
   const source=artifact.nativeSources?.[implementation.source??'']
   if(!source)throw new Error('此局部程序尚未成功编译；原源码保留在作者工程，详见交付诊断')
   return preparePublishedNativeComponent({format:'esm',code:source.code,css:nativeDeliveryAssets(source.css),diagnostics:[]},signal,{...nativeSnapshots(),resourceBindings:implementation.resourceBindings,webInstance:value=>hasWebContentData(value.data)?resolveWebResourceBindings(value,id=>(assetSources[id]??world.contentAssetUrl(id))?webRuntimeResourceAddress(id):undefined,report,implementation.resourceBindings):value})
  },
  resolveBuiltin:async(_key,signal,instance)=>{
   if(webEntry(instance)?.program.nativeData)return preparePublishedNativeComponent({format:'esm',code:webContentRealmSource(),css:'',diagnostics:[]},signal,{...nativeSnapshots(),builtinKey:_key,instance:nativeInstance,nativeDocument:true})
   return{isWebDocument:()=>true,implementation:{mount:async context=>{
   const entry=webFactories.get(instance.id)?.find(value=>value.signature===compiledProgramSignature(context.instance))
   if(!entry)throw new Error('该状态的 Web 程序未编译；原件保留在作者工程')
   let current=context.instance
   const projected=resolveWebResourceBindings({...current,data:{...currentWebData(entry.program.semanticData!.data,current),html:replaceDeliveryAssets(restorePublishedWebMarkup(entry.program.html,entry.program.declarations,dom)),css:replaceDeliveryAssets(entry.program.css)} as any},id=>world.contentAssetUrl(id)??assetUrls[id],report).data as unknown as WebRuntimeData
   const env=createCompiledContentEnvironment(context,{html:projected.html,css:[world.courseThemeCss(),replaceDeliveryAssets(entry.program.css)].join('\n'),cssResourceBindings:webBindings(current)});if(isMeasuredWebFragmentBox(context.instance,entry.program.fragment?'fragment':'document',undefined,{implementation:{kind:'builtin',key:_key}})){const element=[...env.root.children].find(node=>!['style','script','template'].includes(node.localName));if(element){element.setAttribute('data-guoling-measured-root','');const normalizer=dom.createElement('style');normalizer.textContent=measuredFragmentRootCss('[data-guoling-measured-root]',context.layout?.read().mode==='flow-content');env.root.prepend(normalizer)}}context.scope.cleanup(env.dispose);await env.initialize(entry.factories,{classicPrograms:entry.classicPrograms,handlerFactories:entry.handlerFactories})
   const author=authorContent(env.root,()=>current,true,env.root.parentElement??env.root);context.scope.cleanup(author.dispose)
   connectFragments(context,env.root)
   const offResources=context.scope.events.subscribe('__runtime.resources',author.refresh)
   return{update(next){current=next;author.refresh()},dispose(){offResources();author.dispose();env.dispose()}}
  }}}
  },
 })
 function viewport(id:string){const surface=project.surfaces.find(value=>value.id===id),view=views.get(id);return{width:surface?.designSize?.width??view?.root.clientWidth??root.clientWidth,height:surface?.designSize?.height??view?.root.clientHeight??root.clientHeight}}
 function paintGlobals(){
  const view=views.get(surfaceId??'');if(!view)return
  const geometry=createTeacherControllerHudGeometry({referenceSize:teacherControllerReferenceSize(project),viewportRect:{x:0,y:0,width:root.clientWidth,height:root.clientHeight},controllerInsets:view.view.chrome?.controllerInsets})
  const display=projectTeacherControllerInstances(project,geometry,teacher)
  for(const id of [...project.global.underlay,...project.global.overlay]){const node=targets.get(id),instance=project.instances[id];if(!node||!instance?.frame)continue;if(isViewportComponent(project,id)){const frame=display.instances[id]?.frame;if(frame)Object.assign(node.style,{position:'absolute',left:'0',top:'0',width:`${frame.width}px`,height:`${frame.height}px`,transformOrigin:'0 0',transform:`matrix(${frame.transform.join(',')})`})}else{const stage=view.host,scale=view.view.fitScale(surfaceId!);const origin=`translate(${parseFloat(stage.style.left)||0}px,${parseFloat(stage.style.top)||0}px) scale(${scale})`;node.style.transform=`${origin} ${view.content.style.transform} matrix(${instance.frame.transform.join(',')})`}}
 }
 function paintFlowAnchors(view:SurfaceView){
  const surface=project.surfaces.find(value=>value.id===surfaceId),paper=view.content.querySelector<HTMLElement>('[data-compiled-flow-paper]');if(surface?.kind!=='flow'||!paper)return
  const rect=paper.getBoundingClientRect(),zoom=view.view.fitScale(surface.id)*view.view.state.zoom,blocks:FlowParagraphBlockRect[]=[]
  const visit=(ids:readonly string[],depth:number)=>{for(const id of ids){const instance=project.instances[id],node=targets.get(id);if(!instance||!node||instance.flowPlacement)continue;const box=node.getBoundingClientRect();if(box.width&&box.height)blocks.push({blockId:id,depth,x:(box.x-rect.x)/zoom,y:(box.y-rect.y)/zoom,width:box.width/zoom,height:box.height/zoom});visit(instance.childIds??[],depth+1)}};visit(surface.childIds,0)
  for(const id of surface.childIds){const instance=project.instances[id],anchor=instance?.flowPlacement?.paragraphAnchor,node=targets.get(id);if(!anchor||!node||!instance.frame)continue;const ancestors:string[]=[];let owner=owningContainer(project,anchor.blockId);while(owner?.kind==='instance'){ancestors.push(owner.instanceId);owner=owningContainer(project,owner.instanceId)}const frame=instance.frame,placed=flowParagraphAnchoredFrame(anchor,{x:frame.transform[4],y:frame.transform[5],width:frame.width,height:frame.height},paper.clientWidth,blocks,ancestors);if(placed)node.style.transform=`matrix(${frame.transform.slice(0,4).join(',')},${placed.x},${placed.y})`}
 }
 const relayout=()=>{if(stopped)return;const view=views.get(surfaceId??'');view?.view.resize();if(view?.camera){const size=viewport(surfaceId!);const worldNode=view.content.querySelector<HTMLElement>('[data-component-spatial-world]');if(worldNode)worldNode.style.transform=`matrix(${componentSpatialCameraMatrix(view.camera.read(),{x:0,y:0,...size}).join(',')})`;const graph=view.content.querySelector<SVGSVGElement>('[data-compiled-spatial-graph]');if(graph)paintComponentSpatialGraph(dom,project,surfaceId!,graph,view.camera.read(),size)}if(view)paintFlowAnchors(view);paintGlobals()}
 for(const surface of artifact.course.surfaces){const section=shell.querySelector<HTMLElement>(`[data-compiled-surface="${CSS.escape(surface.id)}"]`)!,content=section.querySelector<HTMLElement>('[data-compiled-surface-content]')!,view=new PlaybackViewSession(),viewportElement=(section.dataset.pageBackdrop='transparent',view.mount(section)),host=dom.createElement('div');viewportElement.append(host);host.append(content);section.dataset.pageBackdrop='transparent';if(surface.designSize){host.dataset.canvasWidth=String(surface.designSize.width);host.dataset.canvasHeight=String(surface.designSize.height)}view.register({id:surface.id,kind:surface.kind,root:host,content,onObservationChange:paintGlobals});view.activate(surface.id)
  const releases:Array<()=>void>=[],entry:SurfaceView={root:section,host,content,view,off:()=>releases.forEach(off=>off())};views.set(surface.id,entry)
  const observation={readZoom:()=>view.state.zoom,setZoom:(zoom:number)=>view.zoomTo(zoom),reset:()=>{view.reset();const scroll=content.querySelector<HTMLElement>('[data-flow-paper-scroll]');if(scroll)scroll.scrollTop=scroll.scrollLeft=0},goToInstance:(id:string|null)=>{const scroll=content.querySelector<HTMLElement>('[data-flow-paper-scroll]'),target=id&&targets.get(id);if(!scroll)return false;if(!id){scroll.scrollTop=0;return true}if(!target||!content.contains(target))return false;for(let parent=target.parentElement;parent&&parent!==content;parent=parent.parentElement)if(parent.tagName==='DETAILS')(parent as HTMLDetailsElement).open=true;const scale=view.fitScale(surface.id)*view.state.zoom;scroll.scrollTop+=(target.getBoundingClientRect().top-scroll.getBoundingClientRect().top)/scale;return true}}
  releases.push(navigation.registerObservation(surface.id,observation),view.subscribe(navigation.changed))
  if(surface.kind==='spatial'){const camera=createComponentSpatialCameraPort(surface.spatial?.home??{x:0,y:0,zoom:1}),session={frameId:null as string|null,stepIndex:null as number|null};entry.camera=camera;releases.push(camera.subscribe(relayout),bindSpatialInput(content,camera),navigation.registerCamera(surface.id,camera,{frameId:()=>session.frameId,selectFrame:value=>{session.frameId=value},stepIndex:()=>session.stepIndex,selectStep:index=>{session.stepIndex=index},viewport:()=>viewport(surface.id)}))}
  if(surface.kind==='flow'&&surface.flow?.layout.toc!=='hidden')entry.toc=mountComponentFlowToc(section,surface.id,teacher)
 }
 for(const [id,element]of roots)world.bind(id,element)
 for(const [id,element]of targets)world.bindTarget(id,element)
 world.bindTarget(artifact.id,shell);for(const [id,view]of views)world.bindTarget(id,view.root)
 let previousInline=new Set<string>()
 const staticSignatures=new Map<string,string>(),sectionStates=new Map<string,boolean>()
 async function update(){
  if(stopped)return
  const changedTextRanges:string[]=[]
  project=resolveComponentPresentation(original,surfaceId,stateId)
  for(const [id,view]of views){view.root.hidden=id!==surfaceId;view.root.style.display=id===surfaceId?'':'none'}
  const surface=project.surfaces.find(value=>value.id===surfaceId)
  applyComponentBackgroundPaint(shell,resolveComponentBackground(project,surface),id=>assetUrls[id])
  const currentInline=new Set(Object.values(project.instances).flatMap(owner=>allDocumentTextSlots(owner.data).flatMap(slot=>inlineComponentIds(slot.content)).concat(documentInlineChildIds(original,owner.id).filter(id=>!project.instances[id]?.frame&&!project.instances[id]?.flowPlacement)).filter(id=>owner.childIds?.includes(id))))
  for(const [id,node]of targets){if(currentInline.has(id)){node.style.display='none';continue}node.style.display='';if(previousInline.has(id)){world.bind(id,roots.get(id)!);world.bindTarget(id,node)}const instance=project.instances[id];if(!instance)continue;let owner=owningContainer(project,id);while(owner?.kind==='instance')owner=owningContainer(project,owner.instanceId);if(owner?.kind==='surface'&&owner.surfaceId!==surfaceId)continue
   const content=roots.get(id)!,stage=node.querySelector<HTMLElement>(':scope > [data-compiled-stage]')!,children=stage.querySelector<HTMLElement>(':scope > [data-compiled-children]')!,flow=node.dataset.compiledPlacement==='flow'
   const presentation=resolveComponentOuterPresentation(project,instance,{placement:flow?'flow':'free',purpose:'playback',inlineSize:content.clientWidth||instance.frame?.width||surface?.flow?.layout.readingWidth||860,flowLayout:surface?.flow?.layout})
   applyComponentPaintStyle(node,instance,project.definitions[instance.definitionId]);Object.assign(node.style,presentation.outerStyle);Object.assign(stage.style,presentation.stageStyle);Object.assign(content.style,presentation.contentStyle);Object.assign(children.style,presentation.childrenStyle)
   if(presentation.section&&sectionStates.get(id)!==presentation.section.collapsedByDefault){sectionStates.set(id,presentation.section.collapsedByDefault);(stage as HTMLDetailsElement).open=presentation.section.open}
   const variants=artifact.staticViews[id],signature=variants&&compiledViewSignature(instance);if(variants&&signature&&staticSignatures.get(id)!==signature){const markup=variants.find(value=>value.signature===signature)?.html;if(markup!==undefined){for(const child of [...content.childNodes])if(!(child instanceof browser.HTMLElement&&child.dataset.componentInstanceId))child.remove();const template=dom.createElement('template');template.innerHTML=replaceAssets(markup);content.prepend(template.content);staticSignatures.set(id,signature);changedTextRanges.push(id)}}
  }
  if(surface?.kind==='flow'){const paper=views.get(surface.id)?.content.querySelector<HTMLElement>('[data-compiled-flow-paper]');if(paper){paper.style.width=flowPaperMaxWidth(surface.flow?.layout??{readingWidth:860,wideContentWidth:1100});applyComponentBackgroundPaint(paper,resolveFlowPaperBackground(project,surface),id=>assetUrls[id])}}
  // State.order changes display order, while ordinary updates leave it intact.
  // Only move changed layers, parking native roots through the shared World.
  const orderedLayers=new Map<HTMLElement,HTMLElement[]>()
  for(const id of surface?.childIds??[]){const node=targets.get(id),parent=node?.parentElement;if(node&&parent){const list=orderedLayers.get(parent)??[];list.push(node);orderedLayers.set(parent,list)}}
  const changedLayers=[...orderedLayers].filter(([parent,list])=>{const members=new Set(list),current=[...parent.children].filter(node=>members.has(node as HTMLElement));return current.some((node,index)=>node!==list[index])})
  if(changedLayers.length){world.beforeProjectionMutation();try{for(const [parent,list]of changedLayers)for(const node of list)parent.append(node)}finally{world.afterProjectionMutation()}}
  previousInline=currentInline
  relayout();await world.sync(project,{assets:{...options.preparedAssetBytes},components:{}});for(const id of changedTextRanges)world.notifyTextRanges(id);relayout();navigation.changed()
 }
 ready=update();await ready
 await navigation.initializeSpatialPlayback(controller.signal)
 pointerChrome=mountPlaybackNavigationChrome(hostRoot,navigation,{content:root,playback:artifact.course.playback,report})
 navigationTasks=navigation.createKeyTasks();keys=options.keyboardNavigation===false?undefined:attachComponentPlatformNavigationKeys({root,navigation:navigationTasks,keyboardNavigation:artifact.course.playback?.keyboardNavigation??true,presenter:artifact.course.playback?.presenter??{enabled:true,strategy:'scene-navigation',additionalBindings:[]},onAuthoredCommand:command=>world.dispatchPresenterCommand(command),onError:error=>report(String(error))})
 observer=typeof browser.ResizeObserver==='function'?new browser.ResizeObserver(relayout):undefined;observer?.observe(root);root.addEventListener('load',relayout,true);root.addEventListener('toggle',relayout,true);removeLayoutListeners=()=>{root.removeEventListener('load',relayout,true);root.removeEventListener('toggle',relayout,true)};void dom.fonts?.ready.then(relayout)
 offPlacement=teacher.subscribePlacement?.(paintGlobals);offNavigation=teacher.subscribe(paintGlobals)
 for(const diagnostic of artifact.diagnostics)report(`${diagnostic.instanceId??''} ${diagnostic.message}`,{severity:diagnostic.blocking===false?'warning':'error',code:diagnostic.code,instanceId:diagnostic.instanceId})
 return {runtime:world,navigation,ready,next:()=>navigation.execute({type:'step.next'}),previous:()=>navigation.execute({type:'step.previous'}),go:(id:string,targetStateId?:string)=>navigation.execute({type:'scene.go',sceneId:id,targetStateId}),camera:(id:string)=>views.get(id)?.camera,observation:(id:string)=>views.get(id)?.view,update,
  dispose,
 }
 }catch(error){try{await dispose()}catch{/* Preserve the initialization failure over any later cleanup error. */}throw error}
}
