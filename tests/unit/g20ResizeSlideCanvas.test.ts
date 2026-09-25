// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { selectActiveCourseProjectDocument, useEditorStore } from '@/renderer/store/editorStore'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { resizeCourseSlideCanvas } from '@/core/course/resizeSlideCanvas'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { addCourseFlowPage, addCourseSlidePage } from '@/core/tools/courseLocations'
import { allocateCourseLayerOrder } from '@/core/tools/layerOrder'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { appendSlideSurfaceLayer } from '@/core/tools/slideStructuredInsertion'
import { planSlideShapeInsertion, planSlideTextInsertion } from '@/core/tools/slideInsertion'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, SlideSurfaceDocument } from '@/shared/courseProjectTypes'
import { courseSlideCanvas } from '@/shared/slideCanvas'

function slideOf(project: CourseProjectDocument): SlideSurfaceDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('missing slide')
  return surface
}

function sceneItem(project: CourseProjectDocument, id: string) {
  const item = slideOf(project).scenes[0]?.layerItems.find((candidate) => candidate.layerItemId === id)
  if (!item) throw new Error(`missing ${id}`)
  return item
}

function buildProject(): CourseProjectDocument {
  let project = createBlankCourseProject({ now: '2026-01-01T00:00:00.000Z' })
  const location = project.locations.find((candidate) => candidate.kind === 'slide-scene')
  if (!location || location.kind !== 'slide-scene') throw new Error('missing slide location')
  const owner = { scope: 'scene', selection: { locationId: location.id, stateId: null as string | null } }
  project = planSlideTextInsertion(project, owner, { id: 'title', text: '标题' }).project
  project = planSlideShapeInsertion(project, owner, {
    id: 'line',
    shapeType: 'line',
    frame: { x: 100, y: 200, width: 400, height: 40 },
    lineGeometry: { kind: 'straight', start: [0, 0.25], end: [1, 0.75] },
  }).project
  const surfaceText = sceneNodeToCourseLayerItem(createTextNode({
    id: 'surface-label',
    name: '页眉',
    text: '页眉',
    x: 40,
    y: 24,
    width: 200,
    height: 48,
    style: { fontSize: 24 },
  }))
  appendSlideSurfaceLayer(project, slideOf(project), surfaceText)
  const runtime = sceneNodeToCourseLayerItem({
    id: 'runtime-box',
    name: '动态',
    type: 'text',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    playbackInitialVisibility: 'inherit',
    text: 'x',
    runs: [],
    style: {
      fontFamily: 'sans-serif',
      fontSize: 16,
      color: '#111111',
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      emphasis: false,
      highlightColor: null,
      align: 'left',
      verticalAlign: 'top',
      writingMode: 'horizontal',
      lineSpacing: 0,
      letterSpacing: 0,
      padding: 0,
      overflow: 'fixed',
      backgroundColor: '#ffffff',
      backgroundOpacity: 0,
      cornerRadius: 0,
    },
  })
  runtime.layerItemId = 'runtime-box'
  runtime.kind = 'runtime'
  runtime.label = '动态'
  runtime.frame = { mode: 'absolute', x: 48, y: 64, width: 320, height: 180 }
  delete (runtime as { content?: unknown }).content
  ;(runtime as { runtime: unknown }).runtime = {
    protocol: 'canvas-runtime',
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: 'dom',
    source: 'CoursewareRuntime.define({ runtimeApiVersion: 2, create() { return { destroy() {} } } })',
    content: { values: {} },
    assets: {},
  }
  runtime.order = allocateCourseLayerOrder(project, 0)
  slideOf(project).scenes[0]!.layerItems.push(runtime)
  const component = sceneNodeToCourseLayerItem(createTextNode({ id: 'widget', text: '组件', x: 80, y: 90, width: 160, height: 80 }))
  component.layerItemId = 'widget'
  component.kind = 'component'
  component.label = '组件'
  component.frame = { mode: 'absolute', x: 80, y: 90, width: 160, height: 80 }
  delete (component as { content?: unknown }).content
  ;(component as { component: unknown; props: unknown }).component = { packageId: 'pkg.widget', version: '1.0.0' }
  ;(component as { props: unknown }).props = { label: '组件' }
  const packageId = Object.keys(project.componentPackages)[0]
  if (!packageId) throw new Error('missing component package')
  ;(component as { component: { packageId: string; version: string } }).component = {
    packageId,
    version: project.componentPackages[packageId]!.version,
  }
  component.order = allocateCourseLayerOrder(project, 0)
  slideOf(project).scenes[0]!.layerItems.push(component)
  const scene = slideOf(project).scenes[0]!
  scene.presentation?.states.push({
    id: 'state_emphasis',
    name: '强调',
    layerItemOverrides: {
      title: {
        frame: { mode: 'absolute', x: 80, y: 90, width: 400, height: 80 },
        nativeData: { style: { fontSize: 56 } },
      },
    },
  })
  const flow = addCourseFlowPage(project, { now: '2026-01-01T00:00:00.000Z' })
  if (!flow.ok) throw new Error(flow.reason)
  project = flow.project
  const flowLocation = project.locations.find((location) => location.kind === 'flow-block')
  if (!flowLocation) throw new Error('missing flow location')
  const flowOnly = sceneNodeToCourseLayerItem(createTextNode({
    id: 'flow-only',
    text: '讲义角标',
    x: 30,
    y: 40,
    width: 120,
    height: 36,
  }))
  flowOnly.order = allocateCourseLayerOrder(project, 0)
  project.globalLayerItems.push({
    item: flowOnly,
    visibility: { mode: 'include', locationIds: [flowLocation.id] },
    plane: 'overlay',
  })
  return courseProjectDocumentSchema.parse(project)
}

