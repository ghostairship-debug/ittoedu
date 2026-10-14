// @vitest-environment node
import path from 'node:path'
import fs from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer, browser: Browser, url: string
beforeAll(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-audit-all-geometry'),
    resolve: { alias: { '@': path.resolve('src') } },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'react-dom', 'zustand', 'mermaid', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-schema-list', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [process.cwd(), 'D:/果铃工作台/node_modules'] } }, logLevel: 'error' })
  server.middlewares.use('/__audit-all-geometry', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(String.raw`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="fixture" style="position:relative;width:960px;height:640px"></div><script type="module">
      import { createDomAuthoring } from '/src/components/web/authoringDom.ts';
      import { LocalAuthorTransformGesture } from '/src/renderer/componentPlatform/surfaces/slide/freeTransformGesture.ts';
      import { shapeRuntimeImplementation } from '/src/components/shape/render.ts';
      import { defaultShapeData } from '/src/components/shape/data.ts';
      import { createTextComponentData } from '/src/components/text/data.ts';
      import { renderTextComponent,measureTextComponent,applyTextComponentLayout } from '/src/components/text/render.ts';
      import { mountPublishedCourseV3 } from '/src/player/componentPlatform/publishedPlayer.ts';
      import { createBlankCourseProjectV10 } from '/src/core/course/createCourseProjectV10.ts';
      import { createImageData } from '/src/components/image/data.ts';
      import { createTeacherControllerRuntimeImplementation } from '/src/components/teacher-controller/index.ts';
      window.api={createDomAuthoring,LocalAuthorTransformGesture,shapeRuntimeImplementation,defaultShapeData,createTextComponentData,renderTextComponent,measureTextComponent,applyTextComponentLayout};
      const frame=(width,height,x=0,y=0)=>({width,height,transform:[1,0,0,1,x,y]});
      window.mountFixture=async(mode,size)=>{
        await window.player?.dispose();const root=document.querySelector('#fixture');root.replaceChildren();
        const project=createBlankCourseProjectV10('Geometry'); const surface=project.surfaces[0];surface.id='S';surface.designSize=size??{width:960,height:640};surface.childIds=[];
        const add=(id,key,data,placement,children)=>{project.definitions[key]={id:key,role:'content',implementation:{kind:'builtin',key}};project.instances[id]={id,definitionId:key,data,...(placement?{frame:placement}:{}),...(children?{childIds:children}:{})};return id};
        const teacherId=project.global.overlay[0];project.instances[teacherId].data={...project.instances[teacherId].data,defaultCollapsed:false};
        project.global.overlay.push(add('logo','guoling.shape',{...defaultShapeData(),style:{...defaultShapeData().style,fillColor:'#ff0000'}},frame(120,80,20,20)));
        if(mode==='spatial'){surface.kind='spatial';surface.spatial={home:{x:0,y:0,zoom:1},frames:[]};surface.childIds=[add('world','guoling.shape',defaultShapeData(),frame(120,80,-60,-40))];}
        else if(mode==='flow'||mode==='flowHUD'){
          surface.kind='flow';for(const id of [...project.global.underlay,...project.global.overlay])if(mode==='flow'||id!==teacherId)delete project.instances[id];project.global={underlay:[],overlay:mode==='flowHUD'?[teacherId]:[]};surface.childIds=[add('section','guoling.document-block',{type:'section',title:{inlines:[{type:'text',text:'Section'}]},collapsedByDefault:false},undefined,['paragraph'])];
          add('paragraph','guoling.text',createTextComponentData('Nested paragraph '));
          const id=add('anchor','guoling.shape',defaultShapeData(),frame(40,40));project.instances[id].flowPlacement={space:'paper',plane:'overlay',paragraphAnchor:{blockId:'paragraph',xRatio:.5,offsetY:5}};surface.childIds.push(id);
          if(mode==='flowHUD'){project.instances[teacherId].frame.transform[4]=10000;project.instances[teacherId].frame.transform[5]=10000;for(let i=0;i<40;i++)surface.childIds.push(add('long'+i,'guoling.text',createTextComponentData('Long reading paragraph '+i)));}
        }else {surface.childIds=[add('box','guoling.shape',defaultShapeData(),frame(120,80,20,20))];}
        const {revision,...payload}=project;payload.schemaVersion=3;payload.definitions=Object.fromEntries(Object.entries(payload.definitions).map(([id,{dataSchema,...definition}])=>[id,definition]));
        window.player=await mountPublishedCourseV3(payload,root,{keyboardNavigation:false});window.project=project;window.teacherId=teacherId;
      };
      window.mountAuthor=async(mode)=>{
        await window.player?.dispose();const root=document.querySelector('#fixture');root.replaceChildren();
        await import('/src/renderer/styles/variables.css');await import('/src/renderer/styles/globals.css');
        const {React,createRoot,SlideLocationWorkspace}=await import('/tests/fixtures/auditAllGeometryReact.ts');
        const project=createBlankCourseProjectV10('Author'),teacher=structuredClone(project.instances[project.global.overlay[0]]);project.instances={};project.definitions={};project.global={underlay:[],overlay:[]};project.surfaces[0]={id:'S',kind:'slide',title:'Author',childIds:['text','shape'],designSize:{width:600,height:400}};
        const add=(id,key,data,placement)=>{project.definitions[key]={id:key,role:'content',implementation:{kind:'builtin',key}};project.instances[id]={id,definitionId:key,data,frame:placement};};
        add('text','guoling.text',createTextComponentData('BACK TEXT'),frame(200,80,50,50));add('shape','guoling.shape',defaultShapeData(),mode==='overlap'?frame(200,80,50,50):frame(100,80,380,180));
        if(mode==='line'){project.surfaces[0].childIds=['shape'];project.instances.shape.data=defaultShapeData('line');project.instances.shape.frame=frame(200,100,100,100);}
        if(mode==='guides'){const data=createImageData('image');data.safeAreas=[{id:'important',label:'正文',x:.1,y:.2,width:.5,height:.4}];add('image','guoling.image',data,frame(200,100,100,180));project.surfaces[0].childIds.push('image');}
        if(mode==='clip'){project.surfaces[0].designSize={width:600,height:120};project.instances.shape.frame=frame(100,80,380,100);project.global.overlay=['teacher','logo'];add('teacher','guoling.navigation',{...teacher.data,defaultCollapsed:false},teacher.frame);add('logo','guoling.shape',{...defaultShapeData(),style:{...defaultShapeData().style,fillColor:'#ff0000'}},frame(100,80,20,100));}
        let snapshot={project,documentId:'author',epoch:'e',surfaceId:'S',selectedInstanceIds:['shape'],canvasMode:'edit',contentEdit:null,drawTool:null,activation:1,activeStateId:null,assetUrls:{},editingScope:'scene'};
        const spot={id:'text-spot',instanceId:'text',mountGeneration:1,kind:'text',initialValue:'BACK TEXT',localBounds:frame(200,80)};window.authorCalls=[];const handles=new Map(),reactRoot=createRoot(root);
        const navigation={read:()=>({locationId:'S',interactive:snapshot.canvasMode==='run',scenes:[{id:'S',name:'Author'}],progress:null,collapsed:false,zoom:1,muted:false,fullscreen:false}),subscribe:()=>()=>{},canExecute:()=>true,execute:async()=>true,setCollapsed(){},moveBy(){},setZoom(){},resetView(){}};
        const paint=()=>reactRoot.render(React.createElement(SlideLocationWorkspace,{snapshot,ports,onAddImage(){},onAddVideo(){},onSelectImageAsset:async()=>null}));
        const capture=()=>({documentId:'author',epoch:'e',surfaceId:'S',activeStateId:null,project,editingProject:project,resources:{assets:{},components:{}},instanceIds:snapshot.selectedInstanceIds,instanceId:snapshot.selectedInstanceIds[0]??null});
        const ports={read:()=>snapshot,capture,commit:async edits=>{window.authorCalls.push(edits)},edit:async()=>{},select:ids=>{snapshot={...snapshot,selectedInstanceIds:[...ids]};window.authorSelection=[...ids];paint()},selectSurface(){},setCanvasMode:canvasMode=>{snapshot={...snapshot,canvasMode};paint()},setDrawTool(){},report:message=>window.authorCalls.push(message),paste(){},selectAll(){},authorSpots:()=>mode==='line'?[]:[spot],beginSpotEdit:async spot=>{window.authorCalls.push(spot.instanceId);return null},beginTextEdit:id=>{window.authorCalls.push(id);return null},updateDataDraft(){},commitTextEdit:async()=>{},cancelTextEdit(){},undo(){},redo(){},teacherController:navigation,
          onElement:(id,element)=>{handles.get(id)?.dispose();handles.delete(id);if(!element)return;const instance=project.instances[id],context={instance,root:element,scope:{isActive:()=>true,cleanup:()=>{},signal:new AbortController().signal},teacherController:navigation};if(id==='text')element.replaceChildren(renderTextComponent(document,instance.data));else if(id==='teacher')handles.set(id,createTeacherControllerRuntimeImplementation(navigation).mount(context));else if(id==='image'){element.style.background='#d7e6d3'}else handles.set(id,shapeRuntimeImplementation.mount(context))},onTargetElement(){},addTextNode(){},addFormulaNode(){},addRectangleNode(){},addShapeNode(){},addTableNode(){},addChartNode(){},addExternalComponentNode(){},drawShapeNode(){}};
        window.authorProject=project;window.setAuthorMode=ports.setCanvasMode;
        window.authorSelection=[...snapshot.selectedInstanceIds];paint();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));root.querySelector('main').style.width='100%';root.querySelector('main').style.height='100%';await new Promise(resolve=>requestAnimationFrame(resolve));
      };
      window.mountSpatialAuthor=async()=>{
        const root=document.querySelector('#fixture');root.replaceChildren();await import('/src/renderer/styles/variables.css');await import('/src/renderer/styles/globals.css');
        const {React,createRoot,SpatialLocationWorkspace}=await import('/tests/fixtures/auditAllGeometryReact.ts'),project=createBlankCourseProjectV10('Spatial');project.global={underlay:[],overlay:[]};project.instances={};project.definitions={'shape':{id:'shape',role:'content',implementation:{kind:'builtin',key:'guoling.shape'}}};
        const surface=project.surfaces[0];surface.id='S';surface.kind='spatial';surface.designSize={width:600,height:400};surface.childIds=['parent','healthy'];surface.spatial={home:{x:0,y:0,zoom:1},frames:[],semanticZoom:[{id:'hide',instanceIds:['parent'],minZoom:0,maxZoom:2,visible:false}],relations:[{id:'hidden-edge',kind:'line',sourceInstanceId:'child',targetInstanceId:'healthy'}]};
        project.instances.parent={id:'parent',definitionId:'shape',data:defaultShapeData(),frame:frame(160,100,-200,-80),childIds:['child']};project.instances.child={id:'child',definitionId:'shape',data:defaultShapeData(),frame:frame(80,50,10,10)};project.instances.healthy={id:'healthy',definitionId:'shape',data:defaultShapeData(),frame:frame(80,50,60,-50)};
        const reactRoot=createRoot(root);let selection=[];window.spatialCalls=[];
        const renderInstance=id=>{const instance=project.instances[id];return React.createElement('div',{key:id,'data-component-instance':id,style:{position:'absolute',left:0,top:0,width:instance.frame.width,height:instance.frame.height,transformOrigin:'0 0',transform:'matrix('+instance.frame.transform.join(',')+')',background:id==='healthy'?'#48a778':'#fcb'},ref:element=>{if(element&&id==='child')element.setAttribute('data-child-measured','true')}},...(instance.childIds??[]).map(renderInstance));};
        const paint=()=>reactRoot.render(React.createElement(SpatialLocationWorkspace,{documentId:'spatial',project,surface,view:{camera:{x:0,y:0,zoom:1},activeCameraFrameId:null,showCameraFrames:false,playbackPathId:null,playbackStepIndex:null,scope:'world',graphSelection:null},selectionIds:selection,canvasMode:'edit',renderInstance,captureTarget:()=>({project,editingProject:project,documentId:'spatial',epoch:'e',surfaceId:'S'}),onEdits:async()=>{},onSelect:ids=>{selection=[...ids];window.spatialSelection=selection;paint()},onCamera(){},onActivateFrame(){},onGraphSelect(){},onCanvasModeChange(){},onEditContent:id=>window.spatialCalls.push(id)}));
        paint();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));root.querySelector('main').style.width='100%';root.querySelector('main').style.height='100%';await new Promise(resolve=>requestAnimationFrame(resolve));
      };
      window.mountCrop=async()=>{const {React,createRoot,ImageCropOverlay}=await import('/tests/fixtures/auditAllGeometryReact.ts');createRoot(document.querySelector('#fixture')).render(React.createElement(ImageCropOverlay,{screen:{left:100,top:100,width:200,height:240},image:{frame:{x:100,y:170,width:100,height:80,transform:[2,0,0,3,100,170]},source:{width:100,height:80},crop:{left:0,top:0,right:0,bottom:0},fit:'stretch',cropX:.5,cropY:.5,flipX:false,flipY:false},source:{mimeType:'image/png'},onCommit:result=>window.cropResult=result,onCancel(){}}));await new Promise(resolve=>requestAnimationFrame(resolve))};
      window.mountSelection=async()=>{
        const {React,createRoot,NativeSelectionContext,useEditorStore,PlaybackViewSession,createPlaybackContent}=await import('/tests/fixtures/auditAllGeometryReact.ts');
        const fixture=document.querySelector('#fixture'),main=document.createElement('main');fixture.append(main);Object.assign(main.style,{position:'relative',width:'960px',height:'640px'});
        const project=createBlankCourseProjectV10('Selection'),surface=project.surfaces[0];project.global={underlay:[],overlay:[]};project.instances={shape:{id:'shape',definitionId:'shape',data:defaultShapeData(),frame:frame(100,80,120,240)}};project.definitions={shape:{id:'shape',role:'content',implementation:{kind:'builtin',key:'guoling.shape'}}};surface.id='S';surface.kind='flow';surface.childIds=['shape'];project.instances.shape.flowPlacement={space:'viewport',plane:'overlay'};
        const state=useEditorStore.getState();useEditorStore.setState({editingScope:'scene',slideContentEdit:null,courseView:{...state.courseView,activeDocumentId:'selection',project,editingProject:project,surfaceId:'S',activeStateId:null,selectedInstanceIds:['shape'],views:[],error:null}});
        const session=new PlaybackViewSession(),viewport=session.mount(main),host=document.createElement('div');host.dataset.flowPaperScroll='true';Object.assign(host.style,{position:'absolute',inset:0});viewport.append(host);const content=createPlaybackContent(host),shape=document.createElement('div');shape.dataset.componentInstance='shape';shape.dataset.playbackBounds='true';Object.assign(shape.style,{position:'absolute',left:'120px',top:'240px',width:'100px',height:'80px',background:'#559f7a'});content.append(shape);session.register({id:'S',kind:'flow',root:host,content});session.activate('S');
        const slot=document.createElement('div');main.append(slot);createRoot(slot).render(React.createElement(NativeSelectionContext,{revision:project.revision,locationId:'S',itemIds:['shape'],enabled:true,ownsDocumentSelection:false,bounds:()=>shape.getBoundingClientRect()}));window.selectionSession=session;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      };
      window.mountGenericGuide=async()=>{const {React,createRoot,InstanceView}=await import('/tests/fixtures/auditAllGeometryReact.ts'),root=document.querySelector('#fixture');root.replaceChildren();const project=createBlankCourseProjectV10('Guide'),data=createImageData('asset');data.safeAreas=[{id:'body-safe',label:'正文',x:.1,y:.2,width:.5,height:.4}];const instance={id:'body-image',definitionId:'image',data};project.definitions.image={id:'image',role:'content',implementation:{kind:'builtin',key:'guoling.image'}};project.instances[instance.id]=instance;const reactRoot=createRoot(root),paint=player=>reactRoot.render(React.createElement(InstanceView,{instance,project,surfaceId:project.surfaces[0].id,placement:'flow',selectedInstanceId:null,player,onSelect(){},onElement:(id,element)=>{if(element){element.style.height='120px';element.style.background='#dbdd93'}}}));window.genericGuideRun=()=>paint(true);paint(false);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))};
      window.mountGroupedCrop=async()=>{const {React,createRoot,NativeSelectionContext,useEditorStore,createV10StoreHost}=await import('/tests/fixtures/auditAllGeometryReact.ts'),fixture=document.querySelector('#fixture'),project=createBlankCourseProjectV10('GroupedCrop');project.global={underlay:[],overlay:[]};project.instances={};project.definitions={shape:{id:'shape',role:'content',implementation:{kind:'builtin',key:'guoling.shape'}},image:{id:'image',role:'content',implementation:{kind:'builtin',key:'guoling.image'}}};project.surfaces[0].childIds=['parent'];project.instances.parent={id:'parent',definitionId:'shape',data:defaultShapeData(),frame:{width:300,height:300,transform:[0,1,-1,0,400,100]},childIds:['image']};project.instances.image={id:'image',definitionId:'image',data:{...createImageData('asset'),fit:'stretch'},frame:{width:100,height:80,transform:[2,0,0,3,10,20]}};const bytes=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#71a999"/><rect width="25" height="10" fill="#e15151"/></svg>');project.assets.asset={id:'asset',path:'assets/image.svg',mimeType:'image/svg+xml',kind:'image',byteLength:bytes.length,width:100,height:80};const host=await createV10StoreHost(project,{assets:{asset:bytes},components:{}},false);await useEditorStore.getState().connectCourseDocuments(host.api);useEditorStore.getState().selectNode('image');window.cropHost=host;
        const main=document.createElement('main');Object.assign(main.style,{position:'relative',width:'960px',height:'640px'});fixture.append(main);const parent=document.createElement('div');Object.assign(parent.style,{position:'absolute',left:0,top:0,width:'300px',height:'300px',transformOrigin:'0 0',transform:'matrix(0,1,-1,0,400,100)'});main.append(parent);const image=document.createElement('div');image.dataset.componentInstance='image';Object.assign(image.style,{position:'absolute',left:0,top:0,width:'100px',height:'80px',transformOrigin:'0 0',transform:'matrix(2,0,0,3,10,20)',background:'#71a999'});parent.append(image);const slot=document.createElement('div');main.append(slot);createRoot(slot).render(React.createElement(NativeSelectionContext,{revision:project.revision,locationId:project.surfaces[0].id,itemIds:['image'],enabled:true,ownsDocumentSelection:false,bounds:()=>image.getBoundingClientRect()}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
      window.fixtureReady=true;
    </script></body></html>`)
  })
  await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('Missing fixture port')
  url = `http://127.0.0.1:${address.port}/__audit-all-geometry`; browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })
