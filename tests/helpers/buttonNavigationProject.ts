import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { SHAPE_DEFINITION } from '../../src/components/shape/authoring'
import { defaultShapeData } from '../../src/components/shape/data'

export function buttonNavigationProject(kind: 'slide' | 'flow' | 'spatial' = 'spatial') {
  const project = createBlankCourseProjectV10('Button camera navigation')
  const frame = { width: 100, height: 80, transform: [1, 0, 0, 1, 150, -40] as [number, number, number, number, number, number] }
  project.surfaces = [{ id: 'A', title: 'Before', kind, childIds: ['button'], designSize: { width: 1280, height: 720 },
    ...(kind === 'spatial' ? { spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'a-first', title: 'A first', pose: { x: 200, y: 0, zoom: 1 } }] } } : {}),
    ...(kind === 'flow' ? { flow: { layout: { widthMode: 'fluid' as const, readingWidth: 900, wideContentWidth: 1100 } } } : {}),
  }, { id: 'B', title: 'Camera page', kind: 'spatial', childIds: [], designSize: { width: 1280, height: 720 },
    spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [
      { id: 'b-first', title: 'B first', pose: { x: 400, y: 0, zoom: 1 } }, { id: 'b-last', title: 'B last', pose: { x: 900, y: 0, zoom: 1 } },
    ] } }]
  project.definitions[SHAPE_DEFINITION.id] = SHAPE_DEFINITION
  project.instances.button = { id: 'button', name: 'Hotspot', definitionId: SHAPE_DEFINITION.id, data: defaultShapeData(), frame,
    ...(kind === 'flow' ? { flowPlacement: { space: 'viewport' as const, plane: 'overlay' as const } } : {}) }
  project.instances['global-button'] = { id: 'global-button', name: 'Global hotspot', definitionId: SHAPE_DEFINITION.id,
    data: defaultShapeData(), frame: { ...frame, transform: [1, 0, 0, 1, 320, 40] } }
  project.global.overlay.push('global-button')
  return project
}
