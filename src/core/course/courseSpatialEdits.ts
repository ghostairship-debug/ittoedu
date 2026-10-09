import { z } from 'zod'
import { componentSpatialAuthoringSchema, componentSpatialPoseSchema, owningContainer,
  type ComponentEdit, type ComponentSpatialAuthoring, type ComponentSpatialPose, type CourseProjectV10 } from '../../shared/contracts/component-platform'

/** Spatial authoring shares the Surface field and the document's canonical History. */
export function spatialAuthoringEdit(project: CourseProjectV10, surfaceId: string, change: (spatial: ComponentSpatialAuthoring) => void): ComponentEdit {
  const surface = project.surfaces.find(value => value.id === surfaceId && value.kind === 'spatial')
  if (!surface) throw new Error('空间表面已不存在')
  const spatial = structuredClone(surface.spatial ?? { home: { x: 0, y: 0, zoom: 1 }, frames: [] })
  change(spatial)
  return { type: 'spatial.set', surfaceId, spatial }
}

export function addSpatialCameraFrameEdit(project: CourseProjectV10, surfaceId: string, pose: ComponentSpatialPose, title?: string): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => spatial.frames.push({ id: crypto.randomUUID(), title: title ?? `镜头 ${spatial.frames.length + 1}`, pose: { ...pose } }))
}
export function renameSpatialCameraFrameEdit(project: CourseProjectV10, surfaceId: string, frameId: string, title: string): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    const frame = spatial.frames.find(value => value.id === frameId)
    if (!frame) throw new Error('镜头已不存在')
    frame.title = title
  })
}
export function reorderSpatialCameraFramesEdit(project: CourseProjectV10, surfaceId: string, frameIds: readonly string[]): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    if (new Set(frameIds).size !== spatial.frames.length || frameIds.length !== spatial.frames.length) throw new Error('镜头顺序已变化，请重新排序')
    spatial.frames = frameIds.map(id => { const frame = spatial.frames.find(value => value.id === id); if (!frame) throw new Error('镜头已不存在'); return frame })
  })
}
export function deleteSpatialCameraFrameEdit(project: CourseProjectV10, surfaceId: string, frameId: string): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    if (!spatial.frames.some(value => value.id === frameId)) throw new Error('镜头已不存在')
    spatial.frames = spatial.frames.filter(value => value.id !== frameId)
    for (const path of spatial.paths ?? []) path.frameIds = path.frameIds.filter(id => id !== frameId)
  })
}
export function setSpatialCameraHomeEdit(project: CourseProjectV10, surfaceId: string, pose: ComponentSpatialPose): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => { spatial.home = { ...pose } })
}
export function updateSpatialCameraFrameEdit(project: CourseProjectV10, surfaceId: string, frameId: string, pose: ComponentSpatialPose): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    const frame = spatial.frames.find(value => value.id === frameId)
    if (!frame) throw new Error('镜头已不存在')
    frame.pose = { ...pose }
    delete frame.targetInstanceId
  })
}
function worldInstance(project: CourseProjectV10, surfaceId: string, instanceId: string): boolean {
  if (!project.instances[instanceId]?.frame) return false
  let owner = owningContainer(project, instanceId)
  while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
  return owner?.kind === 'surface' && owner.surfaceId === surfaceId
}
export function updateSpatialCameraFrameTargetEdit(project: CourseProjectV10, surfaceId: string, frameId: string, instanceId: string | null): ComponentEdit {
  if (instanceId && !worldInstance(project, surfaceId, instanceId)) throw new Error('镜头跟随对象已不在当前世界中')
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    const frame = spatial.frames.find(value => value.id === frameId)
    if (!frame) throw new Error('镜头已不存在')
    if (instanceId) frame.targetInstanceId = instanceId
    else delete frame.targetInstanceId
  })
}

