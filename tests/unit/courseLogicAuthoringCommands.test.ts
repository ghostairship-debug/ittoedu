// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { commitCourseLogicAuthoringCommand, type CourseLogicAuthoringCommand } from '../../src/renderer/course/courseLogicAuthoringCommands'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

type LogicChange = CourseLogicAuthoringCommand extends infer Command ? Command extends unknown ? Omit<Command, 'projectId' | 'baseRevision'> : never : never

it('commits current state and guard edits through the shared Session, preserves references and refuses invalid, stale or destructive commands with zero writes', async () => {
  const project = createBlankCourseProjectV10('logic')
  project.surfaces.push({ id: 'flow', title: 'Flow', kind: 'flow', childIds: [] }, { id: 'spatial', title: 'Spatial', kind: 'spatial', childIds: [] })
  const h = await createV10StoreHost(project)
  const apply = (change: LogicChange) => commitCourseLogicAuthoringCommand(h.kernel, h.first.documentId,
    { projectId: h.model().project.id, baseRevision: h.model().project.revision, ...change })
  try {
    // The same command owner follows all three editor projections; their histories never split.
    for (const surface of project.surfaces) {
      h.kernel.selectSurface(surface.id)
      expect(await apply({ kind: 'course-state.add', declaration: { key: surface.id, valueType: 'boolean', defaultValue: false } })).toMatchObject({ ok: true, historyEntry: true })
    }
    expect(h.first.read().undoDepth).toBe(3)
    await h.bridge.undo(); expect(h.model().project.logic!.courseState.map(state => state.key)).toEqual([project.surfaces[0].id, 'flow'])
    await h.bridge.redo()
    expect(await apply({ kind: 'course-state.add', declaration: { key: 'score', valueType: 'number', defaultValue: 20 } })).toMatchObject({ ok: true })
    const guard = { id: 'mastery-guard', effect: 'block' as const, fromSurfaceIds: [project.surfaces[0].id], toSurfaceIds: ['flow'], match: 'all' as const,
      conditions: [{ type: 'compare' as const, key: 'score', operator: 'lt' as const, value: 80 }, { type: 'exists' as const, key: 'score', exists: true }], message: '请先练习' }
    expect(await apply({ kind: 'navigation-guard.add', guard })).toMatchObject({ ok: true })
    expect(await apply({ kind: 'course-state.update', key: 'score', declaration: { key: 'mastery', valueType: 'number', defaultValue: 10 } })).toMatchObject({ ok: true })
    expect(h.model().project.logic!.navigationGuards[0].conditions.map(condition => condition.key)).toEqual(['mastery', 'mastery'])
    const beforeRejected = structuredClone(h.first.read())
    const rejected: { command: LogicChange; code: string }[] = [
      { command: { kind: 'course-state.delete', key: 'mastery' }, code: 'state-referenced' },
      { command: { kind: 'course-state.update', key: 'mastery', declaration: { key: 'mastery', valueType: 'string', defaultValue: '' } }, code: 'state-type-referenced' },
      { command: { kind: 'course-state.add', declaration: { key: 'mastery', valueType: 'number', defaultValue: 0 } }, code: 'state-key-exists' },
      { command: { kind: 'course-state.update', key: 'mastery', declaration: { key: 'mastery', valueType: 'number', defaultValue: 10 } }, code: 'no-change' },
      { command: { kind: 'navigation-guard.add', guard: { ...guard, id: 'bad', toSurfaceIds: ['missing'] } }, code: 'invalid-document' },
      { command: { kind: 'navigation-guard.add', guard: { ...guard, id: 'bad-type', conditions: [{ type: 'compare', key: 'mastery', operator: 'gte', value: 'wrong-type' }] } }, code: 'invalid-document' },
    ]
    for (const { command, code } of rejected) {
      expect(await apply(command)).toMatchObject({ ok: false, code, historyEntry: false })
      expect(h.first.read()).toEqual(beforeRejected)
    }
    expect(await commitCourseLogicAuthoringCommand(h.kernel, h.first.documentId,
      { projectId: project.id, baseRevision: 0, kind: 'course-state.delete', key: 'mastery' })).toMatchObject({ ok: false, code: 'stale-revision' })
    expect(h.first.read()).toEqual(beforeRejected)
    const changedGuard = { ...guard, conditions: [{ type: 'exists' as const, key: 'mastery', exists: true }], match: 'any' as const, toSurfaceIds: ['spatial'] }
    expect(await apply({ kind: 'navigation-guard.update', guardId: guard.id, guard: changedGuard })).toMatchObject({ ok: true })
    expect(h.model().project.logic!.navigationGuards).toEqual([changedGuard])
    expect(h.driver.load(h.driver.serialize(h.model()))).toEqual(h.model())
    const depth = h.first.read().undoDepth
    expect(await apply({ kind: 'navigation-guard.delete', guardId: guard.id })).toMatchObject({ ok: true })
    expect(await apply({ kind: 'course-state.delete', key: 'mastery' })).toMatchObject({ ok: true })
    expect(h.model().project.logic!.navigationGuards).toEqual([])
    expect(h.model().project.logic!.courseState.some(state => state.key === 'mastery')).toBe(false)
    expect(h.first.read().undoDepth).toBe(depth + 2)
    await h.bridge.undo(); await h.bridge.undo()
    expect(h.model().project.logic!.navigationGuards).toEqual([changedGuard])
    expect(h.model().project.logic!.courseState.find(state => state.key === 'mastery')).toEqual({ key: 'mastery', valueType: 'number', defaultValue: 10 })
  } finally { h.bridge.dispose() }
})
