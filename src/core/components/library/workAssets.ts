import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentDefinition, ComponentImplementation, ComponentInstance, JsonValue } from '../../../shared/contracts/component-platform/project'
import { createTextComponentData } from '../../../components/text/data'
import { defaultShapeData } from '../../../components/shape/data'
import { createImageData } from '../../../components/image/data'
import { getBuiltinComponentSource, loadBuiltinComponentSource } from '../source/builtinSources'

export type BuiltInWorkAssetMetadata = Pick<ComponentLibraryEntry, 'id' | 'title' | 'kind' | 'usage'>

const frame = (width: number, height: number, x = 0, y = 0) => ({ width, height, transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number] })
const json = (value: unknown): JsonValue => value as JsonValue
const source = (code: string): Extract<ComponentImplementation, { kind: 'source' }> => ({ kind: 'source', language: 'javascript', source: code })
const definition = (id: string, implementation: ComponentImplementation, title = id, role: ComponentDefinition['role'] = 'content'): ComponentDefinition => ({ id, title, role, version: '1.0.0', implementation })
const text = (id: string, value: string, x = 24, y = 24): ComponentInstance => ({ id, definitionId: 'guoling.text', name: value, data: json(createTextComponentData(value)), frame: frame(560, 56, x, y) })
const shape = (id: string, color = '#38bdf8', x = 24, y = 100): ComponentInstance => {
  const data = defaultShapeData('rounded-rectangle'); data.style.fillColor = color
  return { id, definitionId: 'guoling.shape', name: '可编辑图形', data: json(data), frame: frame(220, 120, x, y) }
}
const nativeDefinitions = () => ({
  'guoling.text': definition('guoling.text', { kind: 'builtin', key: 'guoling.text' }, '文字'),
  'guoling.shape': definition('guoling.shape', { kind: 'builtin', key: 'guoling.shape' }, '形状'),
})
const container = (id: string, kind: 'slide' | 'flow' | 'spatial', childIds: string[], name: string): ComponentInstance => ({
  id, definitionId: `guoling.container.${kind}`, name, data: {}, childIds, frame: frame(640, 360),
  container: { kind, designSize: { width: 640, height: 360 },
    ...(kind === 'flow' ? { flow: { layout: { readingWidth: 640, wideContentWidth: 900, widthMode: 'reading' as const } } } : {}),
    ...(kind === 'spatial' ? { spatial: { home: { x: 320, y: 180, zoom: 1 }, frames: [] } } : {}) },
})
const containerDefinition = (kind: 'slide' | 'flow' | 'spatial') => definition(`guoling.container.${kind}`, { kind: 'builtin', key: `guoling.container.${kind}` }, `${kind} 容器`)
const entry = (metadata: BuiltInWorkAssetMetadata, instances: ComponentInstance[], rootIds: string[], definitions: ComponentDefinition[]): ComponentLibraryEntry => ({
  schemaVersion: 2, ...metadata, definitions: Object.fromEntries(definitions.map(value => [value.id, value])),
  example: { instances: Object.fromEntries(instances.map(value => [value.id, value])), rootIds }, assets: {}, resources: { assets: {}, components: {} },
})

