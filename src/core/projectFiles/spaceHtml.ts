import type { CompositionLayerItem, CourseProjectDocument, LayerItem, SpatialCameraFrame, SpatialSurfaceDocument } from '../../shared/courseProjectTypes'
import { courseSlideCanvas } from '../../shared/slideCanvas'
import { allocateCourseLayerOrder } from '../tools/layerOrder'
import { parsePageHtml, programHtml, serializePageHtml, type PageComposition, type PageNode, type PageParsePort } from './pageHtml'
import { ProjectFileError, type PlannedChange } from './slidePages'
import { planSpaceContentWrite, spaceFiles, targetSpace } from './spaceFiles'
import type { DocumentResources } from '../../shared/workbench/document'
import { projectObjectSummary } from './projectFileView'

type Element = Extract<PageNode, { kind: 'element' }>
const SOURCE = 'spacehtml_source_'
const SLOT = 'spacehtml-slot:'
const OBJECT = 'spacehtml-object:'
const STYLE = 'spacehtml-style:'
const isStep = (node: Element) => (node.attributes.class ?? '').split(/\s+/).includes('step')
const walk = (node: PageNode, visit: (node: PageNode) => void): void => { visit(node); if (node.kind === 'element') node.children.forEach(child => walk(child, visit)) }
const find = (root: PageNode, predicate: (node: PageNode) => boolean): PageNode | undefined => {
  let value: PageNode | undefined
  walk(root, node => { if (!value && predicate(node)) value = node })
  return value
}
const sourceItem = (surface: SpatialSurfaceDocument) => surface.world.layerItems.find(item => item.layerItemId.startsWith(SOURCE))
const layerFields = (item: LayerItem) => ({ layerItemId: item.layerItemId, label: item.label, frame: item.frame, order: item.order,
  visible: item.visible, locked: item.locked, rotation: item.rotation, opacity: item.opacity, hitPolicy: item.hitPolicy,
  playbackInitialVisibility: item.playbackInitialVisibility, ...(item.paperSpace ? { paperSpace: item.paperSpace } : {}) })

function projectedObject(item: LayerItem): Element | undefined {
  if (item.kind !== 'composition') return undefined
  const marker = find(item.content.root, node => node.kind === 'comment' && node.text.startsWith(OBJECT))
  const id = marker?.kind === 'comment' ? marker.text.slice(OBJECT.length) : undefined
  const node = id && find(item.content.root, node => node.id === id)
  return node && node.kind === 'element' ? node : undefined
}

function numeric(node: Element, name: string, fallback: number, positive = false): number {
  const raw = node.attributes[name]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isFinite(value) || positive && value <= 0)
    throw new ProjectFileError('invalid-coordinate', `${name} 需要${positive ? '大于零的' : ''}有效数字；原空间未修改`)
  return value
}

/** Explicit pixel dimensions and common simple stylesheet rules; other layouts retain the course viewport. */
function dimensions(content: PageComposition, node: Element, canvas: { width: number; height: number }) {
  const declared: Record<string, string> = {}
  const declarations = (text: string) => {
    for (const match of text.matchAll(/(?:^|;)\s*(width|height)\s*:\s*([^;]+)/gi)) declared[match[1]!.toLowerCase()] = match[2]!.trim().replace(/\s*!important\s*$/i, '')
  }
  walk(content.root, value => {
    if (value.kind !== 'element' || value.tagName !== 'style' || value.id.startsWith(STYLE)) return
    const css = value.children.map(child => child.kind === 'text' ? child.text : '').join('')
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (rule[1]!.trim().split(',').some(selector => {
        selector = selector.trim()
        if (selector.startsWith('#')) return selector.slice(1) === node.attributes.id
        if (selector.startsWith('.')) return (node.attributes.class ?? '').split(/\s+/).includes(selector.slice(1))
        return selector === node.tagName
      })) declarations(rule[2]!)
    }
  })
  declarations(node.attributes.style ?? '')
  const size = (name: 'width' | 'height') => {
    const value = declared[name]
    const px = value && /^([\d.]+)(?:px)?$/.exec(value)
    const number = px ? Number(px[1]) : canvas[name]
    return number > 0 && Number.isFinite(number) ? number : canvas[name]
  }
  return { width: size('width'), height: size('height') }
}