async function current(): Promise<Page> { const page = await browser.newPage(); await page.goto(url); await page.waitForFunction(() => Reflect.get(window, 'fixtureReady')); return page }
async function screenshot(page: Page, name: string) { await fs.mkdir(path.resolve('output/playwright/audit-all-geometry'), { recursive: true }); await page.screenshot({ path: path.resolve(`output/playwright/audit-all-geometry/${name}.png`) }) }

it('CA341/376 real CSS visibility and native paint winner determine internal authorKey', async () => {
  const page = await current()
  try {
    const result = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('#fixture')!
      root.innerHTML = '<div style="position:absolute;left:30px;top:30px;width:200px;height:60px;z-index:2;background:white;font:30px sans-serif">FRONT</div><div style="position:absolute;left:30px;top:30px;width:200px;height:60px;z-index:1;background:blue;font:30px sans-serif">BACK</div><p style="visibility:hidden">HIDDEN</p><img alt="hidden" style="visibility:hidden;width:40px;height:40px">'
      const adapter = Reflect.get(window, 'api').createDomAuthoring(root, { records: () => ({}) }), observations = adapter.scan(), winner = adapter.hit(55, 60)
      return { values: observations.map((value: { initialValue: string }) => value.initialValue), winner: winner?.initialValue, key: winner?.authorKey,
        paint: document.elementsFromPoint(55,60).map(node=>node.outerHTML.slice(0,140)), rect: (()=>{const range=document.createRange();range.selectNodeContents(root.firstElementChild!.firstChild!);return range.getBoundingClientRect().toJSON()})() }
    })
    expect(result.values).toEqual(['FRONT', 'BACK']); expect(result.winner, JSON.stringify(result)).toBe('FRONT'); expect(result.key).toMatch(/^dom-/)
    const covered=await page.evaluate(()=>{const root=document.querySelector<HTMLElement>('#fixture')!,cover=document.createElement('div');cover.id='cover';cover.style.cssText='position:absolute;left:30px;top:30px;width:200px;height:60px;z-index:3;background:white';root.append(cover);const adapter=Reflect.get(window,'api').createDomAuthoring(root,{records:()=>({})}),blocked=adapter.hit(55,60)?.initialValue,winner=document.elementsFromPoint(55,60)[0]!.id;cover.style.pointerEvents='none';return {blocked,winner,through:adapter.hit(55,60)?.initialValue}})
    expect(covered.winner).toBe('cover');expect(covered.blocked).toBeUndefined();expect(covered.through).toBe('FRONT')
    await screenshot(page, 'CA341-376-dom-hit')
  } finally { await page.close() }
})