/** Complete source program: internal drawing/input stays local, shared values use the existing runtime. */
export const WORK_PROGRAM_SOURCE = `export default { mount(c) {
  const root=c.root, doc=root.ownerDocument; let instance=c.instance, count=0, phase=0, handle=0, suspended=false, disposed=false;
  const title=doc.createElement('h2'), controls=doc.createElement('div'), input=doc.createElement('input'), button=doc.createElement('button'), output=doc.createElement('output'), canvas=doc.createElement('canvas');
  Object.assign(root.style,{boxSizing:'border-box',padding:'20px',fontFamily:'sans-serif',background:'#f0f9ff',color:'#0f172a',overflow:'auto'});
  input.type='number';input.value=String(instance.data.speed??1);input.setAttribute('aria-label','运动速度');button.textContent='记录一次';controls.append(input,button,output);root.append(title,controls,canvas);
  const paint=()=>{title.textContent=instance.data.title??'自主程序';output.textContent=' 已记录 '+count+' 次';};
  const click=()=>{count++;c.scope.state.set('count',count);paint();};button.addEventListener('click',click);
  const draw=()=>{if(disposed||suspended)return;canvas.width=Math.max(100,root.clientWidth-40);canvas.height=180;const g=canvas.getContext('2d');if(g){g.clearRect(0,0,canvas.width,canvas.height);g.fillStyle=instance.data.color??'#0284c7';g.beginPath();g.arc(30+(Math.sin(phase)+1)*(canvas.width-60)/2,90,18,0,Math.PI*2);g.fill();}phase+=.025*(Number(input.value)||1);handle=requestAnimationFrame(draw);};
  const dispose=()=>{disposed=true;cancelAnimationFrame(handle);button.removeEventListener('click',click);title.remove();controls.remove();canvas.remove();};c.scope.cleanup(dispose);paint();draw();
  return {update(next){instance=next;paint();},suspend(){suspended=true;cancelAnimationFrame(handle);},resume(){if(!disposed&&suspended){suspended=false;draw();}},dispose};
}};`

/** Uses the bound owner; no copied source contains an authored container identity. */
const PRESENTATION_CONTROL_SOURCE = `export default {mount(c){const doc=c.root.ownerDocument,bar=doc.createElement('div');let current=c.instance;
  const buttons=['overview','detail'].map((state,index)=>{const b=doc.createElement('button');b.textContent=index?'查看细节':'返回概览';b.onclick=()=>{const target=c.interactions?.currentSurfaceId();if(target)c.teacherController?.execute({type:'scene.go',sceneId:target,targetStateId:state});};bar.append(b);return b;});c.root.append(bar);
  const dispose=()=>{buttons.forEach(b=>b.onclick=null);bar.remove();};c.scope.cleanup(dispose);return{update(next){current=next;bar.style.gap=String(current.data.gap??8)+'px';},dispose};}};`

const CAMERA_CONTROL_SOURCE = `export default {mount(c){const b=c.root.ownerDocument.createElement('button');b.textContent='下一个镜头';b.onclick=()=>c.teacherController?.execute({type:'step.next',camera:{durationMs:c.instance.data.durationMs??450,easing:'ease-in-out'}});c.root.append(b);const dispose=()=>{b.onclick=null;b.remove();};c.scope.cleanup(dispose);return{update(){},dispose};}};`

/** The actual control composes a custom transition; navigation still owns snapshots, cancellation and commit. */
export const WORK_TRANSITION_CONTROL_SOURCE = `export default {mount(c){const b=c.root.ownerDocument.createElement('button');let instance=c.instance;b.textContent='带转场继续';
  b.onclick=()=>{const distance=Number(instance.data.distance??18),duration=Number(instance.data.durationMs??420);return c.teacherController?.execute({type:'step.next',transition:{durationMs:duration,easing:'ease-in-out',outgoing:{keyframes:[{opacity:1,transform:'translateY(0px)'},{opacity:0,transform:'translateY(-'+distance+'px)'}]},incoming:{keyframes:[{opacity:0,transform:'translateY('+distance+'px)'},{opacity:1,transform:'translateY(0px)'}]}}});};c.root.append(b);
  const dispose=()=>{b.onclick=null;b.remove();};c.scope.cleanup(dispose);return{update(next){instance=next;},dispose};}};`

