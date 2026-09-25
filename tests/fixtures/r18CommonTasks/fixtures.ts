import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { courseProjectDocumentSchema } from '../../../src/shared/courseProjectSchema'
import type { CourseProjectDocument, FlowBlock, LayerItem, NativeLayerItem, SlideSurfaceDocument, FlowSurfaceDocument, SpatialSurfaceDocument } from '../../../src/shared/courseProjectTypes'
import { openCourseProjectArchive, type CourseProjectArchiveData } from '../../../src/core/drivers/codecs/courseProjectArchive'
import { createTableNode, createTableLayerItem, createChartNode, createChartLayerItem, createInputLayerItem, DEFAULT_INPUT_STYLE } from '../../../src/core/tools/nativeNodeFactories'
import { inputId, type CommonTask, type InputRole, type TaskVariant } from './definitions'

const ROOT = dirname(fileURLToPath(import.meta.url))
export const FIXTURE_ROOT = ROOT
const BASELINE_ROOT = join(ROOT, '..', 'architecture-baseline')
const EVIDENCE_PACKAGE = 'com.ittoedu.baseline.evidence-panel'

export type CommonTaskInput = CourseProjectArchiveData & {
  /** Attach these local files using the existing material path; never paste their bytes into a prompt. */
  materials: Record<string, Uint8Array>
  preparation: string[]
  intentionallyMissingAssetIds: string[]
}

function baseline(name: 'slide-heavy' | 'flow-heavy' | 'mixed-spatial'): CourseProjectArchiveData {
  return openCourseProjectArchive(new Uint8Array(readFileSync(join(BASELINE_ROOT, `${name}.h5lesson`))))
}

function parsePreparedProject(project: CourseProjectDocument): CourseProjectDocument {
  const order = (items: LayerItem[]) => items.forEach((item, index) => { item.order = (index + 1) * 100 })
  order(project.globalLayerItems.map(e => e.item))
  for (const surface of project.surfaces) {
    order(surface.surfaceLayerItems.map(e => e.item))
    if (surface.type === 'slide') surface.scenes.forEach(scene => order(scene.layerItems))
    if (surface.type === 'spatial-2d') order(surface.world.layerItems)
  }
  return courseProjectDocumentSchema.parse(project)
}

function wave(frequency = 440): Uint8Array {
  const count = 8_000
  const bytes = new Uint8Array(44 + count * 2)
  const view = new DataView(bytes.buffer)
  const chars = (offset: number, value: string) => [...value].forEach((char, i) => { bytes[offset + i] = char.charCodeAt(0) })
  chars(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); chars(8, 'WAVE'); chars(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8_000, true); view.setUint32(28, 16_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  chars(36, 'data'); view.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * frequency * i / 8_000) * 8_000), true)
  return bytes
}

let materialPromise: Promise<Record<string, Uint8Array>> | undefined
export function createR18Materials(): Promise<Record<string, Uint8Array>> {
  materialPromise ??= (async () => {
    const original = readFileSync(join(ROOT, 'materials', 'parabola-red.svg'))
    const blue = readFileSync(join(ROOT, 'materials', 'parabola-blue.svg'))
    return {
      'parabola-red.png': new Uint8Array(await sharp(original).png().toBuffer()),
      'parabola-blue.png': new Uint8Array(await sharp(blue).png().toBuffer()),
      'large-diagram.png': new Uint8Array(await sharp(original, { density: 288 }).resize(3200, 1800).png().toBuffer()),
      'tone.wav': wave(),
      'motion.webm': new Uint8Array(readFileSync(join(ROOT, 'materials', 'motion.webm'))),
      'motion-blue.webm': new Uint8Array(readFileSync(join(ROOT, 'materials', 'motion-blue.webm'))),
      'confirmed-script.md': new Uint8Array(readFileSync(join(ROOT, 'materials', 'confirmed-script.md'))),
    }
  })()
  return materialPromise
}

