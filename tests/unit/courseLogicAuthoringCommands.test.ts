import { describe, expect, it } from 'vitest'
import {
  executeCourseLogicAuthoringCommand,
  type CourseLogicAuthoringCommand,
} from '@/renderer/course/courseLogicAuthoringCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'

const NOW = '2026-08-27T12:00:00.000Z'

type UntargetedCourseLogicCommand = CourseLogicAuthoringCommand extends infer Command
  ? Command extends unknown
    ? Omit<Command, 'projectId' | 'baseRevision'>
    : never
  : never

function target(project: CourseProjectDocument) {
  return { projectId: project.id, baseRevision: project.revision }
}

function apply(
  project: CourseProjectDocument,
  command: UntargetedCourseLogicCommand,
) {
  return executeCourseLogicAuthoringCommand(project, {
    ...target(project),
    ...command,
  } as CourseLogicAuthoringCommand, { now: NOW })
}

function addState(project: CourseProjectDocument, key = 'mastery') {
  return apply(project, {
    kind: 'course-state.add',
    declaration: { key, valueType: 'number', defaultValue: 0 },
  })
}

describe('course logic authoring commands', () => {
  it('新增并修改状态键时同步所有守卫条件', () => {
    const original = createBlankCourseProject({
      id: 'course-logic',
      now: NOW,
      idFactory: () => 'fixed',
      includeDefaultController: false,
      controls: 'none',
    })
    const stateResult = addState(original)
    expect(stateResult.ok).toBe(true)
    if (!stateResult.ok) return

    const guardResult = apply(stateResult.project, {
      kind: 'navigation-guard.add',
      guard: {
        id: 'guard-mastery',
        effect: 'block',
        toLocationIds: [stateResult.project.startLocationId],
        match: 'all',
        conditions: [
          { type: 'compare', key: 'mastery', operator: 'lt', value: 80 },
          { type: 'exists', key: 'mastery', exists: true },
        ],
        message: '请先完成练习',
      },
    })
    expect(guardResult.ok).toBe(true)
    if (!guardResult.ok) return

    const renamed = apply(guardResult.project, {
      kind: 'course-state.update',
      key: 'mastery',
      declaration: { key: 'masteryScore', valueType: 'number', defaultValue: 10 },
    })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return

    expect(renamed.project.courseState).toEqual([
      { key: 'masteryScore', valueType: 'number', defaultValue: 10 },
    ])
    expect(renamed.project.navigationGuards[0]?.conditions).toEqual([
      { type: 'compare', key: 'masteryScore', operator: 'lt', value: 80 },
      { type: 'exists', key: 'masteryScore', exists: true },
    ])
    expect(renamed.project.revision).toBe(3)
    expect(courseProjectDocumentSchema.safeParse(renamed.project).success).toBe(true)
  })

  it('原子同步全局与场景互动引用，并拒绝删除或破坏其类型', () => {
    const original = createBlankCourseProject({
      id: 'course-logic-interactions',
      now: NOW,
      idFactory: () => 'fixed',
      includeDefaultController: false,
      controls: 'none',
    })
    const stateResult = addState(original, 'score')
    if (!stateResult.ok) throw new Error(stateResult.reason)
    stateResult.project.globalInteractions = [{
      id: 'global-state-rule',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [{ type: 'course-state.exists', key: 'score', exists: true }],
      actions: [{
        id: 'global-set-score',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'course-state.set', key: 'score', value: 1 },
      }],
    }]
    const surface = stateResult.project.surfaces[0]
    if (surface?.type !== 'slide') throw new Error('expected slide surface')
    surface.scenes[0]!.interactions = [{
      id: 'local-state-rule',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [{
        type: 'course-state.compare',
        key: 'score',
        operator: 'gte',
        value: 1,
      }],
      actions: [{
        id: 'local-set-score',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'course-state.set', key: 'score', value: 2 },
      }],
    }]

    const renamed = apply(stateResult.project, {
      kind: 'course-state.update',
      key: 'score',
      declaration: { key: 'masteryScore', valueType: 'number', defaultValue: 0 },
    })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.project.globalInteractions[0]?.conditions[0]).toMatchObject({
      type: 'course-state.exists',
      key: 'masteryScore',
    })
    expect(renamed.project.globalInteractions[0]?.actions[0]?.action).toMatchObject({
      type: 'course-state.set',
      key: 'masteryScore',
    })
    const renamedSurface = renamed.project.surfaces[0]
    if (renamedSurface?.type !== 'slide') throw new Error('expected slide surface')
    expect(renamedSurface.scenes[0]?.interactions[0]?.conditions[0]).toMatchObject({
      type: 'course-state.compare',
      key: 'masteryScore',
    })
    expect(renamedSurface.scenes[0]?.interactions[0]?.actions[0]?.action).toMatchObject({
      type: 'course-state.set',
      key: 'masteryScore',
    })
    expect(courseProjectDocumentSchema.safeParse(renamed.project).success).toBe(true)

    expect(apply(renamed.project, {
      kind: 'course-state.delete',
      key: 'masteryScore',
    })).toMatchObject({ ok: false, code: 'state-referenced', historyEntry: false })
    expect(apply(renamed.project, {
      kind: 'course-state.update',
      key: 'masteryScore',
      declaration: { key: 'masteryScore', valueType: 'string', defaultValue: '' },
    })).toMatchObject({ ok: false, code: 'state-type-referenced', historyEntry: false })
    expect(renamed.project.revision).toBe(2)
  })

  it('拒绝删除仍被守卫引用的状态，也拒绝破坏比较条件的类型变更', () => {
    const original = createBlankCourseProject({
      id: 'course-logic-reject',
      now: NOW,
      idFactory: () => 'fixed',
      includeDefaultController: false,
      controls: 'none',
    })
    const stateResult = addState(original)
    if (!stateResult.ok) throw new Error(stateResult.reason)
    const guarded = apply(stateResult.project, {
      kind: 'navigation-guard.add',
      guard: {
        id: 'guard-score',
        effect: 'block',
        fromLocationIds: [stateResult.project.startLocationId],
        toLocationIds: [stateResult.project.startLocationId],
        match: 'any',
        conditions: [{ type: 'compare', key: 'mastery', operator: 'gte', value: 60 }],
        message: '分数不足',
      },
    })
    if (!guarded.ok) throw new Error(guarded.reason)

    expect(apply(guarded.project, {
      kind: 'course-state.delete',
      key: 'mastery',
    })).toMatchObject({ ok: false, code: 'state-referenced' })
    expect(apply(guarded.project, {
      kind: 'course-state.update',
      key: 'mastery',
      declaration: { key: 'mastery', valueType: 'string', defaultValue: '未完成' },
    })).toMatchObject({ ok: false, code: 'state-type-referenced' })
    expect(guarded.project.revision).toBe(2)
  })

  it('支持守卫修改和删除，且每次有效命令只增加一个 revision', () => {
    const original = createBlankCourseProject({
      id: 'course-logic-guard',
      now: NOW,
      idFactory: () => 'fixed',
      includeDefaultController: false,
      controls: 'none',
    })
    const stateResult = addState(original, 'completed')
    if (!stateResult.ok) throw new Error(stateResult.reason)
    const added = apply(stateResult.project, {
      kind: 'navigation-guard.add',
      guard: {
        id: 'guard-before-summary',
        effect: 'block',
        toLocationIds: [stateResult.project.startLocationId],
        match: 'all',
        conditions: [{ type: 'exists', key: 'completed', exists: false }],
        message: '请先完成上一部分',
      },
    })
    if (!added.ok) throw new Error(added.reason)

    const updated = apply(added.project, {
      kind: 'navigation-guard.update',
      guardId: 'guard-before-summary',
      guard: {
        ...added.project.navigationGuards[0]!,
        id: 'guard-summary',
        match: 'any',
        message: '请完成任一前置条件',
      },
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.project.navigationGuards[0]).toMatchObject({
      id: 'guard-summary',
      match: 'any',
      message: '请完成任一前置条件',
    })

    const deleted = apply(updated.project, {
      kind: 'navigation-guard.delete',
      guardId: 'guard-summary',
    })
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.project.navigationGuards).toEqual([])
    expect(deleted.project.revision).toBe(4)

    const stateDeleted = apply(deleted.project, {
      kind: 'course-state.delete',
      key: 'completed',
    })
    expect(stateDeleted.ok).toBe(true)
  })

  it('陈旧、重复、无变化及非法引用都返回明确失败而不生成文档', () => {
    const original = createBlankCourseProject({
      id: 'course-logic-invalid',
      now: NOW,
      idFactory: () => 'fixed',
      includeDefaultController: false,
      controls: 'none',
    })
    expect(executeCourseLogicAuthoringCommand(original, {
      kind: 'course-state.add',
      projectId: original.id,
      baseRevision: 99,
      declaration: { key: 'ready', valueType: 'boolean', defaultValue: false },
    }, { now: NOW })).toMatchObject({ ok: false, code: 'stale-revision' })

    const stateResult = apply(original, {
      kind: 'course-state.add',
      declaration: { key: 'ready', valueType: 'boolean', defaultValue: false },
    })
    if (!stateResult.ok) throw new Error(stateResult.reason)
    expect(apply(stateResult.project, {
      kind: 'course-state.add',
      declaration: { key: 'ready', valueType: 'boolean', defaultValue: true },
    })).toMatchObject({ ok: false, code: 'state-key-exists' })
    expect(apply(stateResult.project, {
      kind: 'course-state.update',
      key: 'ready',
      declaration: { key: 'ready', valueType: 'boolean', defaultValue: false },
    })).toMatchObject({ ok: false, code: 'no-change' })
    expect(apply(stateResult.project, {
      kind: 'navigation-guard.add',
      guard: {
        id: 'guard-missing-location',
        effect: 'block',
        toLocationIds: ['missing-location'],
        match: 'all',
        conditions: [{ type: 'exists', key: 'ready', exists: true }],
        message: '位置不存在',
      },
    })).toMatchObject({ ok: false, code: 'invalid-document' })
  })
})