type GraphKind = 'paths' | 'relations' | 'semanticZoom'
type GraphItem<K extends GraphKind> = NonNullable<ComponentSpatialAuthoring[K]>[number]
const missing = { paths: '路径已不存在', relations: '关系已不存在', semanticZoom: '规则已不存在' }
export function addSpatialGraphItemEdit<K extends GraphKind>(project: CourseProjectV10, surfaceId: string, kind: K, input: Omit<GraphItem<K>, 'id'>): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, value => {
    const items = (value[kind] ?? []) as GraphItem<K>[]
    Object.assign(value, { [kind]: [...items, { ...input, id: crypto.randomUUID() }] })
  })
}
export function updateSpatialGraphItemEdit<K extends GraphKind>(project: CourseProjectV10, surfaceId: string, kind: K, id: string, patch: Partial<Omit<GraphItem<K>, 'id'>>): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, value => {
    const item = value[kind]?.find(item => item.id === id)
    if (!item) throw new Error(missing[kind])
    Object.assign(item, patch)
  })
}
export function deleteSpatialGraphItemEdit(project: CourseProjectV10, surfaceId: string, kind: GraphKind, id: string): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, value => { Object.assign(value, { [kind]: value[kind]?.filter(item => item.id !== id) }) })
}

/** Local references belong to one observed source, and never become persistent author IDs. */
export interface SpatialObservedRefs {
  frames: Record<string, string>
  paths: Record<string, string>
  relations: Record<string, string>
  semanticZoom: Record<string, string>
}
export function observeSpatialSource(project: CourseProjectV10, surfaceId: string, objectPaths: Readonly<Record<string, string>>, previousRefs?: SpatialObservedRefs) {
  const surface = project.surfaces.find(value => value.id === surfaceId && value.kind === 'spatial')
  if (!surface) throw new Error('空间表面已不存在')
  const spatial = surface.spatial ?? { home: { x: 0, y: 0, zoom: 1 }, frames: [] }
  const refs: SpatialObservedRefs = previousRefs ? structuredClone(previousRefs) : { frames: {}, paths: {}, relations: {}, semanticZoom: {} }
  const observe = (kind: keyof SpatialObservedRefs, id: string, index: number) => {
    const existing = Object.entries(refs[kind]).find(([, observedId]) => observedId === id)?.[0]
    if (existing) return existing
    let next = index + 1
    while (Object.hasOwn(refs[kind], `${kind}-${next}`)) next += 1
    const ref = `${kind}-${next}`; refs[kind][ref] = id; return ref
  }
  const frameRefs = new Map<string, string>()
  const stops = spatial.frames.map((frame, index) => {
    const ref = observe('frames', frame.id, index); frameRefs.set(frame.id, ref)
    return { ref, title: frame.title, pose: frame.pose, ...(frame.targetInstanceId ? { target: objectPaths[frame.targetInstanceId] } : {}) }
  })
  const source = { home: spatial.home, stops,
    ...(spatial.paths ? { paths: spatial.paths.map((path, index) => ({ ref: observe('paths', path.id, index), title: path.title,
      stops: path.frameIds.map(id => frameRefs.get(id)), objects: path.instanceIds?.map(id => objectPaths[id]), style: path.style })) } : {}),
    ...(spatial.relations ? { relations: spatial.relations.map((relation, index) => ({ ref: observe('relations', relation.id, index),
      from: objectPaths[relation.sourceInstanceId], to: objectPaths[relation.targetInstanceId], label: relation.label, kind: relation.kind })) } : {}),
    ...(spatial.semanticZoom ? { semanticZoom: spatial.semanticZoom.map((rule, index) => ({ ref: observe('semanticZoom', rule.id, index),
      objects: rule.instanceIds.map(id => objectPaths[id]), minZoom: rule.minZoom, maxZoom: rule.maxZoom, visible: rule.visible })) } : {}) }
  return { source, refs }
}