export const WORK_BACKGROUND_SOURCE = `export default {mount(c){const root=c.root,doc=root.ownerDocument,canvas=doc.createElement('canvas');let instance=c.instance,phase=0,handle=0,disposed=false,suspended=false,stateKey=instance.stateBindings?.energy??'energy';
  Object.assign(root.style,{pointerEvents:'none',overflow:'hidden'});canvas.setAttribute('aria-hidden','true');Object.assign(canvas.style,{display:'block',width:'100%',height:'100%',pointerEvents:'none'});root.append(canvas);
  const draw=()=>{if(disposed||suspended)return;canvas.width=Math.max(1,root.clientWidth);canvas.height=Math.max(1,root.clientHeight);const g=canvas.getContext('2d');if(g){const energy=Number(c.scope.state.get(stateKey)??instance.data.energy??.45),gradient=g.createLinearGradient(0,0,canvas.width,canvas.height);gradient.addColorStop(0,instance.data.color??'#dbeafe');gradient.addColorStop(1,'#f0fdfa');g.fillStyle=gradient;g.fillRect(0,0,canvas.width,canvas.height);g.fillStyle=instance.data.accent??'#38bdf8';g.globalAlpha=.2;for(let i=0;i<12;i++){const x=(i+.5)*canvas.width/12,y=canvas.height/2+Math.sin(phase+i*.7)*canvas.height*.25*energy;g.beginPath();g.arc(x,y,4+energy*14,0,Math.PI*2);g.fill();}g.globalAlpha=1;}phase+=.018;handle=requestAnimationFrame(draw);};
  let off=c.scope.state.subscribe(stateKey,()=>{});const dispose=()=>{disposed=true;cancelAnimationFrame(handle);off();canvas.remove();};c.scope.cleanup(dispose);draw();return{update(next){instance=next;const nextKey=instance.stateBindings?.energy??'energy';if(nextKey!==stateKey){off();stateKey=nextKey;off=c.scope.state.subscribe(stateKey,()=>{});}},suspend(){suspended=true;cancelAnimationFrame(handle);},resume(){if(suspended&&!disposed){suspended=false;draw();}},dispose};}};`

function containerAsset(kind: 'slide' | 'flow' | 'spatial', metadata: BuiltInWorkAssetMetadata) {
  const root = container('container', kind, ['heading', 'object'], `${kind} 容器`)
  const heading = text('heading', kind === 'flow' ? '从这里开始阅读' : kind === 'spatial' ? '在空间中探索' : '在画面中自由构图')
  if (kind === 'flow') { delete heading.frame }
  return entry(metadata, [root, heading, shape('object')], [root.id], [containerDefinition(kind), ...Object.values(nativeDefinitions())])
}

function programAsset(metadata: BuiltInWorkAssetMetadata) {
  return entry(metadata, [{ id: 'program', definitionId: 'program-definition', name: '自主程序', data: { title: '输入、运动与记录', speed: 1, color: '#0284c7' }, frame: frame(640, 360) }], ['program'],
    [definition('program-definition', source(WORK_PROGRAM_SOURCE), '自主程序')])
}

function presentationAsset(metadata: BuiltInWorkAssetMetadata) {
  const root = container('presentation', 'slide', ['heading', 'object', 'native-control', 'source-control', 'rules'], '局部呈现状态')
  root.container!.presentation = { initialStateId: 'overview', states: [
    { id: 'overview', title: '概览', overrides: {} },
    { id: 'detail', title: '细节', overrides: { object: { frame: frame(320, 180, 100, 90), style: { opacity: .75 } } } },
  ] }
  const native = shape('native-control', '#86efac', 24, 260); native.frame = frame(180, 48, 24, 260); native.name = '原生控件：查看细节'
  const rules: ComponentInstance = { id: 'rules', definitionId: 'guoling.interactions', name: '原生状态动作', data: { rules: [{ id: 'show-detail', enabled: true, trigger: { type: 'node.click', nodeId: native.id }, conditions: [], actions: [{ id: 'show-detail-action', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'detail' } }] }] } }
  return entry(metadata, [root, text('heading', '同一对象的两个呈现状态'), shape('object'), native, rules,
    { id: 'source-control', definitionId: 'presentation-control', data: { gap: 8 }, frame: frame(350, 44, 230, 265) }], [root.id],
    [containerDefinition('slide'), ...Object.values(nativeDefinitions()), definition('guoling.interactions', { kind: 'builtin', key: 'guoling.interactions' }, '原生动作', 'behavior'), definition('presentation-control', source(PRESENTATION_CONTROL_SOURCE), '程序状态控件')])
}

