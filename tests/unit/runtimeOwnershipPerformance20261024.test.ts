import { describe, expect, it } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { containerIsActive, instanceContainerId, instanceWorkRootId, isWithinContainer } from '../../src/player/components/runtime/containerScopes'

function work(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'ownership', revision: 1, title: 'Ownership', rootIds: ['flow', 'other'],
    definitions: {}, assets: {}, global: { underlay: ['global'], overlay: [] },
    instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, container: { kind: 'flow' }, childIds: ['section'] },
      section: { id: 'section', definitionId: 'group', data: {}, childIds: ['slide'] },
      slide: { id: 'slide', definitionId: 'slide', data: {}, container: { kind: 'slide' }, childIds: ['leaf'] },
      leaf: { id: 'leaf', definitionId: 'text', data: {} },
      other: { id: 'other', definitionId: 'slide', data: {}, container: { kind: 'slide' }, childIds: [] },
      global: { id: 'global', definitionId: 'group', data: {}, childIds: ['global-leaf'] },
      'global-leaf': { id: 'global-leaf', definitionId: 'text', data: {} },
    } }
}

describe('runtime ownership derived from the formal snapshot', () => {
  it('retains nested scopes, global ownership, missing targets and ancestor visibility', () => {
    const project = work()
    expect(instanceContainerId(project, 'leaf')).toBe('slide')
    expect(instanceContainerId(project, 'slide')).toBe('flow')
    expect(instanceContainerId(project, 'slide', true)).toBe('slide')
    expect(instanceWorkRootId(project, 'leaf')).toBe('flow')
    expect(instanceWorkRootId(project, 'global-leaf')).toBeNull()
    expect(instanceWorkRootId(project, 'missing')).toBeUndefined()
    expect(isWithinContainer(project, 'leaf', 'section')).toBe(true)
    expect(isWithinContainer(project, 'leaf', 'other')).toBe(false)
    expect(containerIsActive(project, 'slide', 'flow')).toBe(true)
    expect(containerIsActive(project, 'slide', 'other')).toBe(false)
    const hidden = { ...project, instances: { ...project.instances, section: { ...project.instances.section, visible: false } } }
    expect(containerIsActive(hidden, 'slide', 'flow')).toBe(false)
  })

  it('follows move, Undo and Redo snapshots without changing the author tree', () => {
    const before = work(), saved = structuredClone(before)
    expect(instanceWorkRootId(before, 'leaf')).toBe('flow')
    const after: CourseProjectV10 = { ...before, revision: 2, instances: { ...before.instances,
      section: { ...before.instances.section, childIds: [] }, other: { ...before.instances.other, childIds: ['slide'] } } }
    expect(instanceWorkRootId(after, 'leaf')).toBe('other')
    expect(instanceContainerId(after, 'slide')).toBe('other')
    expect(instanceWorkRootId(before, 'leaf')).toBe('flow')
    expect(instanceWorkRootId(after, 'leaf')).toBe('other')
    expect(before).toEqual(saved)
  })

  it('indexes once for repeated runtime reads and invalidates when the projected instance map changes', () => {
    const project = work()
    let enumerations = 0
    project.instances = new Proxy(project.instances, { ownKeys(value) { enumerations++; return Reflect.ownKeys(value) } })
    for (let n = 0; n < 500; n++) {
      expect(instanceWorkRootId(project, 'leaf')).toBe('flow')
      expect(instanceContainerId(project, 'leaf')).toBe('slide')
      expect(containerIsActive(project, 'slide', 'flow')).toBe(true)
    }
    expect(enumerations).toBe(1)
    project.instances = { ...project.instances, section: { ...project.instances.section, childIds: [] },
      other: { ...project.instances.other, childIds: ['slide'] } }
    expect(instanceWorkRootId(project, 'leaf')).toBe('other')
  })

  it('terminates malformed cycles while preserving the existing root and global precedence', () => {
    const project = work()
    project.instances.loopA = { id: 'loopA', definitionId: 'group', data: {}, childIds: ['loopB', 'flow', 'global'] }
    project.instances.loopB = { id: 'loopB', definitionId: 'group', data: {}, childIds: ['loopA'] }
    expect(instanceWorkRootId(project, 'loopA')).toBeUndefined()
    expect(instanceContainerId(project, 'loopA')).toBeNull()
    expect(isWithinContainer(project, 'loopA', 'missing')).toBe(false)
    expect(instanceWorkRootId(project, 'flow')).toBe('flow')
    expect(instanceWorkRootId(project, 'global')).toBeNull()
  })
})