it('CA230/292/311 real CSS calc translate percentages and own zoom keep drag and resize anchors', async () => {
  const page = await current()
  try {
    const result = await page.evaluate(() => {
      const api = Reflect.get(window, 'api'), root = document.querySelector<HTMLElement>('#fixture')!
      root.innerHTML = '<div style="position:absolute;left:20px;top:30px;width:100px;height:80px;translate:calc(50% + 10px) calc(25% + 8px);zoom:2;background:#d9bf73">Resize text</div>'
      const adapter = api.createDomAuthoring(root, { records: () => ({}) }), observed = adapter.scan()[0], node = root.firstElementChild as HTMLElement, before = node.getBoundingClientRect()
      const gesture = new api.LocalAuthorTransformGesture({ geometry: observed.geometry, kind: 'text', mode: 'resize', handle: 'e', rootToSurface: [1,0,0,1,0,0], surfaceToPointer: [1,0,0,1,0,0], pointer: {x:before.right,y:before.top+before.height/2} })
      const change = gesture.update({x:before.right+80,y:before.top+before.height/2}).geometry;adapter.previewGeometry(observed.authorKey,change)
      const resized = node.getBoundingClientRect();adapter.previewGeometry(observed.authorKey,null)
      const fresh = adapter.scan()[0], start = node.getBoundingClientRect(), drag = new api.LocalAuthorTransformGesture({geometry:fresh.geometry,kind:'text',mode:'drag',rootToSurface:[1,0,0,1,0,0],surfaceToPointer:[1,0,0,1,0,0],pointer:{x:start.left,y:start.top}})
      const moved = drag.update({x:start.left+40,y:start.top+20}).geometry;adapter.previewGeometry(fresh.authorKey,moved);const after=node.getBoundingClientRect()
      return {before:{x:before.left,y:before.top,width:before.width},resized:{x:resized.left,y:resized.top,width:resized.width},change,moved,delta:{x:after.left-start.left,y:after.top-start.top},hasGeometry:Boolean(observed.geometry)}
    })
    expect(result.hasGeometry).toBe(true); expect(result.resized.x).toBeCloseTo(result.before.x, 1); expect(result.resized.y).toBeCloseTo(result.before.y, 1)
    expect(result.resized.width - result.before.width).toBeCloseTo(80, 1); expect(result.delta.x).toBeCloseTo(40, 1); expect(result.delta.y).toBeCloseTo(20, 1)
    await screenshot(page, 'CA230-292-311-css-geometry')
  } finally { await page.close() }
})

