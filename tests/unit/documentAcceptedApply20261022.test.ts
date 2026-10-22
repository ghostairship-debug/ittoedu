// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { DocumentModel } from '../../src/shared/workbench/document'
import { applyDocumentAcceptedChange, createDocumentAcceptedChange } from '../../src/core/documents/documentStateEffects'

function fixture() {
  const project = createBlankCourseProjectV10('Shared apply')
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.instances.first = { id: 'first', definitionId: 'custom', data: { left: { text: 'before' }, right: { retained: 'large'.repeat(10000) } } }
  project.instances.second = { id: 'second', definitionId: 'custom', data: { retained: 'neighbor'.repeat(10000) } }
  project.instances[project.rootIds[0]].childIds!.push('first', 'second')
  const model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
  return { driver: new CourseV10Driver(), model }
}

describe('owned accepted component apply', () => {
  it('changes only the owned field ancestors and retains unrelated objects and data', () => {
    const { driver, model } = fixture()
    const next = driver.applyValidatedWithChanges(model, captureComponentOperation(model.project,
      [{ type: 'data.set', instanceId: 'first', path: ['left', 'text'], value: 'after' }]))
    if (next.model.kind !== 'course-v10') throw new Error('expected work project')
    expect(next.model.project.instances.second).toBe(model.project.instances.second)
    expect(next.model.project.instances[model.project.rootIds[0]]).toBe(model.project.instances[model.project.rootIds[0]])
    expect(next.model.project.definitions).toBe(model.project.definitions)
    const oldData = model.project.instances.first.data as Record<string, unknown>
    const newData = next.model.project.instances.first.data as Record<string, unknown>
    expect(newData.right).toBe(oldData.right)
    expect(newData.left).toEqual({ text: 'after' })
    expect(oldData.left).toEqual({ text: 'before' })
    expect(next.appliedChanges.affectedTargets).toEqual(['first'])
    expect(next.appliedChanges.changes).toEqual([{ path: ['instances', 'first', 'data', 'left', 'text'], exists: true, value: 'after' }])
    expect(next.model.resources).toBe(model.resources)
  })

  it('restores an absent optional owner after undoing its first nested style edit', () => {
    const { driver, model } = fixture()
    const result = driver.applyValidatedWithChanges(model, captureComponentOperation(model.project,
      [{ type: 'style.set', instanceId: 'first', path: ['color'], value: 'red' }]))
    const revised = driver.withRevision(result.model, 1)
    const restored = applyDocumentAcceptedChange(revised, createDocumentAcceptedChange(model, revised, result.appliedChanges), 'inverse')
    if (restored.kind !== 'course-v10') throw new Error('expected work project')
    expect(restored.project.instances.first).not.toHaveProperty('style')
    expect(restored.project.instances.first.data).toBe(model.project.instances.first.data)
  })

  it('keeps an earlier provisional edit off the canonical input when a later edit fails', () => {
    const { driver, model } = fixture(), before = structuredClone(model)
    const command = captureComponentOperation(model.project, [
      { type: 'data.set', instanceId: 'first', path: ['left', 'text'], value: 'after' },
      { type: 'data.set', instanceId: 'first', path: ['missing', 'text'], value: 'invalid' },
    ])
    expect(() => driver.applyValidated(model, command)).toThrow('字段父级已不存在')
    expect(model).toEqual(before)
  })

  it('preserves full validation for structural changes and detachment for public mutable callers', () => {
    const { driver, model } = fixture()
    const result = driver.apply(model, captureComponentOperation(model.project, [{ type: 'instance.patch', instanceId: 'first', patch: { name: 'renamed' } }]))
    if (result.kind !== 'course-v10') throw new Error('expected work project')
    expect(result.project.instances.second).not.toBe(model.project.instances.second)
    expect(() => driver.applyValidated(model, captureComponentOperation(model.project,
      [{ type: 'instance.insert', container: { kind: 'project' }, index: 0, instances: [], rootIds: ['missing'] }]))).toThrow()
    expect(model.project.rootIds).not.toContain('missing')
  })
})