function geometry(node: Element, content: PageComposition, project: CourseProjectDocument) {
  const base = dimensions(content, node, courseSlideCanvas(project))
  const scale = numeric(node, 'data-scale', 1, true)
  const width = base.width * scale, height = base.height * scale
  return { frame: { mode: 'absolute' as const, x: numeric(node, 'data-x', 0) - width / 2,
    y: numeric(node, 'data-y', 0) - height / 2, width, height }, rotation: numeric(node, 'data-rotate', 0), base }
}

function withGeometry(node: Element, item: LayerItem, content: PageComposition, project: CourseProjectDocument): Element {
  const attributes = { ...node.attributes }
  const set = (name: string, value: number, fallback: number) => {
    if (numeric(node, name, fallback) !== value) attributes[name] = String(value)
  }
  const base = dimensions(content, node, courseSlideCanvas(project)), scale = item.frame.width / base.width
  set('data-x', item.frame.x + item.frame.width / 2, 0)
  set('data-y', item.frame.y + item.frame.height / 2, 0)
  set('data-scale', scale, 1)
  set('data-rotate', item.rotation, 0)
  if (Math.abs(base.height * scale - item.frame.height) > 1e-6)
    attributes.style = `${attributes.style ?? ''}${attributes.style?.trim().endsWith(';') || !attributes.style ? '' : ';'}height:${item.frame.height / scale}px;`
  return { ...node, attributes }
}

/** The source skeleton owns shared HTML/CSS; object subtrees stay in their editable world carriers. */
export function spaceDocument(project: CourseProjectDocument, surface: SpatialSurfaceDocument): {
  content?: PageComposition; source?: LayerItem; objects: Map<string, LayerItem>; program?: string
} {
  const source = sourceItem(surface), objects = new Map<string, LayerItem>()
  for (const item of surface.world.layerItems) {
    const node = projectedObject(item)
    if (node) objects.set(node.id, item)
  }
  if (source?.kind === 'runtime') return { source, objects, program: programHtml(source.runtime, project.assets) }
  if (source?.kind === 'composition') {
    const ordered = new Map<string, LayerItem>()
    const restore = (node: PageNode): PageNode => {
      if (node.kind === 'comment' && node.text.startsWith(SLOT)) {
        const item = objects.get(node.text.slice(SLOT.length)), object = item && projectedObject(item)
        if (item && object) ordered.set(object.id, item)
        return item && object ? withGeometry(structuredClone(object), item, source.content, project) : { ...node, text: '' }
      }
      return node.kind === 'element' ? { ...node, children: node.children.map(restore) } : node
    }
    const assets = Object.assign({}, source.content.assets, ...[...objects.values()].map(item => item.kind === 'composition' ? item.content.assets : {}))
    const content = { ...source.content, assets, root: restore(source.content.root) as Element }
    return { source, objects: ordered, content }
  }
  // Existing spatial compositions become ordinary positioned blocks without changing their layer identities.
  const children: PageNode[] = [], head: PageNode[] = []
  for (const item of surface.world.layerItems) {
    if (item.kind !== 'composition') continue
    const body = find(item.content.root, node => node.kind === 'element' && node.tagName === 'body')
    const oldHead = find(item.content.root, node => node.kind === 'element' && node.tagName === 'head')
    if (oldHead?.kind === 'element') head.push(...structuredClone(oldHead.children))
    const id = `${item.content.root.id}:world`
    const followed = surface.camera.frames.some(frame => frame.targetLayerItemId === item.layerItemId)
    const node: Element = { id, kind: 'element', tagName: 'div', attributes: {
      ...(followed ? { class: 'step' } : {}), 'data-x': String(item.frame.x + item.frame.width / 2),
      'data-y': String(item.frame.y + item.frame.height / 2), 'data-rotate': String(item.rotation),
      style: `width:${item.frame.width}px;height:${item.frame.height}px;`,
    }, children: structuredClone(body?.kind === 'element' ? body.children : item.content.root.kind === 'element' ? item.content.root.children : [item.content.root]) }
    children.push(node); objects.set(id, item)
  }
  const prefix = `spacehtml_${surface.id}`
  return { objects, content: { assets: Object.assign({}, ...surface.world.layerItems.map(item => item.kind === 'composition' ? item.content.assets : {})),
    root: { id: `${prefix}:document`, kind: 'element', tagName: '#document', attributes: {}, children: [
      { id: `${prefix}:html`, kind: 'element', tagName: 'html', attributes: {}, children: [
        { id: `${prefix}:head`, kind: 'element', tagName: 'head', attributes: {}, children: head },
        { id: `${prefix}:body`, kind: 'element', tagName: 'body', attributes: {}, children },
      ] },
    ] } } }
}