it('CA184/322/359 actual shape canvas redraws placement, preserves subpixel stroke and parses white gradient', async () => {
  const page = await current()
  try {
    const result = await page.evaluate(() => {
      const api=Reflect.get(window,'api'),root=document.querySelector<HTMLElement>('#fixture')!;Object.assign(root.style,{width:'300px',height:'200px'})
      const data={...api.defaultShapeData(),style:{...api.defaultShapeData().style,borderWidth:.5,fillGradient:{kind:'linear',start:[0,0],end:[1,0],stops:[{offset:0,color:'#fff',opacity:1},{offset:1,color:'#000',opacity:1}]}}}
      const handle=api.shapeRuntimeImplementation.mount({instance:{id:'shape',definitionId:'shape',data,frame:{width:100,height:80,transform:[1,0,0,1,40,40]}},root,scope:{isActive:()=>true,cleanup:()=>{}}});const canvas=root.querySelector('canvas')!,ctx=canvas.getContext('2d')!
      const pixel=Array.from(ctx.getImageData(5-parseFloat(canvas.style.left),40-parseFloat(canvas.style.top),1,1).data), thinAlpha=ctx.getImageData(1,42,1,1).data[3],old=canvas.width;handle.updatePlacement({width:200,height:80,transform:[1,0,0,1,40,40]});const placementWidth=canvas.width
      const thick={...data,style:{...data.style,borderWidth:40,fillGradient:undefined}};handle.update({id:'shape',definitionId:'shape',data:thick,frame:{width:100,height:80,transform:[1,0,0,1,0,0]}})
      return {pixel,old,placementWidth,thinAlpha,envelope:{width:canvas.width,height:canvas.height,left:parseFloat(canvas.style.left),top:parseFloat(canvas.style.top)}}
    })
    expect(result.pixel[0]).toBeGreaterThan(220);expect(result.pixel[0]).toBe(result.pixel[2]);expect(result.old).toBe(104)
    expect(result.placementWidth-result.old).toBe(100);expect(result.thinAlpha).toBeGreaterThan(0);expect(result.thinAlpha).toBeLessThan(120)
    expect(result.envelope.width).toBe(142);expect(result.envelope.left).toBe(-21)
    await screenshot(page,'CA184-322-359-shape')
  } finally { await page.close() }
})

