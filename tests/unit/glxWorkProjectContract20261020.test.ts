// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { componentContainers, componentSurface, componentSurfaces, containerChildIds, owningContainer,
  resolveComponentPresentation, type CourseProjectV11, type LegacyCourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { componentOperationBatchSchema, courseProjectV10Schema, courseProjectV11Schema,
  legacyCourseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { publishedCourseV3Schema, publishedCourseV4Schema } from '../../src/shared/contracts/component-platform/published'
import { createWorkProjectMigrationMap, migrateCourseProjectV10, migrateCourseProjectV10Models,
  normalizeWorkProject } from '../../src/shared/contracts/component-platform/workProjectMigration'

function legacy(): LegacyCourseProjectV10 {
  return {
    schemaVersion: 10, id: 'work', revision: 7, title: '保留原内容',
    definitions: {
      text: { id: 'text', role: 'content', implementation: { kind: 'source', source: 'export const original = "a"', language: 'javascript' } },
      behavior: { id: 'behavior', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } },
    },
    instances: {
      a: { id: 'a', definitionId: 'text', data: { text: '原正文' }, frame: { width: 200, height: 80, transform: [1, 0, 0, 1, 12, 24] } },
      bText: { id: 'bText', definitionId: 'text', data: { text: '第二处正文' } },
      global: { id: 'global', definitionId: 'behavior', visibility: { mode: 'include', surfaceIds: ['a'] },
        data: { rules: [{ id: 'rule', trigger: { type: 'scene.enter' }, conditions: [{ type: 'scene.in', sceneIds: ['a'] }],
          actions: [{ id: 'action', action: { type: 'scene.go', sceneId: 'a' } }] }] },
        attachments: [{ instanceId: 'global', target: { kind: 'surface', surfaceId: 'a' } }] },
    },
    surfaces: [
      { id: 'a', kind: 'slide', title: '第一处', childIds: ['a'], presentation: { initialStateId: 'overview', states: [
        { id: 'overview', title: '概览', overrides: { a: { data: { text: '状态正文' } } } },
      ] } },
      { id: 'b', kind: 'slide', title: '第二处', childIds: ['bText'], presentation: { initialStateId: 'overview', states: [
        { id: 'overview', title: '概览', overrides: {} },
      ] } },
    ],
    global: { underlay: [], overlay: ['global'] }, assets: { image: { id: 'image', path: 'assets/image.png' } },
    logic: { courseState: [], navigationGuards: [{ id: 'guard', effect: 'block', fromSurfaceIds: ['a'], toSurfaceIds: ['b'],
      match: 'all', conditions: [], message: '原提示' }] },
  }
}

