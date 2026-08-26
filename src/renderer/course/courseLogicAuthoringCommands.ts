import {
  courseNavigationGuardSchema,
  courseStateDeclarationSchema,
} from '../../shared/courseProjectSchema'
import type {
  CourseNavigationGuard,
  CourseProjectDocument,
  CourseStateDeclaration,
} from '../../shared/courseProjectTypes'
import { commitCourseProjectMutation } from './courseProjectMutation'

export type CourseLogicAuthoringFailureCode =
  | 'project-mismatch'
  | 'stale-revision'
  | 'state-key-exists'
  | 'state-not-found'
  | 'state-referenced'
  | 'state-type-referenced'
  | 'guard-id-exists'
  | 'guard-not-found'
  | 'no-change'
  | 'invalid-document'

export interface CourseLogicAuthoringTarget {
  readonly projectId: string
  readonly baseRevision: number
}

export type CourseLogicAuthoringCommand = CourseLogicAuthoringTarget & (
  | {
      readonly kind: 'course-state.add'
      readonly declaration: CourseStateDeclaration
    }
  | {
      readonly kind: 'course-state.update'
      readonly key: string
      readonly declaration: CourseStateDeclaration
    }
  | {
      readonly kind: 'course-state.delete'
      readonly key: string
    }
  | {
      readonly kind: 'navigation-guard.add'
      readonly guard: CourseNavigationGuard
    }
  | {
      readonly kind: 'navigation-guard.update'
      readonly guardId: string
      readonly guard: CourseNavigationGuard
    }
  | {
      readonly kind: 'navigation-guard.delete'
      readonly guardId: string
    }
)

export type CourseLogicAuthoringResult =
  | {
      readonly ok: true
      readonly project: CourseProjectDocument
      readonly historyEntry: true
      readonly statusMessage: string
    }
  | {
      readonly ok: false
      readonly code: CourseLogicAuthoringFailureCode
      readonly reason: string
      readonly historyEntry: false
    }

export interface CourseLogicAuthoringOptions {
  readonly now?: string
}

class CourseLogicAuthoringError extends Error {
  constructor(
    readonly code: CourseLogicAuthoringFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'CourseLogicAuthoringError'
  }
}

function reject(
  code: CourseLogicAuthoringFailureCode,
  reason: string,
): CourseLogicAuthoringResult {
  return { ok: false, code, reason, historyEntry: false }
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]))
  }
  if (
    typeof left !== 'object'
    || left === null
    || typeof right !== 'object'
    || right === null
    || Array.isArray(left)
    || Array.isArray(right)
  ) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => (
      Object.hasOwn(rightRecord, key)
      && structurallyEqual(leftRecord[key], rightRecord[key])
    ))
}

function stateReferenceGuardIds(
  project: CourseProjectDocument,
  key: string,
): string[] {
  return project.navigationGuards.flatMap((guard) => (
    guard.conditions.some((condition) => condition.key === key)
      ? [guard.id]
      : []
  ))
}

function validateTarget(
  project: CourseProjectDocument,
  command: CourseLogicAuthoringCommand,
): CourseLogicAuthoringResult | null {
  if (command.projectId !== project.id) {
    return reject('project-mismatch', '课程逻辑命令不属于当前工程，请重新打开专业编辑器。')
  }
  if (command.baseRevision !== project.revision) {
    return reject('stale-revision', '课程逻辑已被其他操作更新，请重新检查后再保存。')
  }
  return null
}