it('CA367/368 actual elbow arrow uses its nearest nonzero tangent and brace pair occupies separate halves',async()=>{
  const page=await current()
  try{
    const result=await page.evaluate(()=>{const api=Reflect.get(window,'api'),root=document.querySelector<HTMLElement>('#fixture')!,base=api.defaultShapeData('elbow-arrow'),data={...base,lineGeometry:{kind:'elbow',start:[0,0],end:[1,1],axis:'horizontal',position:1},style:{...base.style,borderWidth:2,endArrow:'triangle'}};
      const handle=api.shapeRuntimeImplementation.mount({instance:{id:'arrow',definitionId:'shape',data,frame:{width:100,height:100,transform:[1,0,0,1,0,0]}},root,scope:{isActive:()=>true,cleanup:()=>{}}}),canvas=root.querySelector('canvas')!,ctx=canvas.getContext('2d')!,arrow=ctx.getImageData(104-parseFloat(canvas.style.left),91-parseFloat(canvas.style.top),1,1).data[3];
      handle.update({id:'arrow',definitionId:'shape',data:api.defaultShapeData('brace-pair-horizontal'),frame:{width:100,height:100,transform:[1,0,0,1,0,0]}});
      const y=50-parseFloat(canvas.style.top),left=[] as number[];for(let x=0;x<canvas.width;x++)if(ctx.getImageData(x,y,1,1).data[3]>128)left.push(x+parseFloat(canvas.style.left));return {arrow,midline:left}})
    expect(result.arrow).toBeGreaterThan(0);expect(result.midline.some(x=>x<10)).toBe(true);expect(result.midline.some(x=>x>90)).toBe(true);expect(result.midline.some(x=>x>40&&x<60)).toBe(false)
    await screenshot(page,'CA367-368-arrows-braces')
  }finally{await page.close()}
})

