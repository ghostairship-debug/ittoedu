import { componentContainerBuiltinKey, createComponentContainerInstance, type ComponentContainerAuthoring,
  componentDefinitionBuiltinKey, type ComponentInstance, type ComponentSurface, type CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import { migrateCourseProjectV10 } from '../../src/shared/contracts/component-platform/workProjectMigration'
import type { PublishedCourseV4, PublishedImplementation } from '../../src/shared/contracts/component-platform/published'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData, createTeacherControllerFrame } from '../../src/components/teacher-controller/data'

type TestContainerTree = Pick<CourseProjectV11,'rootIds' | 'entry' | 'instances' | 'definitions'>

/** Adapt a complete old consumer fixture. Migration/rejection input tests keep their raw wire instead. */
export const createTestProjectFromLegacy = (input: unknown): CourseProjectV11 => migrateCourseProjectV10(input)

/** Tests that exercise the manual controller opt into the existing professional component explicitly. */
export function withTestTeacherController(project: CourseProjectV11): CourseProjectV11 {
  if (Object.values(project.instances).some(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.navigation')) return project
  let id = 'test-teacher-controller', suffix = 2
  while (project.instances[id]) id = `test-teacher-controller:${suffix++}`
  const definition = structuredClone(TEACHER_CONTROLLER_DEFINITION)
  let definitionId = definition.id
  suffix = 2
  while (project.definitions[definitionId] && componentDefinitionBuiltinKey(project.definitions[definitionId]) !== 'guoling.navigation') definitionId = `${definition.id}:${suffix++}`
  project.definitions[definitionId] ??= { ...definition, id: definitionId }
  const root = project.entry?.rootInstanceId ?? project.rootIds[0], canvas = project.instances[root]?.container?.designSize ?? { width: 1280, height: 720 }
  project.instances[id] = { id, definitionId, name: '教师控制台', data: JSON.parse(JSON.stringify(createTeacherControllerData(canvas))), frame: createTeacherControllerFrame(canvas) }
  project.global.overlay.push(id)
  project.playback = { keyboardNavigation: true, presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    ...project.playback, controls: 'canvas' }
  return project
}

/** Published consumer fixtures retain runtime compilation and URLs while their author tree changes. */
export function createTestPublishedFromLegacy(input: unknown): PublishedCourseV4 {
  const original = input as Omit<PublishedCourseV4,'schemaVersion' | 'rootIds' | 'entry'> & { schemaVersion: 3; surfaces: ComponentSurface[] }
  const author = (implementation: PublishedImplementation) => {
    if (implementation.kind === 'builtin') return implementation
    const { compiled: _compiled, ...source } = implementation
    return source
  }
  const project = createTestProjectFromLegacy({ ...original, schemaVersion: 10, revision: 0,
    definitions: Object.fromEntries(Object.entries(original.definitions).map(([id,definition]) => [id,{ ...definition, implementation: author(definition.implementation) }])),
    instances: Object.fromEntries(Object.entries(original.instances).map(([id,instance]) => [id,{ ...instance,
      ...(instance.implementationOverride ? { implementationOverride: author(instance.implementationOverride) } : {}) }])),
    assets: Object.fromEntries(Object.entries(original.assets).map(([id,asset]) => {
      const { url: _url, ...metadata } = asset
      return [id,{ ...metadata, path: `assets/${encodeURIComponent(id)}` }]
    })),
  })
  const { revision: _revision, ...published } = project
  return { ...published, schemaVersion: 4, assets: structuredClone(original.assets),
    definitions: Object.fromEntries(Object.entries(project.definitions).map(([id,definition]) => [id,{ ...definition,
      implementation: original.definitions[id]?.implementation ?? definition.implementation }])),
    instances: Object.fromEntries(Object.entries(project.instances).map(([id,instance]) => [id,{ ...instance,
      ...(original.instances[id]?.implementationOverride ? { implementationOverride: original.instances[id].implementationOverride } : {}) }])),
  }
}

function addContainer(project: TestContainerTree, surface: ComponentSurface): void {
  const previous = project.instances[surface.id]
  if (previous && !previous.container) throw new Error(`Fixture container ID conflicts with an ordinary instance: ${surface.id}`)
  const key = componentContainerBuiltinKey(surface.kind)
  let definitionId = key, suffix = 2
  while (project.definitions[definitionId]) {
    const implementation = project.definitions[definitionId].implementation
    if (implementation.kind === 'builtin' && implementation.key === key) break
    definitionId = `${key}:${suffix++}`
  }
  project.definitions[definitionId] ??= { id: definitionId, role: 'mixed', implementation: { kind: 'builtin', key } }
  project.instances[surface.id] = createComponentContainerInstance(surface,definitionId)
}

/** Replace the fixture's root directory. Retain authored objects for the caller to attach to the new roots. */
export function setRootContainers(project: TestContainerTree, surfaces: readonly ComponentSurface[]): void {
  const ids = new Set(surfaces.map(surface => surface.id))
  for (const id of project.rootIds) if (project.instances[id]?.container && !ids.has(id)) delete project.instances[id]
  surfaces.forEach(surface => addContainer(project,surface))
  project.rootIds = surfaces.map(surface => surface.id)
  if (project.rootIds[0]) project.entry = { rootInstanceId: project.rootIds[0] }
  else delete project.entry
}

export function appendRootContainers(project: TestContainerTree, ...surfaces: ComponentSurface[]): void {
  for (const surface of surfaces) {
    addContainer(project,surface)
    if (!project.rootIds.includes(surface.id)) project.rootIds.push(surface.id)
  }
  if (!project.entry && project.rootIds[0]) project.entry = { rootInstanceId: project.rootIds[0] }
}

/** Actual fixture storage, never a derived surface view or a compatibility writer. */
export function testContainerInstance(project: TestContainerTree, idOrIndex: string | number): ComponentInstance & {
  container: ComponentContainerAuthoring; childIds: string[]
} {
  const id = typeof idOrIndex === 'number' ? project.rootIds.filter(rootId => project.instances[rootId]?.container)[idOrIndex] : idOrIndex
  const instance = project.instances[id]
  if (!instance?.container) throw new Error(`Fixture container is missing: ${idOrIndex}`)
  instance.childIds ??= []
  return instance as ComponentInstance & { container: ComponentContainerAuthoring; childIds: string[] }
}