describe('GLX work Project 11 canonical contracts', () => {
  it('maps V10 roots once, preserves content/geometry/global and rewrites only declared container references', () => {
    const input = legacy(), before = structuredClone(input)
    expect(legacyCourseProjectV10Schema.safeParse(input).success).toBe(true)
    const project = migrateCourseProjectV10(input)
    expect(project.schemaVersion).toBe(11)
    expect(project).not.toHaveProperty('surfaces')
    expect(project.rootIds).toEqual(['container:a', 'b'])
    expect(project.entry).toEqual({ rootInstanceId: 'container:a' })
    expect(project.instances.a).toEqual(input.instances.a)
    expect(project.definitions.text).toEqual(input.definitions.text)
    expect(project.global).toEqual(input.global)
    expect(project.assets).toEqual(input.assets)
    expect(project.revision).toBe(7)
    expect(project.instances.global.visibility?.surfaceIds).toEqual(['container:a'])
    expect(project.instances.global.attachments?.[0].target).toEqual({ kind: 'instance', instanceId: 'container:a' })
    expect(project.instances.global.data).toMatchObject({ rules: [{ id: 'rule', conditions: [{ sceneIds: ['container:a'] }],
      actions: [{ id: 'action', action: { sceneId: 'container:a' } }] }] })
    expect(project.logic?.navigationGuards[0]).toMatchObject({ fromSurfaceIds: ['container:a'], toSurfaceIds: ['b'] })
    expect(input).toEqual(before)
  })

  it('shares collision identities across before/current/history models without rebuilding local state IDs', () => {
    const earlier = legacy(), later = legacy()
    // The instance collision exists only in the later historical version.
    earlier.instances.firstText = { ...earlier.instances.a, id: 'firstText' }
    delete earlier.instances.a
    earlier.surfaces[0].childIds = ['firstText']
    earlier.surfaces[0].presentation!.states[0].overrides = { firstText: { data: { text: '较早正文' } } }
    const identities = createWorkProjectMigrationMap([earlier, later])
    const converted = migrateCourseProjectV10Models([earlier, later])
    expect(identities.surfaceIds.a).toBe('container:a')
    expect(converted.map(project => project.rootIds[0])).toEqual(['container:a', 'container:a'])
    for (const project of converted) expect(componentContainers(project).map(surface => surface.presentation?.states[0].id)).toEqual(['overview', 'overview'])
    expect(normalizeWorkProject(converted[0])).toEqual(converted[0])
  })

  it('extends a bound read map for new external V10 containers while preserving earlier instance identities', () => {
    const input = legacy(), existing = createWorkProjectMigrationMap([input]), savedMap = structuredClone(existing)
    const later = legacy()
    later.instances.extra = { id: 'extra', definitionId: 'text', data: { text: '新增内容' } }
    later.surfaces[0].childIds.push('extra')
    later.surfaces.push({ id: 'extra', kind: 'flow', title: '新增同名讲义', childIds: [] })
    const previousDefinitionId = existing.containerDefinitionIds.flow
    later.definitions[previousDefinitionId] = { id: previousDefinitionId, role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
    const extended = createWorkProjectMigrationMap([later],existing)
    expect(extended.surfaceIds.a).toBe(existing.surfaceIds.a)
    expect(extended.surfaceIds.b).toBe(existing.surfaceIds.b)
    expect(extended.surfaceIds.extra).toBe('container:extra')
    expect(extended.containerDefinitionIds.flow).not.toBe(previousDefinitionId)
    expect(existing).toEqual(savedMap)
    const normalized = normalizeWorkProject(later,extended)
    expect(normalized.instances.extra.data).toEqual({ text: '新增内容' })
    expect(normalized.definitions[previousDefinitionId]).toEqual(later.definitions[previousDefinitionId])
    expect(normalized.instances['container:extra'].definitionId).toBe(extended.containerDefinitionIds.flow)
    expect(normalized.definitions[extended.containerDefinitionIds.flow].implementation).toEqual({ kind: 'builtin', key: 'guoling.container.flow' })
  })

  it('reallocates only a synthetic root identity newly occupied by an external ordinary object', () => {
    const input = legacy(), existing = createWorkProjectMigrationMap([input]), original = migrateCourseProjectV10(input,{ identities: existing })
    const changed = legacy(), occupied = existing.surfaceIds.a
    changed.instances[occupied] = { id: occupied, definitionId: 'text', data: { text: '外部新增对象' } }
    changed.surfaces[0].childIds.push(occupied)
    const extended = createWorkProjectMigrationMap([changed],existing)
    expect(extended.surfaceIds.a).not.toBe(occupied)
    expect(extended.surfaceIds.b).toBe(existing.surfaceIds.b)
    const next = migrateCourseProjectV10(changed,{ identities: extended })
    expect(next.instances[occupied].data).toEqual({ text: '外部新增对象' })
    expect(next.instances[extended.surfaceIds.a].childIds).toContain(occupied)
    expect(original.rootIds[0]).toBe(occupied)
    expect(existing.surfaceIds.a).toBe(occupied)
    expect(createWorkProjectMigrationMap([changed],extended)).toEqual(extended)
  })

  it('keeps roots separate from nested containers and borrows snapshot configuration without cloning overrides', () => {
    const project = migrateCourseProjectV10(legacy())
    project.instances.nested = { id: 'nested', definitionId: project.instances.b.definitionId, name: '局部容器', data: {}, childIds: [], container: { kind: 'spatial',
      spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } }
    project.instances['container:a'].childIds!.push('nested')
    expect(courseProjectV11Schema.safeParse(project).success).toBe(true)
    expect(componentSurfaces(project).map(surface => surface.id)).toEqual(['container:a', 'b'])
    expect(componentContainers(project).map(surface => surface.id)).toContain('nested')
    const view = componentSurface(project, 'container:a')!
    expect(view.childIds).toBe(project.instances['container:a'].childIds)
    expect(view.presentation).toBe(project.instances['container:a'].container!.presentation)
    expect(componentSurfaces(project)[0].presentation?.states[0].overrides)
      .toBe(project.instances['container:a'].container!.presentation!.states[0].overrides)
    // A mutable planning owner can replace an instance; readers must not cache an older view.
    const original = project.instances['container:a']
    project.instances['container:a'] = { ...original, name: '规划中的新标题', container: { ...original.container!,
      presentation: { states: [{ id: 'detail', title: '新状态', overrides: {} }] } } }
    expect(componentSurface(project, 'container:a')).toMatchObject({ title: '规划中的新标题', presentation: { states: [{ id: 'detail' }] } })
    expect(owningContainer(project, 'container:a')).toEqual({ kind: 'project' })
    expect(owningContainer(project, 'a')).toEqual({ kind: 'instance', instanceId: 'container:a' })
    expect(containerChildIds(project, { kind: 'project' })).toBe(project.rootIds)
    expect(containerChildIds(project, { kind: 'instance', instanceId: 'container:a' })).toBe(project.instances['container:a'].childIds)
  })

  it('projects a named state without creating a second persisted surface tree or changing its author', () => {
    const project = migrateCourseProjectV10(legacy())
    const before = structuredClone(project)
    const projected = resolveComponentPresentation(project, 'container:a', 'overview')
    expect(projected.instances.a.data).toEqual({ text: '状态正文' })
    expect(projected.rootIds).toEqual(project.rootIds)
    expect(projected).not.toHaveProperty('surfaces')
    expect(project).toEqual(before)
  })

  it('requires one ownership tree and a valid root entry while keeping source-only and empty drafts legal', () => {
    const sourceOnly: CourseProjectV11 = { schemaVersion: 11, id: 'source', revision: 0, title: '程序',
      definitions: { source: { id: 'source', role: 'mixed', implementation: { kind: 'source', source: 'export function mount(){}', language: 'javascript' } } },
      instances: { program: { id: 'program', definitionId: 'source', data: {} } }, rootIds: ['program'], entry: { rootInstanceId: 'program' },
      global: { underlay: [], overlay: [] }, assets: {} }
    expect(courseProjectV10Schema.safeParse(sourceOnly).success).toBe(true)
    expect(componentSurfaces(sourceOnly)).toEqual([])
    expect(courseProjectV11Schema.safeParse({ ...sourceOnly, entry: { rootInstanceId: 'missing' } }).success).toBe(false)
    expect(courseProjectV11Schema.safeParse({ ...sourceOnly, global: { underlay: ['program'], overlay: [] } }).success).toBe(false)
    expect(courseProjectV11Schema.safeParse({ ...sourceOnly, rootIds: [], entry: undefined }).success).toBe(false)
    expect(courseProjectV11Schema.safeParse({ ...sourceOnly, instances: {}, rootIds: [], entry: undefined }).success).toBe(true)
    expect(courseProjectV11Schema.safeParse({ ...sourceOnly, surfaces: [] }).success).toBe(false)
    expect(courseProjectV11Schema.safeParse(legacy()).success).toBe(false)
  })

  it('supports typed entry/container operations and Published 4 while rejecting old persisted wires', () => {
    const project = migrateCourseProjectV10(legacy())
    expect(componentOperationBatchSchema.safeParse({ type: 'component-platform.apply', expected: [], edits: [
      { type: 'project.entry.set', entry: { rootInstanceId: 'b' } },
      { type: 'container.patch', instanceId: 'b', patch: { presentation: null, designSize: { width: 800, height: 600 } } },
    ] }).success).toBe(true)
    expect(componentOperationBatchSchema.safeParse({ type: 'component-platform.apply', expected: [], edits: [
      { type: 'container.patch', instanceId: 'b', patch: {} },
    ] }).success).toBe(false)
    const { revision: _revision, assets: _assets, ...runtime } = project
    const published = { ...runtime, schemaVersion: 4, assets: {} }
    expect(publishedCourseV4Schema.safeParse(published).success).toBe(true)
    expect(publishedCourseV3Schema.safeParse(published).success).toBe(true)
    expect(publishedCourseV4Schema.safeParse({ ...published, schemaVersion: 3 }).success).toBe(false)
    expect(publishedCourseV4Schema.safeParse({ ...published, surfaces: [] }).success).toBe(false)
    const publishedSnapshot = publishedCourseV4Schema.parse(published)
    expect(componentSurfaces(publishedSnapshot).map(surface => surface.id)).toEqual(project.rootIds)
    expect(componentSurface(publishedSnapshot, 'container:a')?.presentation)
      .toBe(publishedSnapshot.instances['container:a'].container!.presentation)
    expect(componentContainers(publishedSnapshot)).toHaveLength(2)
    expect(() => z.toJSONSchema(courseProjectV11Schema, { io: 'input' })).not.toThrow()
  })
})