it('CA072/086/215 real Published portrait fits once and consumes formal global sibling order', async () => {
  const page=await current()
  try {
    await page.evaluate(()=>Reflect.get(window,'mountFixture')('slide',{width:600.5,height:1200.25}))
    const result=await page.evaluate(()=>{const shell=document.querySelector<HTMLElement>('[data-component-model-player]')!, host=document.querySelector<HTMLElement>('[data-playback-content]')!.parentElement!, layer=document.querySelector('[data-component-plane="overlay"]')!;return {shell:shell.style.transform,width:host.style.width,scale:host.dataset.stageFitScale,height:host.getBoundingClientRect().height,order:Array.from(layer.children).map(node=>(node as HTMLElement).dataset.componentObject),teacher:Reflect.get(window,'teacherId')}})
    expect(result.shell).toBe('none');expect(result.width).toBe('600.5px');expect(result.height).toBeGreaterThan(640);expect(result.order).toEqual([result.teacher,'logo'])
    await screenshot(page,'CA072-086-215-portrait')
    await page.evaluate(async()=>{const player=Reflect.get(window,'player'), project=Reflect.get(window,'project');project.surfaces[0].designSize={width:200.5,height:150.25};await player.update({kind:'course-v10',project,resources:{assets:{},components:{}}})})
    expect(await page.locator('[data-playback-content]').evaluate(node=>node.parentElement!.style.width)).toBe('200.5px')
  } finally {await page.close()}
},30_000)

it('CA026/288 real Published Spatial observes world and ordinary HUD after camera while teacher remains fixed; disabled teacher has no hit',async()=>{
  const page=await current()
  try {
    await page.evaluate(()=>Reflect.get(window,'mountFixture')('spatial'))
    const before=await page.evaluate(()=>{const rect=(id:string)=>{const box=Reflect.get(window,'player').runtime.targetElement(id).getBoundingClientRect();return {x:box.left,y:box.top,width:box.width}};return {world:rect('world'),logo:rect('logo'),teacher:rect(Reflect.get(window,'teacherId')),camera:Reflect.get(window,'player').runtime.targetElement('world').parentElement.style.transform}})
    await page.evaluate(()=>Reflect.get(window,'player').navigation.setZoom(1.5))
    const after=await page.evaluate(()=>{const rect=(id:string)=>{const box=Reflect.get(window,'player').runtime.targetElement(id).getBoundingClientRect();return {x:box.left,y:box.top,width:box.width}};return {world:rect('world'),logo:rect('logo'),teacher:rect(Reflect.get(window,'teacherId')),zoom:Reflect.get(window,'player').navigation.read().zoom}})
    expect(after.zoom).toBe(1.5);expect(after.world.width/before.world.width).toBeCloseTo(1.5);expect(after.logo.width/before.logo.width).toBeCloseTo(1.5);expect(after.teacher).toEqual(before.teacher)
    await page.evaluate(async()=>{const player=Reflect.get(window,'player'),project=Reflect.get(window,'project');project.instances[Reflect.get(window,'teacherId')].data.enabled=false;await player.update({kind:'course-v10',project,resources:{assets:{},components:{}}})})
    expect(await page.evaluate(()=>Reflect.get(window,'player').runtime.targetElement(Reflect.get(window,'teacherId')).hidden)).toBe(true)
    await screenshot(page,'CA026-288-spatial')
  }finally{await page.close()}
},30_000)

it('CA375 real vertical automatic text grows width while fixed clips within the unchanged frame',async()=>{
  const page=await current()
  try{
    const result=await page.evaluate(()=>{const api=Reflect.get(window,'api'),root=document.querySelector<HTMLElement>('#fixture')!,data=api.createTextComponentData('纵向文字反复填入用于检查列增长。'.repeat(12));data.appearance.writingMode='vertical-rl';data.appearance.fontSize=24;const element=api.renderTextComponent(document,data);root.append(element);const result=api.measureTextComponent(element,{width:50,height:140},data.sizing);api.applyTextComponentLayout(element,result);return {result,width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}})
    expect(result.result.width).toBeGreaterThan(50);expect(result.result.height).toBe(140);expect(result.width).toBeGreaterThan(50);expect(result.height).toBe(140)
    await screenshot(page,'CA375-vertical')
  }finally{await page.close()}
})

it('CA182/133 real nested Flow paragraph anchor follows intrinsic reflow and has its formal rich-link target',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountFixture')('flow'))
    const delta=()=>page.evaluate(()=>{const paragraph=document.querySelector<HTMLElement>('#paragraph')!,anchor=document.querySelector<HTMLElement>('#anchor')!;return {delta:anchor.getBoundingClientRect().top-paragraph.getBoundingClientRect().top,top:anchor.getBoundingClientRect().top,paragraph:paragraph.getBoundingClientRect().top}})
    const before=await delta();expect(before.delta).toBeGreaterThan(0);expect(before.delta).toBeLessThan(10)
    await page.evaluate(()=>{const paragraph=document.querySelector('#paragraph')!,spacer=document.createElement('div');spacer.style.height='100px';paragraph.parentElement!.insertBefore(spacer,paragraph)})
    await expect.poll(async()=>(await delta()).top).toBeGreaterThan(before.top+90)
    expect((await delta()).delta).toBeCloseTo(before.delta,1)
    await screenshot(page,'CA182-133-nested-flow-anchor')
  }finally{await page.close()}
},30_000)