export function readSpaceHtml(project: CourseProjectDocument, surface: SpatialSurfaceDocument): string {
  return readSpaceFile(project, surface).content
}

export function readSpaceFile(project: CourseProjectDocument, surface: SpatialSurfaceDocument): { content: string; objects: string[] } {
  const doc = spaceDocument(project, surface)
  const managed = new Set([...doc.objects.values()].map(item => item.layerItemId))
  return { content: doc.program ?? (doc.content ? serializePageHtml(doc.content, project.assets) : ''),
    objects: [...surface.world.layerItems.filter(item => item !== doc.source && !managed.has(item.layerItemId)),
      ...surface.surfaceLayerItems.map(entry => entry.item)].map(projectObjectSummary) }
}

function objectDocument(content: PageComposition, selected: Element, selectedIds: ReadonlySet<string>, base: { width: number; height: number }): PageComposition {
  // Retain ancestors and selectors. Other objects and ordinary scenery belong to their own carriers.
  const contains = new Set<string>()
  const mark = (node: PageNode): boolean => {
    const yes = node.id === selected.id || node.kind === 'element' && node.children.some(mark)
    if (yes) contains.add(node.id)
    return yes
  }
  mark(content.root)
  const copy = (node: PageNode, inHead = false): PageNode | undefined => {
    if (node.id === selected.id) return structuredClone(node)
    if (selectedIds.has(node.id)) return undefined
    if (node.kind !== 'element') return inHead ? structuredClone(node) : undefined
    const head = inHead || node.tagName === 'head'
    if (!head && !contains.has(node.id) && !['html', 'body', '#document'].includes(node.tagName)) return undefined
    return { ...node, children: node.children.flatMap(child => { const value = copy(child, head); return value ? [value] : [] }) }
  }
  const root = copy(content.root) as Element
  root.children.unshift({ id: `${OBJECT}${selected.id}`, kind: 'comment', text: `${OBJECT}${selected.id}` })
  const style: Element = { id: `${STYLE}${selected.id}`, kind: 'element', tagName: 'style', attributes: {}, children: [
    { id: `${STYLE}${selected.id}:text`, kind: 'text', text: `html,body{width:${base.width}px!important;height:${base.height}px!important;margin:0!important;overflow:visible!important}body{zoom:calc(100vw / ${base.width}px)}[data-composition-node="${selected.id}"]{position:relative!important;left:0!important;top:0!important}` },
  ] }
  const head = find(root, node => node.kind === 'element' && node.tagName === 'head')
  if (head?.kind === 'element') head.children.push(style)
  else root.children.unshift(style)
  return { ...content, assets: { ...content.assets }, root }
}

