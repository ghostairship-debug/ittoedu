import { createEditorTransactionStep, type EditorTransactionStep } from '../authoring/editorTransaction'
import type { CourseAssetSidecar } from '../project/v9AssetAdapter'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseAuthoringSession } from '../authoring/courseAuthoringSession'
import type { SlideAuthoringSession, SlideCommandResult } from '../course/slideAuthoringBackend'
import type { SlidePersistExtra } from '../store/slices/slideAuthoringSlice'
import {
  planApplyInteractionTemplate,
  planUpdateInteractionRule,
  type InteractionAuthoringFeedback,
  type InteractionAuthoringPlanFailureCode,
  type InteractionAuthoringPlanResult,
  type InteractionAuthoringTarget,
} from './interactionAuthoringCommands'
import type { InteractionTemplateRequest } from './interactionTemplates'
import { isNodeMotionAction, type InteractionRule } from '../../shared/interactionTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  executeCourseLogicAuthoringCommand,
  type CourseLogicAuthoringCommand,
} from '../course/courseLogicAuthoringCommands'
import { commitSlideAuthoringHistory, commitSlideProjectMutation } from '../course/slideEditorCommands'
import {
  addSlideInteractionRule,
  duplicateSlideInteractionRule,
  updateSlideInteractionRule,
} from '../course/slideInteractionCommands'

export type InteractionAuthoringCommitResult =
  | {
      readonly ok: true
      readonly status: 'committed' | 'unchanged'
      readonly feedback: InteractionAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: InteractionAuthoringPlanFailureCode
      readonly reason: string
    }

function withoutDanglingAnimationCompletionRules(
  rules: readonly InteractionRule[],
): InteractionRule[] {
  let retained = [...rules]
  while (true) {
    const motionActionIds = new Set(retained.flatMap((rule) =>
      rule.actions.flatMap((step) => isNodeMotionAction(step.action) ? [step.id] : []),
    ))
    const next = retained.filter((rule) =>
      rule.trigger.type !== 'animation.completed' ||
      motionActionIds.has(rule.trigger.actionId),
    )
    if (next.length === retained.length) return next
    retained = next
  }
}

function moveInteractionRuleWithinKind(
  rules: InteractionRule[],
  ruleId: string,
  direction: -1 | 1,
): boolean {
  const index = rules.findIndex((rule) => rule.id === ruleId)
  if (index < 0) return false
  const clickRule = rules[index]!.trigger.type === 'node.click'
  let target = index + direction
  while (
    target >= 0 &&
    target < rules.length &&
    (rules[target]!.trigger.type === 'node.click') !== clickRule
  ) {
    target += direction
  }
  if (target < 0 || target >= rules.length) return false
  const [rule] = rules.splice(index, 1)
  if (!rule) return false
  rules.splice(target, 0, rule)
  return true
}

function findSlideSceneInteractions(
  project: CourseProjectDocument,
  sceneId: string,
): InteractionRule[] | null {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
    if (scene) return scene.interactions
  }
  return null
}

export type InteractionAuthoringState = {
  readonly document: CourseProjectDocument | null
  readonly sidecar: CourseAssetSidecar | null
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly authoringSession: CourseAuthoringSession | null
  readonly editingScope: 'scene' | 'global'
  readonly interactionLocationId?: string | null
  readonly interactionStateId?: string | null
}

export type InteractionAuthoringPorts = {
  read(): InteractionAuthoringState
  setFeedback(feedback: { errorMessage?: string | null; statusMessage?: string | null }): void
  persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean
  persistProject(document: CourseProjectDocument, options?: {
    statusMessage?: string | null
    historyEntry?: boolean
  }): void
  persistSlideCommand(
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: SlidePersistExtra,
  ): SlideCommandResult
}