it('CA073/332 actual author workspace preserves Shift selection and foreground blocks behind text double click',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountAuthor')('separate'))
    const point=await page.locator('[data-component-instance="text"]').boundingBox();if(!point)throw Error('Missing author text')
    await page.keyboard.down('Shift');await page.mouse.click(point.x+30,point.y+30);await page.keyboard.up('Shift')
    expect(await page.evaluate(()=>Reflect.get(window,'authorSelection'))).toEqual(['shape','text'])
    await screenshot(page,'CA073-author-shift-selection')
    await page.evaluate(()=>Reflect.get(window,'mountAuthor')('overlap'))
    const overlap=await page.locator('[data-component-instance="shape"]').boundingBox();if(!overlap)throw Error('Missing foreground shape')
    await page.mouse.dblclick(overlap.x+30,overlap.y+30)
    expect(await page.evaluate(()=>Reflect.get(window,'authorCalls'))).toEqual([])
    await page.mouse.click(overlap.x+30,overlap.y+30,{button:'right'})
    expect(await page.evaluate(()=>Reflect.get(window,'authorSelection'))).toEqual(['shape'])
    const canvas=page.locator('[data-component-instance="shape"] canvas');expect(await canvas.evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThan(overlap.width)
    await screenshot(page,'CA332-author-front-shape')
  }finally{await page.close()}
},30_000)

it('CA160/222 actual author default line has endpoint handles and previews on its live shape canvas before one commit',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountAuthor')('line'))
    expect(await page.locator('[data-line-handle]').count()).toBe(2)
    const end=await page.locator('[data-line-handle="end"]').boundingBox();if(!end)throw Error('Missing default line endpoint')
    const before=await page.locator('[data-component-instance="shape"] canvas').evaluate((canvas:HTMLCanvasElement)=>({width:canvas.width,height:canvas.height}))
    await page.mouse.move(end.x+end.width/2,end.y+end.height/2);await page.mouse.down();await page.keyboard.down('Alt');await page.mouse.move(end.x+end.width/2+60,end.y+end.height/2-50,{steps:3})
    const during=await page.locator('[data-component-instance="shape"] canvas').evaluate((canvas:HTMLCanvasElement)=>{
      const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let ink=0,maxX=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]!>20){ink++;maxX=Math.max(maxX,x)}return {width:canvas.width,height:canvas.height,ink,maxX}
    })
    expect(during.width).toBeGreaterThan(before.width+25);expect(during.height).toBeLessThan(before.height-20);expect(during.maxX).toBeGreaterThan(before.width);expect(during.ink).toBeGreaterThan(100)
    expect(await page.evaluate(()=>Reflect.get(window,'authorProject').instances.shape.data.lineGeometry)).toBeUndefined()
    expect(await page.evaluate(()=>Reflect.get(window,'authorCalls'))).toEqual([])
    await screenshot(page,'CA160-222-live-line-preview');await page.mouse.up();await page.keyboard.up('Alt')
    const calls=await page.evaluate(()=>Reflect.get(window,'authorCalls'));expect(calls).toHaveLength(1);expect(calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({type:'frame.set'}),expect.objectContaining({type:'data.set',path:['lineGeometry']})]))
  }finally{await page.close()}
},30_000)

it('CA248 author safe area guide uses the saved image fractions and disappears in run mode',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountAuthor')('guides'))
    const guide=page.locator('[data-image-safe-area="important"]');expect(await guide.count()).toBe(1)
    expect(await guide.evaluate(rect=>[rect.getAttribute('x'),rect.getAttribute('y'),rect.getAttribute('width'),rect.getAttribute('height')])).toEqual(['10%','20%','50%','40%'])
    const guideRect=await guide.boundingBox(),image=await page.locator('[data-component-instance="image"]').boundingBox();expect(Math.abs(guideRect!.width-image!.width*.5)).toBeLessThan(2);expect(Math.abs(guideRect!.y-image!.y-image!.height*.2)).toBeLessThan(2)
    await screenshot(page,'CA248-author-image-safe-area');await page.evaluate(()=>Reflect.get(window,'setAuthorMode')('run'));expect(await guide.count()).toBe(0)
    await page.evaluate(()=>Reflect.get(window,'mountGenericGuide')());expect(await page.locator('[data-image-safe-area="body-safe"]').count()).toBe(1)
    const generic=await page.locator('[data-image-safe-area="body-safe"]').boundingBox();expect(generic!.height).toBeGreaterThan(45);expect(generic!.height).toBeLessThan(50)
    await screenshot(page,'CA248-natural-flow-image-guide');await page.evaluate(()=>Reflect.get(window,'genericGuideRun')());expect(await page.locator('[data-image-safe-area-guides]').count()).toBe(0)
  }finally{await page.close()}
},30_000)

it('CA086/215 actual author teacher stays in the viewport while ordinary surface and global canvas paint clip at the page',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountAuthor')('clip'));await page.evaluate(()=>Reflect.get(window,'setAuthorMode')('run'))
    const value=await page.evaluate(()=>{
      const stage=document.querySelector<HTMLElement>('.canvas-stage')!,teacher=document.querySelector<HTMLElement>('[data-component-instance="teacher"]')!,ordinary=document.querySelector<HTMLElement>('[data-component-instance="logo"]')!,surface=document.querySelector<HTMLElement>('[data-component-instance="shape"]')!;
      const page=stage.getBoundingClientRect(),hud=teacher.getBoundingClientRect(),logo=ordinary.getBoundingClientRect(),box=surface.getBoundingClientRect();const winner=(x:number,y:number)=>document.elementFromPoint(x,y)?.closest('[data-component-instance]')?.getAttribute('data-component-instance');
      return {page:page.toJSON(),hud:hud.toJSON(),teacherHit:winner(hud.left+Math.min(hud.width/2,50),hud.bottom-20),globalBeyond:winner(logo.left+30,page.bottom+15),surfaceBeyond:winner(box.left+30,page.bottom+15),canvasWidth:ordinary.querySelector('canvas')!.getBoundingClientRect().width}
    })
    expect(value.hud.bottom).toBeGreaterThan(value.page.bottom+20);expect(value.teacherHit).toBe('teacher');expect(value.globalBeyond).not.toBe('logo');expect(value.surfaceBeyond).not.toBe('shape');expect(value.canvasWidth).toBeGreaterThan(100)
    await screenshot(page,'CA086-215-author-teacher-page-clip')
  }finally{await page.close()}
},30_000)