function addAsset(input: CourseProjectArchiveData, id: string, filename: string, bytes: Uint8Array, kind: 'image' | 'audio' | 'video', width?: number, height?: number) {
  input.project.assets[id] = {
    id, filename, path: `assets/${id}.${filename.split('.').at(-1)}`, byteLength: bytes.byteLength,
    kind, mimeType: kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/wav' : 'video/webm',
    ...(width !== undefined ? { width, height } : {}), ...(kind === 'image' ? {} : { duration: kind === 'audio' ? 1 : 2 }),
  }
  input.assetFiles[id] = bytes
}

function baseNative(id: string, role: string, index: number): NativeLayerItem {
  const template = baseline('slide-heavy').project.surfaces[0] as SlideSurfaceDocument
  const title = template.scenes[0]!.layerItems.find(item => item.layerItemId === 'slide-intro-title') as NativeLayerItem
  return {
    ...structuredClone(title), layerItemId: id, label: role, order: 100 + index * 10,
    frame: { mode: 'absolute', x: 70 + index % 3 * 370, y: 100 + Math.floor(index / 3) * 190, width: 330, height: 160 },
  }
}

const accurateBody = '对于一元二次方程ax²+bx+c=0，前提是a≠0。计算判别式Δ=b²−4ac：Δ>0有两个不相等的实数根；Δ=0有两个相等的实数根；Δ<0没有实数根。'
const rowText: Record<string, string> = { a: '识别系数：先确认a≠0', b: '计算Δ：b²−4ac', c: '判断根：比较Δ与0' }

function textFor(task: CommonTask, role: InputRole): string {
  if (role === 'title') return '认识判别式'
  if (role === 'body') return task.id === 'T01' ? accurateBody.replace('Δ<0没有实数根', 'Δ<0有两个实数根')
    : task.id === 'Q01' ? accurateBody.repeat(3) : accurateBody
  if (role === 'source') return task.id === 'C05' ? '标准单摆实验规格：初始摆长1米，重力加速度9.8米每二次方秒，初始摆角10度。当前正式目录没有此实验实例，不能把此文本当实验。'
    : task.id === 'C01' ? 'Δ<0时实数根有几个？0、1、2。' : '月份与实验次数\n1月：12次\n2月：18次\n3月：15次'
  if (role === 'button') return ['A04', 'M02'].includes(task.id) ? '播放讲解' : '显示答案'
  if (role === 'answer') return task.id === 'A05' ? '正确 / 再试一次' : '答案：Δ<0时没有实数根。'
  if (role === 'b' && ['A04', 'M02'].includes(task.id)) return '暂停讲解'
  if (task.id === 'L02') return role === 'a' ? 'Δ>0：两个不相等的实数根。抛物线与x轴有两个交点。' : 'Δ=0：两个相等的实数根。抛物线与x轴相切。'
  if (task.id === 'N03') return role === 'a' ? '概念：判别式Δ=b²−4ac。' : role === 'b' ? '例题：x²−2x+1=0，Δ=0，x=1。' : '小结：根据Δ的符号判断根。'
  return rowText[role] ?? role
}