export function planSpaceWrite(input: { project: CourseProjectDocument; resources: DocumentResources; path: string; html: string; parse: PageParsePort; createId(): string }): PlannedChange {
  const located = targetSpace(structuredClone(input.project), input.path), project = located.project, surface = located.surface
  const previous = spaceDocument(project, surface)
  const parsed = parsePageHtml(input.html, { parse: input.parse, assets: project.assets,
    previous: previous.source?.kind === 'runtime' ? previous.source.runtime : previous.content })
  const canvas = courseSlideCanvas(project)
  const freshBase = (id: string, label: string) => ({ layerItemId: id, label, frame: { mode: 'absolute' as const, x: -canvas.width / 2, y: -canvas.height / 2, ...canvas },
    order: allocateCourseLayerOrder(project, 0), visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto' as const, playbackInitialVisibility: 'inherit' as const })
  const oldSource = previous.source
  const base = oldSource ? layerFields(oldSource) : freshBase(`${SOURCE}${input.createId()}`, surface.title)
  const managed = new Set([...previous.objects.values()].map(item => item.layerItemId))
  const independent = surface.world.layerItems.filter(item => item !== oldSource && !managed.has(item.layerItemId))
  if (parsed.kind === 'program') {
    const item: LayerItem = { ...base, kind: 'runtime', runtime: parsed.runtime }
    const frames = surface.camera.frames.map(frame => { const value = { ...frame }; if (managed.has(value.targetLayerItemId ?? '')) delete value.targetLayerItemId; return value })
    return planSpaceContentWrite({ project, resources: input.resources, surfaceId: surface.id, layerItems: [item, ...independent], frames,
      diagnostics: [...parsed.diagnostics, { level: 'warning', code: 'space-program', message: '含脚本空间已整体保真承载；不会拆分脚本中的停靠点，普通区块与独立组件可接入正式镜头旅程' }] })
  }
  const selected: Element[] = []
  const diagnostics = [...parsed.diagnostics]
  const select = (node: PageNode, body = false): void => {
    if (node.kind !== 'element' || node.tagName === 'template') return
    body ||= node.tagName === 'body'
    if (body && (isStep(node) || ['data-x', 'data-y', 'data-scale', 'data-rotate'].some(name => node.attributes[name] !== undefined))) {
      selected.push(node)
      let nested = false
      node.children.forEach(child => walk(child, child => { if (child.kind === 'element' && isStep(child)) nested = true }))
      if (nested) diagnostics.push({ level: 'warning', code: 'space-nested-step', message: '嵌套 .step 保留在外层区块内；当前只将最外层空间区块映射为独立停靠点，需独立停靠时请写成同级区块' })
      return
    }
    node.children.forEach(child => select(child, body))
  }
  select(parsed.content.root)
  const ids = new Set(selected.map(node => node.id)), items: LayerItem[] = [], frames: SpatialCameraFrame[] = []
  const replace = (node: PageNode): PageNode => ids.has(node.id) ? { id: `${SLOT}${node.id}`, kind: 'comment', text: `${SLOT}${node.id}` }
    : node.kind === 'element' ? { ...node, children: node.children.map(replace) } : node
  items.push({ ...base, kind: 'composition', content: { ...parsed.content, root: replace(parsed.content.root) as Element } })
  selected.forEach((node, index) => {
    const old = previous.objects.get(node.id), position = geometry(node, parsed.content, project)
    const fields = old ? layerFields(old) : freshBase(`spacehtml_item_${input.createId()}`, node.attributes['aria-label'] ?? node.attributes.id ?? `区块 ${index + 1}`)
    const item: CompositionLayerItem = { ...fields, kind: 'composition', frame: position.frame, rotation: position.rotation,
      ...(old ? {} : { order: allocateCourseLayerOrder({ ...project, surfaces: project.surfaces.map(value => value.id === surface.id && value.type === 'spatial-2d' ? { ...value, world: { ...value.world, layerItems: [...items, ...independent] } } : value) }, base.order + index + 1) }),
      content: objectDocument(parsed.content, node, ids, position.base) }
    items.push(item)
    if (isStep(node)) {
      const oldFrame = old && surface.camera.frames.find(frame => frame.targetLayerItemId === old.layerItemId)
      let name = node.attributes['aria-label'] || node.attributes.id
      if (!name) {
        const heading = find(node, value => value.kind === 'element' && /^h[1-6]$/.test(value.tagName))
        const text: string[] = []; if (heading) walk(heading, child => { if (child.kind === 'text') text.push(child.text) })
        name = text.join('').trim() || `停靠点 ${frames.length + 1}`
      }
      frames.push({ ...(oldFrame ?? { id: `camera_${input.createId()}` }), name, x: numeric(node, 'data-x', 0), y: numeric(node, 'data-y', 0), zoom: 1,
        rotation: item.rotation, targetLayerItemId: item.layerItemId })
    }
  })
  // Existing free/manual stops stay independent of the source's .step journey.
  const existingSpace = spaceFiles(input.project).some(file => file.path === input.path)
  const keptTargets = new Set([...frames.map(frame => frame.targetLayerItemId!), ...independent.map(item => item.layerItemId)])
  frames.push(...surface.camera.frames.filter(frame => !frames.some(value => value.id === frame.id)
    && (frame.targetLayerItemId === undefined ? existingSpace : keptTargets.has(frame.targetLayerItemId))))
  if (!frames.length && !project.locations.some(location => location.surfaceId !== surface.id))
    throw new ProjectFileError('location-required', '整课至少需要一个导航位置；当前唯一空间请保留一个 .step 停靠点')
  return planSpaceContentWrite({ project, resources: input.resources, surfaceId: surface.id, layerItems: [...items, ...independent], frames, diagnostics })
}