it('CA075 actual Spatial hidden parent blocks child click, editing and relation paint while a healthy object remains editable',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountSpatialAuthor')())
    const child=await page.locator('[data-component-instance="child"]').boundingBox();if(!child)throw Error('Missing measured child')
    expect(await page.locator('[data-component-instance="child"]').evaluate(node=>getComputedStyle(node).visibility)).toBe('hidden')
    await page.mouse.dblclick(child.x+20,child.y+20);expect(await page.evaluate(()=>Reflect.get(window,'spatialCalls'))).toEqual([])
    expect(await page.locator('[data-spatial-relation-id="hidden-edge"]').count()).toBe(0)
    const healthy=await page.locator('[data-component-instance="healthy"]').boundingBox();if(!healthy)throw Error('Missing healthy object')
    await page.mouse.dblclick(healthy.x+20,healthy.y+20);expect(await page.evaluate(()=>Reflect.get(window,'spatialCalls'))).toEqual(['healthy'])
    await screenshot(page,'CA075-spatial-hidden-parent')
  }finally{await page.close()}
},30_000)

it('CA164 actual long Flow teacher HUD excludes native scrollbar and observation control strips',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountFixture')('flowHUD'))
    const result=await page.evaluate(()=>{const viewport=document.querySelector<HTMLElement>('[data-playback-view]')!,scroll=document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!,teacher=document.querySelector<HTMLElement>('[data-component-instance-id="'+Reflect.get(window,'teacherId')+'"]')!;return {view:viewport.getBoundingClientRect().toJSON(),teacher:teacher.getBoundingClientRect().toJSON(),native:{right:scroll.offsetWidth-scroll.clientWidth,bottom:scroll.offsetHeight-scroll.clientHeight},scrollable:scroll.scrollHeight>scroll.clientHeight}})
    expect(result.scrollable).toBe(true);expect(result.teacher.right).toBeLessThanOrEqual(result.view.right-result.native.right-17);expect(result.teacher.bottom).toBeLessThanOrEqual(result.view.bottom-result.native.bottom-17)
    await screenshot(page,'CA164-flow-teacher-scrollbar-budget')
  }finally{await page.close()}
},30_000)

it('CA312 real crop overlay maps independent screen scales and commits its kept origin through the authored affine',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountCrop')())
    const corner=await page.locator('.image-crop__handle[data-handle="nw"]').boundingBox();if(!corner)throw Error('Missing crop corner')
    await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();await page.mouse.move(corner.x+corner.width/2+50,corner.y+corner.height/2+30,{steps:3});await page.mouse.up()
    const kept=await page.getByTestId('image-crop-box').boundingBox();expect(kept).toMatchObject({x:150,y:130,width:150,height:210})
    await screenshot(page,'CA312-affine-crop');await page.getByRole('button',{name:'完成',exact:true}).click()
    expect(await page.evaluate(()=>Reflect.get(window,'cropResult'))).toMatchObject({frame:{x:150,y:200,width:75,height:70},crop:{left:.25,top:.125,right:0,bottom:0}})
  }finally{await page.close()}
},30_000)

it('CA220 actual Flow observation zoom moves the selected object toolbar without a teacher controller',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountSelection')())
    const bar=page.getByRole('toolbar',{name:'选中对象快捷工具'}),before=await bar.boundingBox();if(!before)throw Error('Missing selected object toolbar')
    const beforeShape=await page.locator('[data-component-instance="shape"]').boundingBox();if(!beforeShape)throw Error('Missing selected shape')
    await page.evaluate(()=>Reflect.get(window,'selectionSession').zoomTo(1.5,{x:0,y:0}))
    await expect.poll(async()=>(await bar.boundingBox())?.y??0).toBeGreaterThan(before.y+40)
    const after=await bar.boundingBox(),afterShape=await page.locator('[data-component-instance="shape"]').boundingBox();expect(after!.x-before.x).toBeCloseTo(afterShape!.x-beforeShape.x,1)
    expect(await page.locator('[aria-label="教师控制台"]').count()).toBe(0);await screenshot(page,'CA220-flow-observation-selection-toolbar')
  }finally{await page.close()}
},30_000)

it('CA312 actual Native grouped image crop follows a rotated parent and persists the child local affine',async()=>{
  const page=await current()
  try{
    await page.evaluate(()=>Reflect.get(window,'mountGroupedCrop')());await page.getByRole('button',{name:'裁剪',exact:true}).click()
    const corner=await page.locator('.image-crop__handle[data-handle="nw"]').boundingBox();if(!corner)throw Error('Missing grouped crop corner')
    expect(corner.x+corner.width/2).toBeCloseTo(380,0);expect(corner.y+corner.height/2).toBeCloseTo(110,0)
    await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();await page.mouse.move(corner.x+corner.width/2-30,corner.y+corner.height/2+50,{steps:3});await page.mouse.up()
    await screenshot(page,'CA312-grouped-rotated-crop');await page.mouse.click(380,110)
    await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'cropHost').model().project.instances.image.frame)).toEqual({width:75,height:70,transform:[2,0,0,3,60,50]})
    expect(await page.evaluate(()=>Reflect.get(window,'cropHost').model().project.instances.parent.frame.transform)).toEqual([0,1,-1,0,400,100])
  }finally{await page.close()}
},30_000)