function applyMutation(
  project: CourseProjectDocument,
  command: CourseLogicAuthoringCommand,
): { mutate: (draft: CourseProjectDocument) => void; statusMessage: string } {
  switch (command.kind) {
    case 'course-state.add': {
      const declaration = courseStateDeclarationSchema.parse(command.declaration)
      if (project.courseState.some((state) => state.key === declaration.key)) {
        throw new CourseLogicAuthoringError(
          'state-key-exists',
          `课程状态“${declaration.key}”已经存在。`,
        )
      }
      return {
        mutate: (draft) => {
          draft.courseState.push(structuredClone(declaration))
        },
        statusMessage: `已添加课程状态“${declaration.key}”`,
      }
    }

    case 'course-state.update': {
      const declaration = courseStateDeclarationSchema.parse(command.declaration)
      const currentIndex = project.courseState.findIndex((state) => state.key === command.key)
      if (currentIndex < 0) {
        throw new CourseLogicAuthoringError(
          'state-not-found',
          `找不到课程状态“${command.key}”。`,
        )
      }
      const current = project.courseState[currentIndex]!
      if (
        declaration.key !== command.key
        && project.courseState.some((state) => state.key === declaration.key)
      ) {
        throw new CourseLogicAuthoringError(
          'state-key-exists',
          `课程状态“${declaration.key}”已经存在。`,
        )
      }
      if (current.valueType !== declaration.valueType) {
        const compareGuardIds = project.navigationGuards.flatMap((guard) => (
          guard.conditions.some((condition) => (
            condition.key === command.key && condition.type === 'compare'
          ))
            ? [guard.id]
            : []
        ))
        if (compareGuardIds.length > 0) {
          throw new CourseLogicAuthoringError(
            'state-type-referenced',
            `状态“${command.key}”正被守卫 ${compareGuardIds.join('、')} 比较；请先调整条件，再修改类型。`,
          )
        }
      }
      if (
        structurallyEqual(current, declaration)
        && declaration.key === command.key
      ) {
        throw new CourseLogicAuthoringError('no-change', '课程状态没有发生变化。')
      }
      return {
        mutate: (draft) => {
          draft.courseState[currentIndex] = structuredClone(declaration)
          if (declaration.key === command.key) return
          draft.navigationGuards.forEach((guard) => {
            guard.conditions = guard.conditions.map((condition) => (
              condition.key === command.key
                ? { ...condition, key: declaration.key }
                : condition
            ))
          })
        },
        statusMessage: declaration.key === command.key
          ? `已更新课程状态“${command.key}”`
          : `已将课程状态“${command.key}”改为“${declaration.key}”，并同步守卫条件`,
      }
    }

    case 'course-state.delete': {
      const currentIndex = project.courseState.findIndex((state) => state.key === command.key)
      if (currentIndex < 0) {
        throw new CourseLogicAuthoringError(
          'state-not-found',
          `找不到课程状态“${command.key}”。`,
        )
      }
      const guardIds = stateReferenceGuardIds(project, command.key)
      if (guardIds.length > 0) {
        throw new CourseLogicAuthoringError(
          'state-referenced',
          `状态“${command.key}”仍被守卫 ${guardIds.join('、')} 使用；请先删除或调整这些条件。`,
        )
      }
      return {
        mutate: (draft) => {
          draft.courseState.splice(currentIndex, 1)
        },
        statusMessage: `已删除课程状态“${command.key}”`,
      }
    }

    case 'navigation-guard.add': {
      const guard = courseNavigationGuardSchema.parse(command.guard)
      if (project.navigationGuards.some((candidate) => candidate.id === guard.id)) {
        throw new CourseLogicAuthoringError(
          'guard-id-exists',
          `导航守卫“${guard.id}”已经存在。`,
        )
      }
      return {
        mutate: (draft) => {
          draft.navigationGuards.push(structuredClone(guard))
        },
        statusMessage: `已添加导航守卫“${guard.id}”`,
      }
    }

    case 'navigation-guard.update': {
      const guard = courseNavigationGuardSchema.parse(command.guard)
      const currentIndex = project.navigationGuards.findIndex(
        (candidate) => candidate.id === command.guardId,
      )
      if (currentIndex < 0) {
        throw new CourseLogicAuthoringError(
          'guard-not-found',
          `找不到导航守卫“${command.guardId}”。`,
        )
      }
      if (
        guard.id !== command.guardId
        && project.navigationGuards.some((candidate) => candidate.id === guard.id)
      ) {
        throw new CourseLogicAuthoringError(
          'guard-id-exists',
          `导航守卫“${guard.id}”已经存在。`,
        )
      }
      if (structurallyEqual(project.navigationGuards[currentIndex], guard)) {
        throw new CourseLogicAuthoringError('no-change', '导航守卫没有发生变化。')
      }
      return {
        mutate: (draft) => {
          draft.navigationGuards[currentIndex] = structuredClone(guard)
        },
        statusMessage: `已更新导航守卫“${guard.id}”`,
      }
    }

    case 'navigation-guard.delete': {
      const currentIndex = project.navigationGuards.findIndex(
        (candidate) => candidate.id === command.guardId,
      )
      if (currentIndex < 0) {
        throw new CourseLogicAuthoringError(
          'guard-not-found',
          `找不到导航守卫“${command.guardId}”。`,
        )
      }
      return {
        mutate: (draft) => {
          draft.navigationGuards.splice(currentIndex, 1)
        },
        statusMessage: `已删除导航守卫“${command.guardId}”`,
      }
    }
  }

  throw new CourseLogicAuthoringError(
    'invalid-document',
    '不支持的课程逻辑命令。',
  )
}

/**
 * Applies one top-level V9 course-logic edit. The existing strict project
 * schema parses the complete candidate before it can enter any authoring
 * history, so location/state references and comparison types stay canonical.
 */
export function executeCourseLogicAuthoringCommand(
  project: CourseProjectDocument,
  command: CourseLogicAuthoringCommand,
  options: CourseLogicAuthoringOptions = {},
): CourseLogicAuthoringResult {
  const targetFailure = validateTarget(project, command)
  if (targetFailure) return targetFailure

  try {
    const plan = applyMutation(project, command)
    const next = commitCourseProjectMutation(project, plan.mutate, options.now)
    return {
      ok: true,
      project: next,
      historyEntry: true,
      statusMessage: plan.statusMessage,
    }
  } catch (error) {
    if (error instanceof CourseLogicAuthoringError) {
      return reject(error.code, error.message)
    }
    return reject(
      'invalid-document',
      error instanceof Error && error.message.trim()
        ? `课程逻辑未保存：${error.message}`
        : '课程逻辑未通过 Course Project V9 校验。',
    )
  }
}