function cameraAsset(metadata: BuiltInWorkAssetMetadata) {
  const root = container('camera', 'spatial', ['heading', 'near', 'far', 'camera-control'], '镜头路径')
  root.container!.spatial = { home: { x: 320, y: 180, zoom: 1 }, frames: [
    { id: 'overview', title: '概览', pose: { x: 320, y: 180, zoom: 1 } },
    { id: 'detail', title: '聚焦远处', pose: { x: 900, y: 180, zoom: 1.5 }, targetInstanceId: 'far' },
  ], paths: [{ id: 'path', title: '观察路线', frameIds: ['overview', 'detail'] }] }
  return entry(metadata, [root, text('heading', '沿现有镜头能力移动'), shape('near'), shape('far', '#a78bfa', 800, 120),
    { id: 'camera-control', definitionId: 'camera-control-definition', data: { durationMs: 450 }, frame: frame(180, 46, 24, 280) }], [root.id],
    [containerDefinition('spatial'), ...Object.values(nativeDefinitions()), definition('camera-control-definition', source(CAMERA_CONTROL_SOURCE), '镜头动作控件')])
}

function backgroundAsset(scene: boolean, metadata: BuiltInWorkAssetMetadata) {
  const instance: ComponentInstance = { id: 'background', definitionId: 'background-definition', name: scene ? '联动场景背景' : '环境背景', data: { energy: scene ? .7 : .25, color: scene ? '#e0e7ff' : '#dbeafe', accent: '#38bdf8' }, frame: frame(640, 360),
    style: { 'pointer-events': 'none' }, ...(scene ? { stateBindings: { energy: 'environmentEnergy' } } : {}) }
  const result = entry(metadata, [instance], [instance.id], [definition('background-definition', source(WORK_BACKGROUND_SOURCE), '可执行背景')])
  if (scene) result.logic = { courseState: [{ key: 'environmentEnergy', valueType: 'number', defaultValue: .7 }], navigationGuards: [] }
  return result
}

function transitionAsset(metadata: BuiltInWorkAssetMetadata) {
  return entry(metadata, [{ id: 'transition', definitionId: 'transition-definition', data: { rules: [] }, name: '导航转场配置' }], ['transition'],
    [definition('transition-definition', { kind: 'builtin', key: 'guoling.interactions' }, '导航转场配置', 'behavior')])
}

function transitionControlAsset(metadata: BuiltInWorkAssetMetadata) {
  return entry(metadata, [{ id: 'transition-control', definitionId: 'transition-control-definition', name: '带转场继续', data: { distance: 18, durationMs: 420 }, frame: frame(180, 46) }], ['transition-control'],
    [definition('transition-control-definition', source(WORK_TRANSITION_CONTROL_SOURCE), '源码编排转场')])
}