function itemFor(task: CommonTask, role: InputRole, index: number): LayerItem {
  const id = inputId(task.id, role)
  const item = baseNative(id, role === 'image' ? 'A图' : role === 'image-peer' ? 'B图' : textFor(task, role).slice(0, 40), index)
  if (role === 'table') {
    let counter = 0
    const table = createTableLayerItem(createTableNode({ id, idFactory: () => `${task.id}-table-${++counter}`, headerRowCount: 1 }), item.order)
    if (table.content.nativeType !== 'table') throw new Error('Table factory returned wrong carrier')
    const col0 = table.content.data.columns[0]!, col1 = table.content.data.columns[1]!
    table.content.data.columns = [col0, col1]
    table.content.data.rows = ['月份|次数', '1月|12', '2月|18', '3月|15'].map((text, row) => ({
      id: `${id}-row-${row}`, height: 44,
      cells: text.split('|').map((value, col) => ({ id: `${id}-cell-${row}-${col}`, columnId: col ? col1.id : col0.id, text: value, ...(row === 0 ? { style: { bold: true } } : {}) })),
    }))
    return { ...table, label: '月份与次数', frame: { mode: 'absolute', x: 100, y: 120, width: 760, height: 350 } }
  }
  if (role === 'chart') {
    const categories = ['1月', '2月', '3月'].map((label, i) => ({ id: `${id}-category-${i}`, label }))
    let counter = 0
    return createChartLayerItem(createChartNode({ id, idFactory: () => `${task.id}-chart-${++counter}`, title: '实验次数', categories,
      series: [{ id: `${id}-series`, name: '实验次数', color: '#2563eb', points: [12, 18, 15].map((value, i) => ({ id: `${id}-point-${i}`, categoryId: categories[i]!.id, value })) }],
    }), item.order)
  }
  if (role === 'input') return createInputLayerItem({ answerType: 'number', stateKey: 'r18-answer', validityKey: 'r18-valid', ruleFamilyRuleIds: [], placeholder: '请输入答案', style: DEFAULT_INPUT_STYLE }, { id, x: 90, y: 150 })
  if (role === 'component') {
    const source = (baseline('slide-heavy').project.surfaces[0] as SlideSurfaceDocument).scenes[0]!.layerItems.find(i => i.layerItemId === 'slide-intro-component')!
    if (source.kind !== 'component') throw new Error('Expected baseline component')
    return { ...structuredClone(source), layerItemId: id, label: '证据卡', frame: item.frame, order: item.order, visible: true, playbackInitialVisibility: 'inherit', staticFallbackAssetId: 'r18-original' }
  }
  if (role === 'formula') {
    const source = (baseline('slide-heavy').project.surfaces[0] as SlideSurfaceDocument).scenes[0]!.layerItems.find(i => i.layerItemId === 'slide-intro-formula') as NativeLayerItem
    const formula = structuredClone(source)
    if (formula.content.nativeType !== 'formula') throw new Error('Expected baseline formula')
    formula.content.data.formulaId = `${id}-formula`
    return { ...formula, layerItemId: id, label: '判别式公式', frame: { ...item.frame, width: 600, height: 110 }, order: item.order }
  }
  if (role === 'shape') {
    const source = (baseline('slide-heavy').project.surfaces[0] as SlideSurfaceDocument).scenes[0]!.layerItems.find(i => i.layerItemId === 'slide-intro-callout') as NativeLayerItem
    return { ...structuredClone(source), layerItemId: id, label: '待替换形状', frame: item.frame, order: item.order }
  }
  if (role === 'image' || role === 'image-peer') return { ...item, content: { nativeType: 'image', data: {
    assetId: task.id === 'I07' ? 'r18-large' : task.id === 'Q02' ? 'r18-missing' : 'r18-original', preserveAspectRatio: true, fit: 'contain', crop: { left: 0, top: 0, right: 0, bottom: 0 },
    cropX: 0.5, cropY: 0.5, flipX: false, flipY: false, cornerRadius: 0, feather: { amount: 0, mode: 'rectangle' }, safeAreas: [],
  } } }
  if (role === 'video') return { ...item, content: { nativeType: 'video', data: {
    assetId: 'r18-video', fit: 'contain', autoplay: false, loop: false, muted: true, volume: 1, playbackRate: 1,
    showControls: true, clickToToggle: true, startTime: 0, endTime: null, poster: { mode: 'image', time: 0, assetId: 'r18-original' }, backgroundAudioMode: 'none',
  } } }
  if (item.content.nativeType !== 'text') throw new Error('Expected text template')
  const value = textFor(task, role)
  item.content.data.text = value
  item.content.data.runs = role === 'body' ? [{ start: value.indexOf('Δ<0'), end: value.length, style: { bold: true } }] : []
  item.content.data.style.fontSize = 28
  if (['body', 'source'].includes(role)) item.frame = { mode: 'absolute', x: 70, y: 150, width: 570, height: task.id === 'Q01' ? 72 : 310 }
  if (role === 'title') item.frame = { mode: 'absolute', x: 90, y: 45, width: 600, height: 70 }
  if (role === 'button') item.frame = { mode: 'absolute', x: 90, y: 470, width: 220, height: 70 }
  if (role === 'answer') { item.frame = { mode: 'absolute', x: 380, y: 470, width: 650, height: 110 }; item.playbackInitialVisibility = 'hidden' }
  if (['a', 'b', 'c'].includes(role)) {
    const card = ['a', 'b', 'c'].indexOf(role)
    item.frame = { mode: 'absolute', x: task.id === 'D07' ? 220 + card * 100 : [80, 370, 790][card]!, y: 150 + card * 25, width: 250, height: 180 }
    item.content.data.style.backgroundColor = ['#2563eb', '#0f766e', '#b45309'][card]!
    item.content.data.style.backgroundOpacity = 1
    item.content.data.style.color = '#ffffff'
  }
  return item
}