export function createInteractionAuthoringActions(ports: InteractionAuthoringPorts) {
  const rejectInteractionAuthoring = (
    code: InteractionAuthoringPlanFailureCode,
    reason: string,
  ): InteractionAuthoringCommitResult => {
    ports.setFeedback({ errorMessage: reason, statusMessage: null })
    return { ok: false, code, reason }
  }

  const validateActiveInteractionTarget = (
    target: InteractionAuthoringTarget,
  ): InteractionAuthoringCommitResult | null => {
    const state = ports.read()
    const expectedLocationId = target.carrier === 'slide-scene'
      ? target.locationId
      : target.activeLocationId
    if (
      expectedLocationId !== undefined
      && state.interactionLocationId !== expectedLocationId
    ) {
      return rejectInteractionAuthoring(
        'revision-conflict',
        '当前页面已切换，互动规则没有写入。请在目标页面重试。',
      )
    }
    if (
      target.activeStateId !== undefined
      && state.interactionStateId !== target.activeStateId
    ) {
      return rejectInteractionAuthoring(
        'revision-conflict',
        '当前演示状态已切换，互动规则没有写入。请在目标状态重试。',
      )
    }
    return null
  }

  const persistInteractionAuthoringPlan = (
    document: CourseProjectDocument,
    planned: InteractionAuthoringPlanResult,
    statusMessage: string,
  ): InteractionAuthoringCommitResult => {
    if (!planned.ok) {
      return rejectInteractionAuthoring(planned.code, planned.reason)
    }
    if (planned.status === 'no-op') {
      ports.setFeedback({ errorMessage: null, statusMessage: '互动规则没有变化' })
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectInteractionAuthoring(
        'invalid-document',
        '互动事务缺少结果信息，未写入工程。',
      )
    }
    try {
      const candidate = createEditorTransactionStep(document, planned.plan)
      if (!candidate) {
        ports.setFeedback({ errorMessage: null, statusMessage: '互动规则没有变化' })
        return { ok: true, status: 'unchanged', feedback }
      }
      if (!ports.persistTransaction(candidate, statusMessage)) {
        return rejectInteractionAuthoring(
          'invalid-document',
          '当前没有可提交互动规则的课程编辑会话。',
        )
      }
      return { ok: true, status: 'committed', feedback }
    } catch (error) {
      return rejectInteractionAuthoring(
        'invalid-document',
        error instanceof Error ? error.message : '互动事务无效，未写入工程。',
      )
    }
  }

  return {
    applyInteractionTemplateAtTarget(
      target: InteractionAuthoringTarget,
      template: InteractionTemplateRequest,
    ): InteractionAuthoringCommitResult {
      const targetFailure = validateActiveInteractionTarget(target)
      if (targetFailure) return targetFailure
      const document = ports.read().document
      if (!document) {
        return rejectInteractionAuthoring(
          'invalid-document',
          '当前没有可编辑的 Course Project V9 工程。',
        )
      }
      return persistInteractionAuthoringPlan(
        document,
        planApplyInteractionTemplate({
          project: document,
          target,
          template,
          now: new Date().toISOString(),
        }),
        '互动模板已创建；元素初始状态与规则已同步',
      )
    },
    updateInteractionRuleAtTarget(
      target: InteractionAuthoringTarget,
      ruleId: string,
      patch: Partial<Omit<InteractionRule, 'id'>>,
    ): InteractionAuthoringCommitResult {
      const targetFailure = validateActiveInteractionTarget(target)
      if (targetFailure) return targetFailure
      const document = ports.read().document
      if (!document) {
        return rejectInteractionAuthoring(
          'invalid-document',
          '当前没有可编辑的 Course Project V9 工程。',
        )
      }
      return persistInteractionAuthoringPlan(
        document,
        planUpdateInteractionRule({
          project: document,
          target,
          ruleId,
          patch,
          now: new Date().toISOString(),
        }),
        '交互映射已更新',
      )
    },
    applyCourseLogicAuthoringCommand(command: CourseLogicAuthoringCommand) {
      const document = ports.read().document
      if (!document) {
        const reason = '当前没有可编辑的 Course Project V9 作者会话。'
        ports.setFeedback({ errorMessage: reason, statusMessage: null })
        return {
          ok: false as const,
          code: 'invalid-document' as const,
          reason,
          historyEntry: false as const,
        }
      }
      const result = executeCourseLogicAuthoringCommand(document, command, {
        now: new Date().toISOString(),
      })
      if (result.ok) {
        ports.persistProject(result.project, {
          statusMessage: result.statusMessage,
          historyEntry: result.historyEntry,
        })
      } else {
        ports.setFeedback({ errorMessage: result.reason, statusMessage: null })
      }
      return result
    },
    addInteractionRule(sceneId: string, rule: InteractionRule) {
      ports.persistSlideCommand((session) => {
        const location = session.history.present.locations.find((candidate) => (
          candidate.kind === 'slide-scene' && candidate.sceneId === sceneId && candidate.stateId === undefined
        ))
        if (!location) return { ok: false, reason: '找不到目标场景', historyEntry: false }
        try {
          const history = addSlideInteractionRule(
            session.history,
            { locationId: location.id, scope: 'scene' },
            rule,
          )
          return {
            ok: true,
            historyEntry: history !== session.history,
            nextSession: { ...session, history },
            selection: session.selection,
          }
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : '无法添加交互规则',
            historyEntry: false,
          }
        }
      }, { statusMessage: '交互映射已添加' })
    },
    updateInteractionRule(sceneId: string, ruleId: string, rule: InteractionRule) {
      ports.persistSlideCommand((session) => {
        const location = session.history.present.locations.find((candidate) => (
          candidate.kind === 'slide-scene' && candidate.sceneId === sceneId && candidate.stateId === undefined
        ))
        if (!location) return { ok: false, reason: '找不到目标场景', historyEntry: false }
        try {
          const { id: _id, ...patch } = rule
          const history = updateSlideInteractionRule(
            session.history,
            { locationId: location.id, scope: 'scene' },
            ruleId,
            patch,
          )
          return {
            ok: true,
            historyEntry: history !== session.history,
            nextSession: { ...session, history },
            selection: session.selection,
          }
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : '无法更新交互规则',
            historyEntry: false,
          }
        }
      }, { statusMessage: '交互映射已更新' })
    },
    deleteInteractionRule(sceneId: string, ruleId: string) {
      ports.persistSlideCommand((session) => {
        try {
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const rules = findSlideSceneInteractions(draft, sceneId)
            if (!rules) throw new Error('找不到目标场景')
            const next = withoutDanglingAnimationCompletionRules(
              rules.filter((rule) => rule.id !== ruleId),
            )
            rules.splice(0, rules.length, ...next)
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : '无法删除交互规则',
            historyEntry: false,
          }
        }
      }, { statusMessage: '交互映射已删除' })
    },
    duplicateInteractionRule(sceneId: string, ruleId: string): string | null {
      let created: string | null = null
      const result = ports.persistSlideCommand((session) => {
        const location = session.history.present.locations.find((candidate) => (
          candidate.kind === 'slide-scene' && candidate.sceneId === sceneId && candidate.stateId === undefined
        ))
        if (!location) return { ok: false, reason: '找不到目标场景', historyEntry: false }
        try {
          const history = duplicateSlideInteractionRule(
            session.history,
            { locationId: location.id, scope: 'scene' },
            ruleId,
          )
          const nextRules = history.present.surfaces.flatMap((surface) => (
            surface.type === 'slide'
              ? surface.scenes.filter((scene) => scene.id === sceneId).flatMap((scene) => scene.interactions)
              : []
          ))
          const prevRules = session.history.present.surfaces.flatMap((surface) => (
            surface.type === 'slide'
              ? surface.scenes.filter((scene) => scene.id === sceneId).flatMap((scene) => scene.interactions)
              : []
          ))
          created = nextRules.find((rule) => !prevRules.some((item) => item.id === rule.id))?.id ?? null
          return {
            ok: true,
            historyEntry: history !== session.history,
            nextSession: { ...session, history },
            selection: session.selection,
          }
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : '无法复制交互规则',
            historyEntry: false,
          }
        }
      }, { statusMessage: '交互映射已复制' })
      return result.ok ? created : null
    },
    moveInteractionRule(sceneId: string, ruleId: string, direction: -1 | 1) {
      ports.persistSlideCommand((session) => {
        try {
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const rules = findSlideSceneInteractions(draft, sceneId)
            if (!rules) throw new Error('找不到目标场景')
            if (!moveInteractionRuleWithinKind(rules, ruleId, direction)) return
          })
          return {
            ok: true,
            historyEntry: project !== session.history.present,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : '无法移动交互规则',
            historyEntry: false,
          }
        }
      })
    },
    addGlobalInteractionRule(rule: InteractionRule) {
      ports.persistSlideCommand((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          if (draft.globalInteractions.some((item) => item.id === rule.id)) return
          draft.globalInteractions.push(structuredClone(rule))
        })
        return {
          ok: true,
          historyEntry: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
          },
          selection: session.selection,
        }
      }, { statusMessage: '全局交互映射已添加' })
    },
    updateGlobalInteractionRule(ruleId: string, rule: InteractionRule) {
      ports.persistSlideCommand((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          const index = draft.globalInteractions.findIndex((item) => item.id === ruleId)
          if (index >= 0) draft.globalInteractions[index] = structuredClone(rule)
        })
        return {
          ok: true,
          historyEntry: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
          },
          selection: session.selection,
        }
      }, { statusMessage: '全局交互映射已更新' })
    },
    deleteGlobalInteractionRule(ruleId: string) {
      ports.persistSlideCommand((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          draft.globalInteractions = draft.globalInteractions.filter((item) => item.id !== ruleId)
        })
        return {
          ok: true,
          historyEntry: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
          },
          selection: session.selection,
        }
      }, { statusMessage: '全局交互映射已删除' })
    },
    duplicateGlobalInteractionRule(ruleId: string): string | null {
      let created: string | null = null
      const result = ports.persistSlideCommand((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          const current = draft.globalInteractions.find((item) => item.id === ruleId)
          if (!current) return
          const copy = structuredClone(current)
          copy.id = `${ruleId}_copy`
          created = copy.id
          draft.globalInteractions.push(copy)
        })
        return {
          ok: true,
          historyEntry: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
          },
          selection: session.selection,
        }
      }, { statusMessage: '全局交互映射已复制' })
      return result.ok ? created : null
    },
    moveGlobalInteractionRule(ruleId: string, direction: -1 | 1) {
      ports.persistSlideCommand((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          const index = draft.globalInteractions.findIndex((item) => item.id === ruleId)
          const next = index + direction
          if (index < 0 || next < 0 || next >= draft.globalInteractions.length) return
          const [item] = draft.globalInteractions.splice(index, 1)
          draft.globalInteractions.splice(next, 0, item!)
        })
        return {
          ok: true,
          historyEntry: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
          },
          selection: session.selection,
        }
      })
    },
  }
}