function mixedAsset(spatial: boolean, metadata: BuiltInWorkAssetMetadata) {
  const root = container('mixed', 'flow', spatial ? ['heading', 'exploration'] : ['heading', 'picture', 'program'], spatial ? '阅读与空间探索' : '图文与局部程序')
  const heading = text('heading', spatial ? '阅读正文后，进入下面的局部空间探索。' : '正文和图片可单独修改，局部程序保留自己的运行逻辑。'); delete heading.frame
  const definitions: ComponentDefinition[] = [containerDefinition('flow'), ...Object.values(nativeDefinitions())]
  const instances = [root, heading]
  if (spatial) {
    const exploration = container('exploration', 'spatial', ['near', 'far'], '局部空间'); exploration.frame = frame(600, 320)
    instances.push(exploration, shape('near'), shape('far', '#a78bfa', 700, 100)); definitions.push(containerDefinition('spatial'))
  } else {
    instances.push({ id: 'picture', definitionId: 'guoling.image', name: '可编辑图片', data: json(createImageData('mixed-image', '抽象几何示意')), frame: frame(360, 180) },
      { id: 'program', definitionId: 'program-definition', name: '局部运动程序', data: { title: '改变速度并记录', speed: 1 }, frame: frame(600, 300) })
    definitions.push(definition('guoling.image', { kind: 'builtin', key: 'guoling.image' }, '图片'), definition('program-definition', source(WORK_PROGRAM_SOURCE), '局部程序'))
  }
  const result = entry(metadata, instances, [root.id], definitions)
  if (!spatial) {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><rect width="360" height="180" rx="18" fill="#e0f2fe"/><circle cx="100" cy="90" r="45" fill="#38bdf8"/><path d="M200 45h90v90h-90z" fill="#a78bfa"/></svg>')
    result.assets['mixed-image'] = { id: 'mixed-image', path: 'assets/mixed-image.svg', mimeType: 'image/svg+xml', filename: 'mixed-image.svg', kind: 'image', byteLength: bytes.length, width: 360, height: 180 }
    result.resources.assets['mixed-image'] = bytes
  }
  return result
}

function professionalVariantAsset(metadata: BuiltInWorkAssetMetadata) {
  const base = getBuiltinComponentSource('guoling.shape')
  if (!base) throw new Error('内置形状源码尚未生成')
  const baseId = 'professional-shape-base', variantId = 'professional-shape-variant'
  const instance = shape('professional-shape', '#38bdf8'); instance.definitionId = variantId
  return entry(metadata, [instance], [instance.id], [
    definition(baseId, base, '现有形状算法'),
    { ...definition(variantId, { ...source('import base from "@guoling/shape-base"; export default {async mount(c){const mounted=await base.mount(c);if(c.root)c.root.style.filter="drop-shadow(0px 5px 8px #0f172a33)";return mounted;}}'), moduleBindings: { '@guoling/shape-base': baseId } }, '源码形状变体'), professionalBuiltinKey: 'guoling.shape' },
  ])
}