function flowBlockFor(task: CommonTask, role: InputRole, index: number): FlowBlock {
  const id = inputId(task.id, role)
  const item = itemFor(task, role, index)
  if (item.kind === 'component') return { id, type: 'component', component: item.component, props: item.props, staticFallbackAssetId: 'r18-original', wrap: 'none' }
  if (item.kind !== 'native') throw new Error(`No Flow body carrier for ${role}`)
  switch (item.content.nativeType) {
    case 'text': {
      const text = textFor(task, role)
      const boundary = role === 'body' ? text.indexOf('Δ<0') : -1
      const content = { inlines: boundary >= 0 ? [{ type: 'text' as const, text: text.slice(0, boundary) }, { type: 'text' as const, text: text.slice(boundary), style: { bold: true } }] : [{ type: 'text' as const, text }] }
      return role === 'title' ? { id, type: 'heading', level: 2, content } : { id, type: 'paragraph', content, textAlign: 'left', lineSpacing: 1.6 }
    }
    case 'image': return { id, type: 'media', assetId: item.content.data.assetId, mediaKind: 'image', altText: role === 'image' ? 'A图' : 'B图', caption: { inlines: [{ type: 'text', text: '判别式与交点' }] }, layout: 'content-width', wrap: 'none' }
    case 'formula': return { id, type: 'formula', latex: '\\Delta = b^{2} - 4ac', accessibleText: item.content.data.accessibleText, formulaId: `${id}-formula` }
    case 'table': return {
      id, type: 'table', caption: { inlines: [{ type: 'text', text: '月份与次数' }] }, columns: [{ id: `${id}-month`, header: { inlines: [{ type: 'text', text: '月份' }] } }, { id: `${id}-count`, header: { inlines: [{ type: 'text', text: '次数' }] } }],
      rows: [12, 18, 15].map((n, i) => ({ id: `${id}-row-${i}`, cells: { [`${id}-month`]: { inlines: [{ type: 'text', text: `${i + 1}月` }] }, [`${id}-count`]: { inlines: [{ type: 'text', text: String(n), ...(i === 1 ? { style: { bold: true } } : {}) }] } } })),
    }
    case 'chart': return { id, type: 'chart', chart: item.content.data, height: 380 }
    default: throw new Error(`Unsupported Flow body role ${role}: ${item.content.nativeType}`)
  }
}

function navigationRule(id: string, nodeId: string) {
  return {
    id, name: '跳转证据态', enabled: true,
    trigger: { type: 'node.click' as const, nodeId }, conditions: [],
    actions: [{ id: `${id}-step`, start: 'after-previous' as const, delayMs: 0, action: { type: 'scene.go' as const, sceneId: 'slide-scene-intro', targetStateId: 'slide-state-evidence' } }],
  }
}