const ref = z.string().min(1).optional(), objectPath = z.string().min(1)
const sourcePose = z.union([componentSpatialPoseSchema, z.literal('currentViewport')])
const sourceSchema = z.object({ home: sourcePose, stops: z.array(z.object({ ref, title: z.string().optional(), pose: sourcePose, target: objectPath.optional() })),
  paths: z.array(z.object({ ref, title: z.string().optional(), stops: z.array(z.union([z.string().min(1), z.number().int().positive()])), objects: z.array(objectPath).optional(),
    style: z.object({ color: z.string().optional(), width: z.number().finite().positive().optional(), dash: z.enum(['solid', 'dashed', 'dotted']).optional() }).optional() })).optional(),
  relations: z.array(z.object({ ref, from: objectPath, to: objectPath, label: z.string().optional(), kind: z.enum(['line', 'arrow', 'bidirectional']) })).optional(),
  semanticZoom: z.array(z.object({ ref, objects: z.array(objectPath), minZoom: z.number().finite().nonnegative(), maxZoom: z.number().finite().positive(), visible: z.boolean() })).optional(),
})
export function prepareSpatialSourceEdit(project: CourseProjectV10, surfaceId: string, source: unknown, observed: SpatialObservedRefs,
  objectPaths: Readonly<Record<string, string>>, currentViewport?: ComponentSpatialPose): ComponentEdit {
  const value = sourceSchema.parse(source), prior = project.surfaces.find(surface => surface.id === surfaceId && surface.kind === 'spatial')?.spatial
  const used = new Set<string>()
  const names = { frames: '镜头', paths: '路径', relations: '关系', semanticZoom: '缩放规则' }
  const identity = (kind: keyof SpatialObservedRefs, ref: string | undefined) => {
    if (ref === undefined) return crypto.randomUUID()
    const id = observed[kind][ref], current = kind === 'frames' ? prior?.frames : prior?.[kind]
    if (!id || !current?.some(item => item.id === id)) throw new Error(`空间${names[kind]}引用已不存在：${ref}`)
    const key = `${kind}:${id}`
    if (used.has(key)) throw new Error(`空间引用重复：${ref}`)
    used.add(key); return id
  }
  const instanceId = (path: string) => {
    const id = Object.entries(objectPaths).find(([, value]) => value === path)?.[0]
    if (!id || !worldInstance(project, surfaceId, id)) throw new Error(`空间引用的对象路径尚未读取或已不在当前世界中：${path}`)
    return id
  }
  const pose = (value: z.infer<typeof sourcePose>): ComponentSpatialPose => {
    if (value !== 'currentViewport') return value
    if (!currentViewport) throw new Error('当前空间视口尚未捕获，请打开原空间视口后重试。')
    return componentSpatialPoseSchema.parse(currentViewport)
  }
  const frameRefs = new Map<string, string>()
  const frames = value.stops.map(stop => {
    const id = identity('frames', stop.ref)
    if (stop.ref) frameRefs.set(stop.ref, id)
    return { id, ...(stop.title !== undefined ? { title: stop.title } : {}), pose: pose(stop.pose), ...(stop.target ? { targetInstanceId: instanceId(stop.target) } : {}) }
  })
  const spatial = componentSpatialAuthoringSchema.parse({ home: pose(value.home), frames,
    ...(value.paths ? { paths: value.paths.map(path => ({ id: identity('paths', path.ref), ...(path.title !== undefined ? { title: path.title } : {}),
      frameIds: path.stops.flatMap(ref => {
        if (typeof ref === 'number') {
          const frame = frames[ref - 1]
          if (!frame) throw new Error(`空间路径引用的镜头不存在：${ref}`)
          return [frame.id] // A new source may name its own ordered stops without manufacturing host refs.
        }
        const id = frameRefs.get(ref)
        if (id) return [id]
        if (observed.frames[ref]) return [] // Same deletion semantics as the mature camera command.
        throw new Error(`空间路径引用的镜头尚未读取：${ref}`)
      }), ...(path.objects ? { instanceIds: path.objects.map(instanceId) } : {}), ...(path.style ? { style: path.style } : {}) })) } : {}),
    ...(value.relations ? { relations: value.relations.map(relation => ({ id: identity('relations', relation.ref), sourceInstanceId: instanceId(relation.from),
      targetInstanceId: instanceId(relation.to), ...(relation.label !== undefined ? { label: relation.label } : {}), kind: relation.kind })) } : {}),
    ...(value.semanticZoom ? { semanticZoom: value.semanticZoom.map(rule => ({ id: identity('semanticZoom', rule.ref), instanceIds: rule.objects.map(instanceId),
      minZoom: rule.minZoom, maxZoom: rule.maxZoom, visible: rule.visible })) } : {}),
  })
  return spatialAuthoringEdit(project, surfaceId, draft => {
    draft.home = spatial.home
    draft.frames = spatial.frames
    for (const kind of ['paths', 'relations', 'semanticZoom'] as const) {
      if (spatial[kind] === undefined) delete draft[kind]
      else Object.assign(draft, { [kind]: spatial[kind] })
    }
  })
}
