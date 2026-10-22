// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { courseProjectV11Schema } from '../../src/shared/contracts/component-platform/schema'
import { createWorkProjectMigrationMap, normalizeWorkProject } from '../../src/shared/contracts/component-platform/workProjectMigration'
import { UserFacingError } from '../../src/shared/errors'

const presentation = { initialStateId: 'detail', states: [{ id: 'detail', title: '细节', overrides: {} }] }

it.each(['flow', 'spatial'] as const)('keeps %s state conflicts recoverable and rejects both formal write paths atomically', kind => {
  const project = createBlankCourseProjectV10(), rootId = project.rootIds[0]
  project.instances[rootId].container = { kind }
  const before = structuredClone(project)
  for (const edits of [
    [{ type: 'surface.presentation.set' as const, surfaceId: rootId, presentation }],
    [{ type: 'container.patch' as const, instanceId: rootId, patch: { presentation } }],
  ]) {
    expect(() => applyComponentOperation(project, captureComponentOperation(project, edits))).toThrow('场景状态仅属于Slide')
    expect(project).toEqual(before)
  }
  const old = structuredClone(project)
  old.instances[rootId].container!.presentation = { ...presentation, states: [{ ...presentation.states[0], overrides: {
    [rootId]: { data: { text: '必须保留的原覆盖' } },
  } }] }
  const original = structuredClone(old)
  expect(courseProjectV11Schema.safeParse(old).success).toBe(false)
  for (const read of [() => normalizeWorkProject(old), () => createWorkProjectMigrationMap([project, old])]) {
    try { read(); expect.fail('Expected an explicit recoverable state conflict') }
    catch (error) {
      expect(error).toBeInstanceOf(UserFacingError)
      expect((error as UserFacingError).message).toContain(rootId)
      expect((error as UserFacingError).suggestion).toContain('不会自动删除或压平')
    }
    expect(old).toEqual(original)
  }
})

it('retains Slide state authoring and current/saved/history read semantics', () => {
  const project = createBlankCourseProjectV10(), rootId = project.rootIds[0]
  const edited = applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'surface.presentation.set', surfaceId: rootId, presentation },
  ]))
  expect(normalizeWorkProject(edited).instances[rootId].container?.presentation).toEqual(presentation)
  expect(createWorkProjectMigrationMap([project, edited])).toBeDefined()
  expect(project.instances[rootId].container?.presentation).toBeUndefined()
})