/** Small deterministic input recipe; it does not apply the requested AI edit. */
export async function createR18TaskInput(task: CommonTask, variant: TaskVariant): Promise<CommonTaskInput> {
  const materials = await createR18Materials()
  if (variant.fixture === 'slide-heavy-original-copy') {
    return { ...baseline('slide-heavy'), materials: {}, preparation: ['原始ARCH-0字节未经改写；执行者必须从COMMON_TASK_SET.i01.sourceRoot复制实际用户文件并核对revision。'], intentionallyMissingAssetIds: [] }
  }
  const seed = variant.fixture === 'baseline-flow' || variant.carrier.startsWith('flow-') ? 'flow-heavy'
    : variant.fixture === 'baseline-mixed' || variant.carrier.startsWith('spatial-') ? 'mixed-spatial' : 'slide-heavy'
  const input = baseline(seed)
  const project = input.project
  const preparation = ['独立输入副本沿ARCH-0正式V9档案生成；r18-*是此recipe创建的固定ID，不冒充用户原工程ID。']
  // ARCH-0 deliberately has tiny rendering probes; ordinary image tasks need a
  // decodable, meaningful source. I01 above keeps the actual archive unchanged.
  for (const asset of Object.values(project.assets)) {
    if (asset.kind === 'image') addAsset(input, asset.id, asset.filename, materials['parabola-red.png']!, 'image', 800, 450)
  }
  addAsset(input, 'r18-original', 'parabola-red.png', materials['parabola-red.png']!, 'image', 800, 450)
  if (task.id === 'Q02') addAsset(input, 'r18-missing', 'missing-diagram.png', materials['parabola-red.png']!, 'image', 800, 450)
  addAsset(input, 'r18-large', 'large-diagram.png', materials['large-diagram.png']!, 'image', 3200, 1800)
  addAsset(input, 'r18-video', 'motion.webm', materials['motion.webm']!, 'video', 320, 180)
  addAsset(input, 'r18-audio', 'tone.wav', materials['tone.wav']!, 'audio')
  project.id = `r18-input-${task.id.toLowerCase()}-${variant.id}`
  project.revision = 0
  project.designTokens.colors = [{ id: 'r18-primary', label: '主色', color: '#1d4ed8' }, { id: 'r18-accent', label: '强调色', color: '#f59e0b' }]
  if (!project.componentPackages[EVIDENCE_PACKAGE]) {
    const source = baseline('slide-heavy')
    project.componentPackages[EVIDENCE_PACKAGE] = source.project.componentPackages[EVIDENCE_PACKAGE]!
    Object.assign(input.componentFiles, source.componentFiles)
  }
  // Keep a shared image consumer outside every ordinary selected range.
  const guard = itemFor({ ...task, id: 'guard' }, 'image', 0)
  guard.layerItemId = 'r18-shared-guard'
  guard.label = '不应改变的共享图片实例'
  guard.frame = { mode: 'absolute', x: 1120, y: 20, width: 120, height: 68 }
  project.globalLayerItems.push({ item: guard, visibility: { mode: 'all', locationIds: [] } })

  if (variant.fixture !== 'common-input-v1') {
    if (task.id === 'N02') {
      const slide = project.surfaces.find(s => s.type === 'slide') as SlideSurfaceDocument
      const button = itemFor(task, 'button', 0)
      slide.scenes.find(s => s.id === 'slide-scene-summary')!.layerItems.push(button)
      slide.scenes.find(s => s.id === 'slide-scene-summary')!.interactions.push(navigationRule('r18-preserved-link', button.layerItemId))
      preparation.push('N02输入增补可点击的既有精确state链接，用于验证重排保留引用。')
    }
    return { ...input, project: parsePreparedProject(project), materials, preparation, intentionallyMissingAssetIds: [] }
  }

  let items = task.inputRoles.map((role, i) => itemFor(task, role, i))
  const body = items.find(i => i.layerItemId === inputId(task.id, 'body'))
  const image = items.find(i => i.layerItemId === inputId(task.id, 'image'))
  if (body && image) image.frame = { mode: 'absolute', x: 710, y: 160, width: 450, height: 300 }
  if (variant.carrier === 'global' || variant.carrier.endsWith('shared')) {
    // Distinct plane fixtures still use the same frozen input and exact IDs.
    items = items.map(item => ({ ...item, frame: { ...item.frame, y: item.frame.y + 20 } }))
  }
  if (variant.carrier.startsWith('flow-')) {
    const flow = project.surfaces.find(s => s.id === 'flow-surface') as FlowSurfaceDocument
    const heading: FlowBlock = { id: 'r18-flow-heading', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '判别式练习材料' }] } }
    flow.blocks = variant.carrier === 'flow-body' ? [heading, ...task.inputRoles.map((role, i) => flowBlockFor(task, role, i)), { id: 'r18-flow-end', type: 'paragraph', content: { inlines: [{ type: 'text', text: '此段未选中，内容与顺序必须保持。' }] } }]
      : [heading, { id: 'r18-flow-background', type: 'paragraph', content: { inlines: [{ type: 'text', text: accurateBody }] } }, { id: 'r18-flow-end', type: 'paragraph', content: { inlines: [{ type: 'text', text: '未选中正文应保持。' }] } }]
    if (task.id === 'N03') flow.blocks = [heading, { id: 'r18-n03-chapter', type: 'section', title: { inlines: [{ type: 'text', text: '判别式讲义' }] }, collapsedByDefault: false, blocks: task.inputRoles.map((role, i) => flowBlockFor(task, role, i)) }, { id: 'r18-flow-end', type: 'paragraph', content: { inlines: [{ type: 'text', text: '未选中尾段保持。' }] } }]
    project.locations = project.locations.filter(l => l.surfaceId !== flow.id)
    project.locations.push({ id: 'r18-flow-location', label: '代表任务讲义', kind: 'flow-block', surfaceId: flow.id, blockId: 'r18-flow-heading' })
    flow.surfaceLayerItems = flow.surfaceLayerItems.map(e => ({ ...e, visibility: { mode: 'all', locationIds: [] } }))
    if (variant.carrier === 'flow-overlay') {
      if (task.id === 'L06') flow.blocks.splice(1, 1, flowBlockFor(task, 'body', 0))
      flow.surfaceLayerItems.push(...items.filter(item => task.id !== 'L06' || item.layerItemId !== inputId(task.id, 'body')).map(item => ({ item, bodyPlane: 'overlay' as const, visibility: { mode: 'all' as const, locationIds: [] } })))
    }
    if (task.id === 'L06') flow.surfaceLayerItems.push({ item: { ...baseNative('r18-flow-annotation', '批注保持', 0), frame: { mode: 'absolute', x: 720, y: 30, width: 140, height: 65 } }, bodyPlane: 'overlay', visibility: { mode: 'all', locationIds: [] } })
  } else if (variant.carrier.startsWith('spatial-')) {
    const spatial = project.surfaces.find(s => s.id === 'mixed-spatial-surface') as SpatialSurfaceDocument
    spatial.camera.frames.push({ id: 'r18-camera-task', name: '代表任务区域', x: 640, y: 350, zoom: 0.8 })
    project.locations.push({ id: 'r18-spatial-location', label: '代表任务区域', kind: 'spatial-camera', surfaceId: spatial.id, cameraFrameId: 'r18-camera-task' })
    if (variant.carrier === 'spatial-world') spatial.world.layerItems.push(...items)
    else spatial.surfaceLayerItems.push(...items.map(item => ({ item, visibility: { mode: 'all' as const, locationIds: [] } })))
  } else {
    const slide = project.surfaces.find(s => s.id === 'slide-surface') as SlideSurfaceDocument
    slide.scenes.push({ id: 'r18-task-scene', name: '代表任务输入', backgroundColor: '#ffffff', layerItems: [], interactions: [],
      ...(variant.carrier === 'slide-state' ? { presentation: { initialStateId: 'r18-state-base', states: [
        { id: 'r18-state-base', name: '基础态', layerItemOverrides: {} },
        { id: 'r18-state-evidence', name: '证据态', backgroundColor: '#eff6ff', layerItemOverrides: {} },
      ] } } : {}),
    })
    project.locations.push({ id: 'r18-location-base', label: '代表任务基础态', kind: 'slide-scene', surfaceId: slide.id, sceneId: 'r18-task-scene', ...(variant.carrier === 'slide-state' ? { stateId: 'r18-state-base' } : {}) })
    if (variant.carrier === 'slide-state') project.locations.push({ id: 'r18-location-evidence', label: '代表任务证据态', kind: 'slide-scene', surfaceId: slide.id, sceneId: 'r18-task-scene', stateId: 'r18-state-evidence' })
    if (variant.carrier === 'global') project.globalLayerItems.push(...items.map(item => ({ item, visibility: { mode: 'all' as const, locationIds: [] } })))
    else if (variant.carrier === 'slide-shared') slide.surfaceLayerItems.push(...items.map(item => ({ item, visibility: { mode: 'include' as const, locationIds: ['r18-location-base', 'slide-location-summary'] } })))
    else slide.scenes.at(-1)!.layerItems.push(...items)
  }
  project.startLocationId = variant.locationId
  if (task.inputRoles.includes('input')) project.courseState.push({ key: 'r18-answer', valueType: 'number', defaultValue: 0 }, { key: 'r18-valid', valueType: 'boolean', defaultValue: false })

  // Reuse an existing target-scene fixture for cross-surface navigation cases.
  if (['A02', 'Q03'].includes(task.id) && !project.surfaces.some(s => s.id === 'slide-surface')) {
    const source = baseline('slide-heavy')
    project.surfaces.push(...source.project.surfaces)
    project.locations.push(...source.project.locations)
    Object.assign(project.assets, source.project.assets)
    Object.assign(input.assetFiles, source.assetFiles)
    Object.assign(input.componentFiles, source.componentFiles)
    Object.assign(project.media.audio.sounds, source.project.media.audio.sounds)
    project.mixedPrintPlan = { pageSize: 'surface-native', orientation: 'auto', entries: project.surfaces.map(surface =>
      surface.type === 'slide' ? { id: `r18-print-${surface.id}`, kind: 'slide-scenes', surfaceId: surface.id, sceneIds: surface.scenes.map(scene => scene.id) }
        : surface.type === 'flow' ? { id: `r18-print-${surface.id}`, kind: 'flow-document', surfaceId: surface.id }
          : { id: `r18-print-${surface.id}`, kind: 'spatial-frames', surfaceId: surface.id, cameraFrameIds: surface.camera.frames.map(frame => frame.id) }),
    }
  }
  if (task.id === 'Q03') {
    const wrong = { ...navigationRule('r18-wrong-answer-link', inputId(task.id, 'button')), actions: [{ id: 'r18-wrong-step', start: 'after-previous' as const, delayMs: 0, action: { type: 'scene.go' as const, sceneId: 'slide-scene-summary' } }] }
    if (variant.carrier.startsWith('slide-')) (project.surfaces.find(s => s.id === 'slide-surface') as SlideSurfaceDocument).scenes.find(s => s.id === 'r18-task-scene')!.interactions.push(wrong)
    else project.globalInteractions.push(wrong)
  }
  if (task.id === 'M02') {
    const rules = (['button', 'b'] as const).map((role, index) => ({
      id: `r18-media-rule-${index}`, name: index === 0 ? '播放讲解' : '暂停讲解', enabled: true,
      trigger: { type: 'node.click' as const, nodeId: inputId(task.id, role) }, conditions: [],
      actions: [{ id: `r18-media-step-${index}`, start: 'after-previous' as const, delayMs: 0, action: { type: index === 0 ? 'video.play' as const : 'video.pause' as const, nodeId: inputId(task.id, 'video') } }],
    }))
    if (variant.carrier.startsWith('slide-')) (project.surfaces.find(s => s.id === 'slide-surface') as SlideSurfaceDocument).scenes.find(s => s.id === 'r18-task-scene')!.interactions.push(...rules)
    else project.globalInteractions.push(...rules)
  }
  const intentionallyMissingAssetIds: string[] = []
  if (task.id === 'Q02') {
    // Missing bytes is a genuine repair input; do not pretend the archive is
    // resource-closed. The document itself remains valid V9.
    delete input.assetFiles['r18-missing']
    intentionallyMissingAssetIds.push('r18-missing')
    preparation.push('Q02故意删除独占r18-missing字节；由现有损坏资源恢复入口加载，不能自动补图后才开始计时。')
  }
  return { ...input, project: parsePreparedProject(project), materials, preparation, intentionallyMissingAssetIds }
}