type WorkAssetSpec = BuiltInWorkAssetMetadata & { create(metadata: BuiltInWorkAssetMetadata): ComponentLibraryEntry; builtinSource?: string }
const specs: readonly WorkAssetSpec[] = [
  ...(['flow', 'slide', 'spatial'] as const).map(kind => ({ id: `guoling.work.${kind}`, title: `${kind === 'flow' ? '阅读' : kind === 'spatial' ? '空间' : '演示'}容器`, kind: 'objects' as const,
    usage: { kind: 'container' as const, host: 'any' as const, description: '正式子内容、布局、局部观看和编辑作用域。', editable: ['parameters', 'structure'] as ('parameters' | 'structure')[] }, create: (metadata: BuiltInWorkAssetMetadata) => containerAsset(kind, metadata) })),
  { id: 'guoling.work.program', title: '自主 Web 程序', kind: 'objects', usage: { kind: 'program', host: 'any', description: '自主管理 Canvas 循环、输入和动态记录，可作作品入口或局部程序。', editable: ['parameters', 'source'] }, create: programAsset },
  { id: 'guoling.work.presentation', title: '局部状态与原生触发', kind: 'page', usage: { kind: 'presentation', host: 'any', description: '原生图形动作与程序控件交替调用同一局部状态。', editable: ['parameters', 'structure', 'source'] }, create: presentationAsset },
  { id: 'guoling.work.camera', title: '镜头聚焦与返回', kind: 'page', usage: { kind: 'camera', host: 'any', description: '具有可编辑停靠点、路径及调用既有镜头执行者的控件。', editable: ['parameters', 'structure', 'source'] }, create: cameraAsset },
  ...([false, true] as const).map(scene => ({ id: `guoling.work.background.${scene ? 'scene' : 'ambient'}`, title: scene ? '前景联动场景背景' : '可参数化环境背景', kind: 'objects' as const,
    usage: { kind: 'background' as const, host: 'any' as const, placement: 'underlay' as const, description: scene ? '前景通过共享 energy 参数控制粒子幅度，默认不拦截输入。' : '保留内部动画循环，颜色、幅度与源码均可改。', editable: ['parameters', 'source'] as ('parameters' | 'source')[] }, create: (metadata: BuiltInWorkAssetMetadata) => backgroundAsset(scene, metadata) })),
  ...(['fade', 'slide'] as const).map(effect => ({ id: `guoling.work.transition.${effect}`, title: effect === 'fade' ? '淡入淡出转场' : '滑动转场', kind: 'objects' as const,
    usage: { kind: 'transition' as const, host: 'navigation' as const, description: '附着到已选导航控件或规则的实际动作；导航拥有提交、取消与清理。', transition: { effect, durationMs: 380, easing: 'ease-in-out' as const }, editable: ['parameters'] as 'parameters'[] }, create: transitionAsset })),
  { id: 'guoling.work.transition.source-control', title: '源码编排转场控件', kind: 'objects', usage: { kind: 'content', host: 'container', description: '控件源码生成视觉关键帧，仍通过共同导航执行转场。', editable: ['parameters', 'source'] }, create: transitionControlAsset },
  ...([false, true] as const).map(spatial => ({ id: `guoling.work.template.${spatial ? 'reading-spatial' : 'mixed-program'}`, title: spatial ? '阅读与空间探索模板' : '图文与局部程序模板', kind: 'structure' as const,
    usage: { kind: 'template' as const, host: 'any' as const, description: spatial ? 'Flow 中的独立 Spatial 区域，保留原生对象与局部镜头。' : '正式原生正文、图片与局部 Canvas 程序的混合。', editable: ['parameters', 'structure', 'source'] as ('parameters' | 'structure' | 'source')[] }, create: (metadata: BuiltInWorkAssetMetadata) => mixedAsset(spatial, metadata) })),
  { id: 'guoling.work.professional.shape-source', title: '可继续专业编辑的源码形状', kind: 'objects', usage: { kind: 'content', host: 'any', description: '复用现有形状算法增加阴影，填充、边框和形状参数仍由专业编辑处理。', editable: ['parameters', 'source'] }, create: professionalVariantAsset, builtinSource: 'guoling.shape' },
]
const metadata = specs.map(({ id, title, kind, usage }) => ({ id, title, kind, usage }))
const assets = new Map<string, ComponentLibraryEntry>()
let allAssets: readonly ComponentLibraryEntry[] | undefined

/** Browsing uses metadata; source closures and example resources are prepared only for a requested asset. */
export function builtInWorkAssetMetadata(): readonly BuiltInWorkAssetMetadata[] { return metadata }

/** Synchronous consumers retain the prepared entry API; builtin source consumers prepare their entry first. */
export function builtInWorkAsset(id: string): ComponentLibraryEntry | undefined {
  const spec = specs.find(value => value.id === id)
  if (!spec) return undefined
  let asset = assets.get(id)
  if (!asset) {
    asset = spec.create(metadata[specs.indexOf(spec)])
    assets.set(id, asset)
  }
  return structuredClone(asset)
}

export async function loadBuiltInWorkAsset(id: string): Promise<ComponentLibraryEntry | undefined> {
  const spec = specs.find(value => value.id === id)
  if (spec?.builtinSource) await loadBuiltinComponentSource(spec.builtinSource)
  return builtInWorkAsset(id)
}

/** Full-entry consumers explicitly request all entries, using the same factories as single insertion. */
export function builtInWorkAssets(): readonly ComponentLibraryEntry[] {
  return allAssets ??= metadata.map(value => builtInWorkAsset(value.id)!)
}
