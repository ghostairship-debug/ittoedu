import {webUsesFixedViewport} from '../../../components/web/measuredFragmentBox'
import {htmlDocumentKind} from '../../../shared/html/documentKind'
import {compactPublishedWebMarkup} from './compactWebStyles'
import {allDocumentTextSlots,inlineComponentIds} from '../../../shared/document/textInteraction'
import type { PublishedCourseV3, PublishedInstance, PublishedImplementation } from '../../../shared/contracts/component-platform/published'
import type { ComponentRuntimeContext, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { resolveComponentPresentation, componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform'
import { resolveComponentOuterPresentation, isGlobalFramedWebDocument } from '../../../shared/componentPresentation'
import { componentPaintStyle } from '../../../player/components/componentPlacementStyle'
import { FLOW_BODY_PAPER_PADDING, FLOW_BODY_SCROLL_PADDING, FLOW_BODY_FONT_FAMILY, flowPaperMaxWidth } from '../../../shared/flowBodyPresentation'
import { renderDocumentText } from '../../../shared/document/render'
import { getBuiltinComponentSource } from '../../components/source/builtinSources'
import { compilePublishedScriptModule, compilePublishedWebProgram, stylesRequireNativeDocument, type CompiledScriptDiagnostic } from './compiledScript'
import type { WebRuntimeData } from '../../../components/web/moduleGraph'
import {webProgramRequiresNativeDocument} from './nativeProgram'

import {compiledViewSignature,compiledProgramSignature,type CompiledCoursePlayback} from './compiledContract'
export type {CompiledCoursePlayback} from './compiledContract'
const staticKeys=new Set(['guoling.text','guoling.formula','guoling.document-block','guoling.group'])
const assetToken=(id:string)=>`cw-delivery:${encodeURIComponent(id)}`
/** Compile captured formal semantics once. This owner never runs authored code. */
export async function compileCoursePlayback(payload:PublishedCourseV3,options:{document:Document;renderBuiltin(instance:PublishedInstance,key:string,project:CourseProjectV10):Promise<string>;signal?:AbortSignal}):Promise<CompiledCoursePlayback>{
 const artifact:CompiledCoursePlayback={format:'compiled-course-v1',id:payload.id,title:payload.title,html:'',course:structuredClone(payload),staticViews:{},webPrograms:{},sourceFactories:{},nativeSources:{},sourceStyles:{},builtinFactories:{},staticKeys:[...staticKeys],diagnostics:[]}
 const dom=options.document, project=payload as unknown as CourseProjectV10, root=dom.createElement('div');root.dataset.compiledCourse=payload.id;root.style.cssText='position:relative;isolation:isolate;width:100%;height:100%'
 const tokenize=(html:string)=>{for(const [id,asset]of Object.entries(payload.assets))if(asset.url)html=html.split(asset.url).join(assetToken(id));return html}
 const versions=[project,...payload.surfaces.flatMap(surface=>(surface.presentation?.states??[]).map(state=>resolveComponentPresentation(project,surface.id,state.id)))]
 const source=(implementation:PublishedImplementation,key:string,instanceId?:string)=>{
  if(implementation.kind!=='source')return
  if(implementation.compiled?.code){
   const compiled=compilePublishedScriptModule(implementation.compiled.code,{routing:true})
   if(!compiled.nativeReasons.length&&compiled.factorySource&&!stylesRequireNativeDocument(implementation.compiled.css??'')){artifact.sourceFactories[key]=compiled.factorySource;artifact.sourceStyles[key]=tokenize(implementation.compiled.css??'')}
   else artifact.nativeSources![key]={code:implementation.compiled.code,css:tokenize(implementation.compiled.css??'')}
  }
  else artifact.diagnostics.push({code:'compiled-native-source-unavailable',message:'局部程序没有可交付的源码编译成品；原件保留在作者工程',instanceId})
  return {...implementation,source:key,workspace:undefined,dependencies:undefined,moduleBindings:undefined,compiled:undefined}
 }
 for(const [id,definition]of Object.entries(artifact.course.definitions))if(definition.implementation.kind==='source')definition.implementation=source(payload.definitions[id].implementation,`definition:${id}`)!
 const staticInstance=(instance:PublishedInstance,key:string)=>staticKeys.has(key)&&!allDocumentTextSlots(instance.data).some(slot=>inlineComponentIds(slot.content).length)
 const dynamicBuiltin=new Set<string>()
 for(const version of versions)for(const [id,instance]of Object.entries(version.instances)){
  options.signal?.throwIfAborted()
  const definition=payload.definitions[instance.definitionId], implementation=instance.implementationOverride??definition.implementation
  if(instance.implementationOverride?.kind==='source')artifact.course.instances[id].implementationOverride=source(implementation,`instance:${id}`,id)!
  if(implementation.kind!=='builtin')continue
  if(['guoling.web','guoling.html-program'].includes(implementation.key)){
   // Each effective presentation is prepared below; private program state stays runtime-only.
  }else if(!staticInstance(instance,implementation.key)&&implementation.key!=='guoling.interactions'&&!['guoling.audio','guoling.video'].includes(implementation.key))dynamicBuiltin.add(implementation.key)
 }
 for(const key of dynamicBuiltin){const implementation=getBuiltinComponentSource(key);if(!implementation?.source){artifact.diagnostics.push({code:'compiled-builtin-unavailable',message:`组件 ${key} 没有可交付的专业实现`});continue;}const result=compilePublishedScriptModule(implementation.source,{trustedBuiltin:true});artifact.diagnostics.push(...result.diagnostics);if(result.factorySource)artifact.builtinFactories[key]=result.factorySource}
 for(const version of versions)for(const instance of Object.values(version.instances)){
  const implementation=instance.implementationOverride??version.definitions[instance.definitionId]?.implementation
  if(implementation?.kind!=='builtin')continue
  if(['guoling.web','guoling.html-program'].includes(implementation.key)) {
   const signature=compiledProgramSignature(instance),programs=artifact.webPrograms[instance.id]??=[]
   if(!programs.some(value=>value.signature===signature)) {
    const data=instance.data as unknown as WebRuntimeData
    const program=compilePublishedWebProgram(data,{routing:true})
    if(isGlobalFramedWebDocument(version,instance)||webProgramRequiresNativeDocument(data,program)){
     const empty=compilePublishedWebProgram({html:'',css:''})
     programs.push({signature,program:{...empty,nativeData:{...data,html:tokenize(data.html),css:tokenize(data.css??'')},fixedViewport:webUsesFixedViewport(data.html,data.css??''),fragment:htmlDocumentKind(data.html)==='fragment'}})
    }else{
     const semantic=compactPublishedWebMarkup(tokenize(data.html),dom)
     artifact.diagnostics.push(...program.diagnostics.map(value=>({...value,instanceId:instance.id})))
     programs.push({signature,program:{...program,semanticData:{data:{...data,publishedDocumentBundles:undefined,html:semantic.html},declarations:semantic.declarations},fixedViewport:webUsesFixedViewport(data.html,data.css??''),fragment:htmlDocumentKind(data.html)==='fragment',...compactPublishedWebMarkup(tokenize(program.html),dom),css:tokenize(program.css)}})
    }
   }
   continue
  }
  if(!staticInstance(instance,implementation.key)||dynamicBuiltin.has(implementation.key))continue
  const signature=compiledViewSignature(instance),views=artifact.staticViews[instance.id]??=[]
  if(views.some(view=>view.signature===signature))continue
  views.push({signature,html:tokenize(await options.renderBuiltin(instance,implementation.key,version))})
 }
 const plane=(name:string,index:string)=>{const element=dom.createElement('div');element.dataset.compiledPlane=name;element.style.cssText=`position:absolute;inset:0;z-index:${index};pointer-events:none`;root.append(element);return element}
 const underlay=plane('underlay','0'),surfacePlane=plane('surfaces','1'),overlay=plane('overlay','2')
 const render=(parent:HTMLElement,ids:readonly string[],flow:boolean,model:CourseProjectV10,layout?:any)=>{
  for(const id of ids){const instance=model.instances[id],definition=instance&&model.definitions[instance.definitionId];if(!instance||definition?.role==='behavior')continue
   const presentation=resolveComponentOuterPresentation(model,instance,{placement:flow?'flow':'free',purpose:'playback',inlineSize:layout?.readingWidth??instance.frame?.width??1280,flowLayout:layout})
   const outer=dom.createElement('div'),stage=dom.createElement(presentation.section?'details':'div'),content=dom.createElement(presentation.section?'summary':'div'),children=dom.createElement('div')
   outer.dataset.componentObject=id;outer.dataset.compiledNode=id;content.dataset.compiledRuntimeRoot=id;children.dataset.compiledChildren=id;stage.dataset.compiledStage=id;outer.dataset.compiledPlacement=flow?'flow':'free';outer.dataset.componentPlacement=flow?'flow':'free'
   Object.assign(outer.style,componentPaintStyle(instance,definition),presentation.outerStyle);Object.assign(stage.style,presentation.stageStyle);Object.assign(content.style,presentation.contentStyle);Object.assign(children.style,presentation.childrenStyle)
   if(presentation.section)(stage as HTMLDetailsElement).open=presentation.section.open
   const signature=compiledViewSignature(instance),markup=artifact.staticViews[id]?.find(view=>view.signature===signature)?.html;if(markup)content.innerHTML=markup
   stage.append(content,children);outer.append(stage);parent.append(outer);render(children,instance.childIds??[],presentation.childrenPlacement==='flow',model,layout)
   if(flow&&instance.flowLayout?.caption){const caption=dom.createElement('figcaption');caption.innerHTML=renderDocumentText(instance.flowLayout.caption);outer.append(caption)}
  }
 }
 render(underlay,payload.global.underlay,false,project);render(overlay,payload.global.overlay,false,project)
 for(const surface of payload.surfaces){
  const section=dom.createElement('section');section.dataset.componentSurface=surface.id;section.dataset.compiledSurface=surface.id;section.style.cssText='position:absolute;inset:0;overflow:hidden;pointer-events:auto';section.hidden=surface.id!==payload.surfaces[0]?.id;surfacePlane.append(section)
  const content=dom.createElement('div');content.dataset.compiledSurfaceContent=surface.id;content.style.cssText='position:absolute;inset:0;transform-origin:0 0;overflow:visible';section.append(content)
  if(surface.kind==='flow'){
   const scroll=dom.createElement('div'),paper=dom.createElement('article'),body=dom.createElement('div');scroll.dataset.flowPaperScroll='true';body.dataset.compiledFlowBody=surface.id;paper.dataset.compiledFlowPaper=surface.id
   scroll.style.cssText=`position:absolute;inset:0;overflow:auto;padding:${FLOW_BODY_SCROLL_PADDING};container-type:inline-size;box-sizing:border-box`;paper.style.cssText=`position:relative;min-height:100%;width:${flowPaperMaxWidth(surface.flow?.layout??{readingWidth:860,wideContentWidth:1100})};margin:0 auto;padding:${FLOW_BODY_PAPER_PADDING};box-sizing:border-box;font-family:${FLOW_BODY_FONT_FAMILY};font-size:16px;line-height:1.6;color:#1f2937`;body.style.cssText='position:relative;display:flow-root;z-index:1'
   const layer=(container:HTMLElement,space:string,placement:string,z:string)=>{const element=dom.createElement('div');element.dataset.compiledFlowSpace=space;element.dataset.compiledFlowPlane=placement;element.style.cssText=`position:absolute;inset:0;z-index:${z};pointer-events:none`;container.append(element);render(element,surface.childIds.filter(id=>{const p=payload.instances[id]?.flowPlacement;return p?.space===space&&p.plane===placement}),false,project);return element}
   layer(paper,'paper','underlay','0');paper.append(body);layer(paper,'paper','overlay','2');scroll.append(paper);content.append(scroll);layer(content,'viewport','underlay','0');layer(content,'viewport','overlay','2');render(body,surface.childIds.filter(id=>!payload.instances[id]?.flowPlacement),true,project,surface.flow?.layout)
  }else if(surface.kind==='spatial'){const world=dom.createElement('div');world.dataset.componentSpatialWorld='';world.style.cssText='position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0';content.append(world);render(world,surface.childIds,false,project);const graph=dom.createElementNS('http://www.w3.org/2000/svg','svg');graph.dataset.compiledSpatialGraph=surface.id;graph.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible';content.append(graph)}else render(content,surface.childIds,false,project)
 }
 const compactWebData=(id:string,data:any)=>{
  const entries=artifact.webPrograms[id];if(!entries)return data
  const signature=compiledProgramSignature({data} as PublishedInstance),index=entries.findIndex(entry=>entry.signature===signature)
  if(index<0)return data
  return {...data,html:`compiled-web:${index}`,css:undefined,moduleGraph:undefined,modules:undefined,publishedModuleBundle:undefined,publishedDocumentBundles:undefined}
 }
 for(const [id,instance] of Object.entries(artifact.course.instances))if(artifact.webPrograms[id])instance.data=compactWebData(id,instance.data)
 for(const surface of artifact.course.surfaces)for(const state of surface.presentation?.states??[])for(const [id,override]of Object.entries(state.overrides))if(override.data&&artifact.webPrograms[id])override.data=compactWebData(id,override.data)
 for(const entries of Object.values(artifact.webPrograms))entries.forEach((entry,index)=>entry.signature=JSON.stringify([`compiled-web:${index}`,null,null]))
 artifact.staticKeys=[...staticKeys].filter(key=>!dynamicBuiltin.has(key))
 artifact.html=tokenize(root.outerHTML)
 return artifact
}