/** Inspect exact identity, including nested blocks and owner/state scope. */
export function resolveR18VariantTargets(project: CourseProjectDocument, variant: TaskVariant): unknown[] {
  const surface = project.surfaces.find(s => s.id === variant.surfaceId)
  if (!surface) throw new Error(`Missing surface ${variant.surfaceId}`)
  const location = project.locations.find(l => l.id === variant.locationId && l.surfaceId === surface.id)
  if (!location) throw new Error(`Missing location ${variant.locationId}`)
  if (variant.sceneId && (surface.type !== 'slide' || !surface.scenes.some(s => s.id === variant.sceneId))) throw new Error(`Missing scene ${variant.sceneId}`)
  if (variant.stateId && (surface.type !== 'slide' || !surface.scenes.find(s => s.id === variant.sceneId)?.presentation?.states.some(s => s.id === variant.stateId))) throw new Error(`Missing state ${variant.stateId}`)
  if (variant.targetKind === 'project') return [project]
  if (variant.targetKind === 'surface') return [surface]
  if (variant.targetKind === 'location') return variant.targetIds.map(id => {
    const found = project.locations.find(l => l.id === id)
    if (!found) throw new Error(`Missing location target ${id}`)
    return found
  })
  if (variant.targetKind === 'flow-block' || variant.targetKind === 'flow-body-and-overlay') {
    if (surface.type !== 'flow') throw new Error('Flow target requires Flow surface')
    const flatten = (blocks: FlowBlock[]): FlowBlock[] => blocks.flatMap(b => b.type === 'section' ? [b, ...flatten(b.blocks)] : [b])
    return variant.targetIds.map(id => {
      const found = flatten(surface.blocks).find(b => b.id === id)
        ?? (variant.targetKind === 'flow-body-and-overlay' ? surface.surfaceLayerItems.find(e => e.item.layerItemId === id)?.item : undefined)
      if (!found) throw new Error(`Missing Flow block ${id}`)
      return found
    })
  }
  const layers = variant.carrier === 'global' ? project.globalLayerItems.map(e => e.item)
    : variant.carrier.endsWith('shared') || variant.carrier === 'flow-overlay' ? surface.surfaceLayerItems.map(e => e.item)
      : surface.type === 'slide' ? surface.scenes.flatMap(s => variant.sceneId && variant.fixture === 'common-input-v1' && s.id !== variant.sceneId ? [] : s.layerItems)
        : surface.type === 'spatial-2d' ? surface.world.layerItems : []
  return variant.targetIds.map(id => {
    const found = layers.find(item => item.layerItemId === id)
    if (!found) throw new Error(`Missing ${variant.carrier} layer ${id}`)
    return found
  })
}