describe('resizeCourseSlideCanvas', () => {

  it('leaves a 1280×720 project unchanged', () => {
    const project = buildProject()
    expect(resizeCourseSlideCanvas(project, { width: 1280, height: 720 })).toBe(project)
  })

  it('fits 16:9 into 4:3 and portrait, centering the uniform scale', () => {
    const project = buildProject()
    const beforeFlow = structuredClone(project.surfaces.find((surface) => surface.type === 'flow'))
    const beforeFlowOnly = structuredClone(project.globalLayerItems.find((entry) => entry.item.layerItemId === 'flow-only'))
    const title = sceneItem(project, 'title')
    const line = sceneItem(project, 'line')
    const runtime = sceneItem(project, 'runtime-box')
    const widget = sceneItem(project, 'widget')
    const surfaceLabel = slideOf(project).surfaceLayerItems.find((entry) => entry.item.layerItemId === 'surface-label')!.item
    const controller = project.globalLayerItems.find((entry) => entry.item.kind === 'component' && entry.item.role === 'teacher-controller')!.item
    const named = slideOf(project).scenes[0]!.presentation!.states.find((state) => state.id === 'state_emphasis')!
    if (title.kind !== 'native' || title.content.nativeType !== 'text') throw new Error('title')
    if (line.kind !== 'native' || line.content.nativeType !== 'shape' || !line.content.data.lineGeometry) throw new Error('line')
    const lineGeometry = line.content.data.lineGeometry
    const fontSize = title.content.data.style.fontSize
    const borderWidth = line.content.data.style.borderWidth

    const cases = [
      { width: 1024, height: 768 },
      { width: 720, height: 1280 },
    ]
    for (const next of cases) {
      const old = courseSlideCanvas(project)
      const s = Math.min(next.width / old.width, next.height / old.height)
      const dx = (next.width - old.width * s) / 2
      const dy = (next.height - old.height * s) / 2
      const resized = resizeCourseSlideCanvas(project, next)
      expect(courseProjectDocumentSchema.safeParse(resized).success).toBe(true)
      expect(slideOf(resized).canvas).toEqual(next)
      expect(resized.surfaces.filter((surface) => surface.type === 'slide').every((surface) => surface.type === 'slide' && surface.canvas.width === next.width)).toBe(true)
      const nextTitle = sceneItem(resized, 'title')
      const nextLine = sceneItem(resized, 'line')
      const nextRuntime = sceneItem(resized, 'runtime-box')
      const nextWidget = sceneItem(resized, 'widget')
      const nextSurface = slideOf(resized).surfaceLayerItems.find((entry) => entry.item.layerItemId === 'surface-label')!.item
      const nextController = resized.globalLayerItems.find((entry) => entry.item.kind === 'component' && entry.item.role === 'teacher-controller')!.item
      const nextNamed = slideOf(resized).scenes[0]!.presentation!.states.find((state) => state.id === 'state_emphasis')!
      expect(nextTitle.frame).toMatchObject({
        x: title.frame.x * s + dx,
        y: title.frame.y * s + dy,
        width: title.frame.width * s,
        height: title.frame.height * s,
      })
      if (nextTitle.kind !== 'native' || nextTitle.content.nativeType !== 'text') throw new Error('resized title')
      expect(nextTitle.content.data.style.fontSize).toBeCloseTo(fontSize * s)
      expect(nextSurface.frame.x).toBeCloseTo(surfaceLabel.frame.x * s + dx)
      expect(nextController.frame).toMatchObject({
        x: controller.frame.x * s + dx,
        y: controller.frame.y * s + dy,
        width: controller.frame.width * s,
        height: controller.frame.height * s,
      })
      expect(nextRuntime.frame).toMatchObject({
        x: runtime.frame.x * s + dx,
        y: runtime.frame.y * s + dy,
        width: runtime.frame.width * s,
        height: runtime.frame.height * s,
      })
      expect(nextRuntime.kind).toBe('runtime')
      expect(nextWidget.frame).toMatchObject({
        x: widget.frame.x * s + dx,
        width: widget.frame.width * s,
        height: widget.frame.height * s,
      })
      expect(nextWidget.kind).toBe('component')
      if (nextLine.kind !== 'native' || nextLine.content.nativeType !== 'shape' || !nextLine.content.data.lineGeometry) throw new Error('resized line')
      expect(nextLine.content.data.lineGeometry).toEqual(lineGeometry)
      expect(nextLine.content.data.style.borderWidth).toBeCloseTo(borderWidth * s)
      const canvasStartX = line.frame.x + lineGeometry.start[0] * line.frame.width
      const canvasStartY = line.frame.y + lineGeometry.start[1] * line.frame.height
      const resizedStartX = nextLine.frame.x + nextLine.content.data.lineGeometry.start[0] * nextLine.frame.width
      const resizedStartY = nextLine.frame.y + nextLine.content.data.lineGeometry.start[1] * nextLine.frame.height
      expect(resizedStartX).toBeCloseTo(canvasStartX * s + dx)
      expect(resizedStartY).toBeCloseTo(canvasStartY * s + dy)
      expect(nextNamed.layerItemOverrides.title?.frame).toMatchObject({
        x: 80 * s + dx,
        y: 90 * s + dy,
        width: 400 * s,
        height: 80 * s,
      })
      expect(nextNamed.layerItemOverrides.title?.nativeData).toMatchObject({ style: { fontSize: 56 * s } })
      expect(resized.surfaces.find((surface) => surface.type === 'flow')).toEqual(beforeFlow)
      expect(resized.globalLayerItems.find((entry) => entry.item.layerItemId === 'flow-only')).toEqual(beforeFlowOnly)
    }
  })

  it('records one editor undo step for a canvas resize', async () => {
    const host = await createCourseStoreHost()
    await host.open(createBlankCourseProject({ now: '2026-01-01T00:00:00.000Z' }))
    const before = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState()))
    if (!before) throw new Error('missing project')
    const result = useEditorStore.getState().resizeSlideCanvas({ width: 1024, height: 768 })
    expect(result.ok).toBe(true)
    await useEditorStore.getState().drainCourseDocument()
    const resized = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(useEditorStore.getState().errorMessage ?? '').toBe('')
    expect(courseSlideCanvas(resized!)).toEqual({ width: 1024, height: 768 })
    expect(resized!.revision).toBe(before.revision + 1)
    useEditorStore.getState().undo()
    await useEditorStore.getState().drainCourseDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const restored = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(courseSlideCanvas(restored!)).toEqual(courseSlideCanvas(before))
    expect(restored!.globalLayerItems.map((entry) => entry.item.frame)).toEqual(before.globalLayerItems.map((entry) => entry.item.frame))
  })

  it('keeps a later slide page on the resized canvas', () => {
    const resized = resizeCourseSlideCanvas(buildProject(), { width: 1024, height: 768 })
    const added = addCourseSlidePage(resized, { now: '2026-01-02T00:00:00.000Z' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.project.surfaces.filter((surface) => surface.type === 'slide').every((surface) => (
      surface.type === 'slide' && surface.canvas.width === 1024 && surface.canvas.height === 768
    ))).toBe(true)
  })
})
