import { describe, expect, it } from 'vitest'
import {
  containerEditingPath, globalContainerEditingLocation, normalizeEditingContext, resolveWorkRoot,
  type ContainerEditingProject,
} from '../../src/renderer/documents/containerEditingContext'

function fixture(): ContainerEditingProject {
  return {
    rootIds: ['reading', 'program'], entry: { rootInstanceId: 'reading' },
    instances: {
      reading: { id: 'reading', definitionId: 'flow', data: {}, childIds: ['group'], container: { kind: 'flow' } },
      group: { id: 'group', definitionId: 'group', data: {}, childIds: ['outer'] },
      outer: { id: 'outer', definitionId: 'spatial', data: {}, childIds: ['inner'], container: { kind: 'spatial' } },
      inner: { id: 'inner', definitionId: 'slide', data: {}, childIds: ['title'], container: { kind: 'slide' } },
      title: { id: 'title', definitionId: 'text', data: { text: 'Editable' } },
      program: { id: 'program', definitionId: 'source', data: {}, childIds: [] },
    },
  }
}

describe('transient nested container editing context', () => {
  it('keeps an explicitly selected root and otherwise follows a valid entry or root order', () => {
    const project = fixture()
    expect(resolveWorkRoot(project, 'program')).toBe('program')
    expect(resolveWorkRoot(project, 'missing')).toBe('reading')
    project.entry = { rootInstanceId: 'missing' }
    expect(resolveWorkRoot(project)).toBe('reading')
    project.rootIds = []
    expect(resolveWorkRoot(project)).toBeNull()
  })

  it('finds container breadcrumbs through ordinary groups without crossing work roots', () => {
    const project = fixture()
    expect(containerEditingPath(project, 'reading', 'inner')).toEqual(['reading', 'outer', 'inner'])
    expect(containerEditingPath(project, 'program', 'inner')).toBeNull()
    expect(containerEditingPath(project, 'reading', 'title')).toBeNull()
  })

  it('distinguishes the selected work root from its deeper editing container', () => {
    const project = fixture()
    expect(normalizeEditingContext(project, 'reading')).toEqual({
      rootInstanceId: 'reading', editingContainerId: null, surfaceId: 'reading', path: ['reading'],
    })
    expect(normalizeEditingContext(project, 'reading', 'inner')).toEqual({
      rootInstanceId: 'reading', editingContainerId: 'inner', surfaceId: 'inner', path: ['reading', 'outer', 'inner'],
    })
    expect(normalizeEditingContext(project, 'reading', 'reading')).toEqual({
      rootInstanceId: 'reading', editingContainerId: null, surfaceId: 'reading', path: ['reading'],
    })
  })

  it('keeps a pure program root without manufacturing an editing surface', () => {
    const project = fixture(), before = structuredClone(project)
    expect(normalizeEditingContext(project, 'program')).toEqual({
      rootInstanceId: 'program', editingContainerId: null, surfaceId: null, path: ['program'],
    })
    expect(project).toEqual(before)
  })

  it('returns to the nearest surviving container when the deeper target is deleted', () => {
    const project = fixture(), oldPath = containerEditingPath(project, 'reading', 'inner')!
    delete project.instances.inner
    project.instances.outer.childIds = []
    expect(normalizeEditingContext(project, 'reading', 'inner', oldPath)).toEqual({
      rootInstanceId: 'reading', editingContainerId: 'outer', surfaceId: 'outer', path: ['reading', 'outer'],
    })
    expect(normalizeEditingContext(project, 'reading', null, oldPath).surfaceId).toBe('reading')
  })

  it('does not follow a reparented editing target into another root', () => {
    const project = fixture(), oldPath = containerEditingPath(project, 'reading', 'inner')!
    project.instances.outer.childIds = []
    project.instances.program.childIds = ['inner']
    expect(normalizeEditingContext(project, 'reading', 'inner', oldPath)).toMatchObject({
      rootInstanceId: 'reading', editingContainerId: 'outer', surfaceId: 'outer',
    })
  })

  it('discards a deleted root context and follows the remaining entry without inheriting its old breadcrumb', () => {
    const project = fixture()
    project.rootIds = ['program']
    project.entry = { rootInstanceId: 'program' }
    delete project.instances.reading
    expect(normalizeEditingContext(project, 'reading', 'inner', ['reading', 'outer', 'inner'])).toEqual({
      rootInstanceId: 'program', editingContainerId: null, surfaceId: null, path: ['program'],
    })
  })
})


it('tracks the real shared-layer ancestry without making the work root its parent', () => {
  const project = fixture()
  project.global = { underlay: [], overlay: ['shared-group'] }
  project.instances['shared-group'] = { id: 'shared-group', definitionId: 'group', data: {}, childIds: ['shared-a'] }
  project.instances['shared-a'] = { id: 'shared-a', definitionId: 'flow', data: {}, childIds: ['shared-b'], container: { kind: 'flow' } }
  project.instances['shared-b'] = { id: 'shared-b', definitionId: 'slide', data: {}, container: { kind: 'slide' } }
  expect(globalContainerEditingLocation(project, 'shared-b')).toEqual({ plane: 'overlay', path: ['shared-group', 'shared-a', 'shared-b'] })
  expect(containerEditingPath(project, 'program', 'shared-b')).toEqual(['shared-a', 'shared-b'])
  expect(normalizeEditingContext(project, 'program', 'shared-b')).toEqual({
    rootInstanceId: 'program', surfaceId: 'shared-b', editingContainerId: 'shared-b', editingPlane: 'overlay', path: ['shared-a', 'shared-b'],
  })
  expect(project.instances.program.childIds).toEqual([])
  expect(project.global.overlay).toEqual(['shared-group'])
})
