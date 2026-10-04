import { normalizeCourseProject } from '../../src/core/course/normalizeCourseProject'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'
import type { CompositionNode } from '../../src/shared/composition/content'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CompositionLayerItem, CourseProjectDocument, CourseRuntimeDefinition, SpatialSurfaceDocument } from '../../src/shared/courseProjectTypes'

type Node = CompositionNode<CourseRuntimeDefinition>
const element = (id: string, tagName: string, attributes: Record<string, string>, children: Node[] = []): Node => ({ id, kind: 'element', tagName, attributes, children })
const text = (id: string, value: string): Node => ({ id, kind: 'text', text: value })

/** A card of the world whose paragraphs appear one by one. */
export function spatialCard(id: string, frame: { x: number; y: number; width: number; height: number }, rotation: number, steps: readonly string[]): CompositionLayerItem {
  return {
    layerItemId: id, label: id, kind: 'composition', order: 0, visible: true, locked: false, rotation, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', ...frame },
    content: { assets: {}, root: element(`${id}-doc`, '#document', {}, [element(`${id}-body`, 'body', {}, [
      element(`${id}-title`, 'h2', {}, [text(`${id}-title-text`, id)]),
      ...steps.map((step, index) => element(`${id}-step-${index + 1}`, 'p', { class: 'fragment' }, [text(`${id}-step-${index + 1}-text`, step)])),
    ])]) },
  }
}

/** An overview, two cards and a later whole-card revisit. */
export function spatialStopsProject(includeDefaultController = false): CourseProjectDocument {
  let next = 0
  const project = createBlankSpatialCourseProject({ id: 'space', now: '2026-10-04T00:00:00.000Z',
    ...(includeDefaultController ? { includeDefaultController: true, controls: 'canvas' } as const : { includeDefaultController: false, controls: 'none' } as const),
    idFactory: () => `n${++next}` })
  const surface = project.surfaces[0] as SpatialSurfaceDocument
  surface.world.layerItems.push(spatialCard('a', { x: 0, y: 0, width: 400, height: 300 }, 30, ['甲', '乙']),
    { ...spatialCard('b', { x: 1000, y: 0, width: 200, height: 100 }, 0, ['丙']), order: 1 })
  surface.camera.frames.push(
    { id: 'stop-a', name: '甲卡', x: 0, y: 0, zoom: 1, targetLayerItemId: 'a' },
    { id: 'stop-b', name: '乙卡', x: 0, y: 0, zoom: 1, targetLayerItemId: 'b' },
    { id: 'stop-a2', name: '回看', x: 0, y: 0, zoom: 1, targetLayerItemId: 'a' },
  )
  for (const id of ['stop-a', 'stop-b', 'stop-a2']) project.locations.push({ id, label: id, kind: 'spatial-camera', surfaceId: surface.id, cameraFrameId: id })
  return normalizeCourseProject(courseProjectDocumentSchema.parse(project))
}
