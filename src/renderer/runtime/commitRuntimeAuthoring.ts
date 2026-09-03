import { nanoid } from 'nanoid'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import {
  createEditorTransactionStep,
} from '../authoring/editorTransaction'
import {
  updateCourseAuthoringSessionRevision,
  type CourseAuthoringTarget,
} from '../authoring/courseAuthoringSession'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseAssetSidecar } from '../project/v9AssetAdapter'
import { emptyCourseAssetSidecar } from '../project/v9AssetAdapter'
import type { CourseAuthoringSession } from '../authoring/courseAuthoringSession'
import type { EditorTransactionStep } from '../authoring/editorTransaction'
import type { EffectiveLayerProjection } from '../course/effectiveLayerProjection'
import type { SlideAuthoringSession, SlideCommandResult } from '../course/slideAuthoringBackend'
import type { SlidePersistExtra } from '../store/slices/slideAuthoringSlice'
import type { RuntimeTargetEditSession } from '../authoring/runtimeTargetEditSession'
import {
  captureCourseRuntimeAssetReplacementTarget,
  planCourseRuntimeAssetReplacement,
  type CourseRuntimeAssetReplacementFeedback,
  type CourseRuntimeAssetReplacementFailureCode,
  type CourseRuntimeAssetReplacementTarget,
} from './courseRuntimeTransactions'
import {
  planRuntimeSourceUpdate,
  type RuntimeSourceAuthoringFeedback,
  type RuntimeSourceAuthoringPlanFailureCode,
} from './runtimeSourceAuthoringCommands'
import {
  captureCourseRuntimeContentTextTarget,
  planRuntimeContentTextUpdate,
  type CourseRuntimeContentTextTarget,
  type RuntimeContentTextAuthoringFeedback,
  type RuntimeContentTextAuthoringPlanFailureCode,
} from './runtimeContentTextAuthoringCommands'
import {
  planRuntimePropertyUpdate,
  type CourseRuntimePropertyTarget,
  type CourseRuntimePropertyUpdate,
  type RuntimePropertyAuthoringFeedback,
  type RuntimePropertyAuthoringPlanFailureCode,
} from './runtimePropertyAuthoringCommands'
import {
  planRuntimeTemplateCreation,
  type CourseRuntimeTemplateCreationTarget,
  type CourseRuntimeTemplateCreationFeedback,
  type CourseRuntimeTemplateCreationPlanFailureCode,
} from './runtimeTemplateAuthoringCommands'
import { setSlideSimpleEntranceAnimation } from '../course/v9SlideContentCommands'
import { updateCoursePlaybackSettings } from '../course/globalLayerCommands'
import { commitSlideAuthoringHistory, commitSlideProjectMutation } from '../course/slideEditorCommands'
import type { ProjectDesignTokens } from '../../shared/contracts/design-v1'

export type RuntimeAssetReplacementCommitResult =
  | {
      readonly ok: true
      readonly status: 'replaced' | 'unchanged'
      readonly feedback: CourseRuntimeAssetReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseRuntimeAssetReplacementFailureCode
      readonly reason: string
    }

export type RuntimeSourceAuthoringCommitResult =
  | {
      readonly ok: true
      readonly status: 'committed' | 'unchanged'
      readonly feedback: RuntimeSourceAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimeSourceAuthoringPlanFailureCode
      readonly reason: string
    }

export type RuntimeContentTextAuthoringCommitResult =
  | {
      readonly ok: true
      readonly status: 'updated' | 'unchanged'
      readonly feedback: RuntimeContentTextAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimeContentTextAuthoringPlanFailureCode
      readonly reason: string
    }

export type RuntimePropertyAuthoringCommitResult =
  | {
      readonly ok: true
      readonly status: 'updated' | 'unchanged'
      readonly feedback: RuntimePropertyAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimePropertyAuthoringPlanFailureCode
      readonly reason: string
    }

export type RuntimeTemplateCreationCommitResult =
  | {
      readonly ok: true
      readonly status: 'created'
      readonly feedback: CourseRuntimeTemplateCreationFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseRuntimeTemplateCreationPlanFailureCode
      readonly reason: string
    }

export type RuntimeAuthoringState = {
  readonly document: CourseProjectDocument | null
  readonly sidecar: CourseAssetSidecar | null
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly authoringSession: CourseAuthoringSession | null
  readonly editingScope: 'scene' | 'global'
  readonly activeSceneId?: string
  readonly projection?: EffectiveLayerProjection | null
  readonly hasSlideSession?: boolean
}

export type RuntimeAuthoringPorts = {
  read(): RuntimeAuthoringState
  setFeedback(feedback: { errorMessage?: string | null; statusMessage?: string | null }): void
  persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean
  persistSlideCommand(
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: SlidePersistExtra,
  ): SlideCommandResult
  persistProject(document: CourseProjectDocument, options?: { statusMessage?: string | null }): void
}

export function createRuntimeAuthoringActions(ports: RuntimeAuthoringPorts) {
  const rejectRuntimeSourceAuthoring = (
    code: RuntimeSourceAuthoringPlanFailureCode,
    reason: string,
  ): RuntimeSourceAuthoringCommitResult => {
    ports.setFeedback({ errorMessage: reason, statusMessage: null })
    return { ok: false, code, reason }
  }

  const commitRuntimeSourceAtTarget = (
    target: CourseAuthoringTarget,
    source: string,
  ): RuntimeSourceAuthoringCommitResult => {
    const state = ports.read()
    const document = state.document
    if (!document || document.id !== target.projectId) {
      return rejectRuntimeSourceAuthoring(
        'project-mismatch',
        '运行时源码草稿不属于当前 Course Project。',
      )
    }
    const projection = state.projection
    let authoringSession = state.authoringSession
    if (!projection || !authoringSession) {
      return rejectRuntimeSourceAuthoring(
        'invalid-target',
        '当前没有可提交运行时源码的课程作者会话。',
      )
    }
    const expectedScope = target.owner === 'global' ? 'global' : 'scene'
    if (
      state.editingScope !== expectedScope
      || projection.scope.owner !== target.owner
      || projection.scope.ownerKey !== target.ownerKey
    ) {
      return rejectRuntimeSourceAuthoring(
        'owner-mismatch',
        '当前编辑范围已切换，运行时源码没有写入。',
      )
    }

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )

    const planned = planRuntimeSourceUpdate({
      project: document,
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      },
      target,
      source,
      now: new Date().toISOString(),
    })
    if (!planned.ok) {
      return rejectRuntimeSourceAuthoring(planned.code, planned.reason)
    }
    if (planned.status === 'no-op') {
      ports.setFeedback({ errorMessage: null, statusMessage: '运行时源码没有变化' })
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectRuntimeSourceAuthoring(
        'invalid-document',
        '运行时源码事务缺少结果信息，未写入工程。',
      )
    }
    try {
      const step = createEditorTransactionStep(document, planned.plan)
      if (!step || !ports.persistTransaction(
        step,
        target.owner === 'global'
          ? '已更新全局运行时源码'
          : '已更新当前作用域的运行时源码',
      )) {
        return rejectRuntimeSourceAuthoring(
          'invalid-document',
          '当前没有可提交运行时源码的课程编辑会话。',
        )
      }
      return { ok: true, status: 'committed', feedback }
    } catch (error) {
      return rejectRuntimeSourceAuthoring(
        'invalid-document',
        error instanceof Error ? error.message : '运行时源码事务无效，未写入工程。',
      )
    }
  }

  const captureRuntimeContentTextTarget = (
    session: Readonly<RuntimeTargetEditSession>,
  ): CourseRuntimeContentTextTarget | null => {
    const state = ports.read()
    const document = state.document
    const projection = state.projection
    let authoringSession = state.authoringSession
    if (
      !document
      || !projection
      || !authoringSession
      || session.kind !== 'text'
      || session.projectId !== document.id
      || session.scope !== state.editingScope
      || session.sceneId !== state.activeSceneId
      || authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return null
    }

    let expectedOwner: 'global' | 'scene'
    const projectedItemId = session.nodeId
    if (!projectedItemId) return null
    if (session.scope === 'global') {
      if (projection.surfaceType !== 'slide') return null
      expectedOwner = 'global'
    } else {
      const location = document.locations.find(
        (candidate) => candidate.id === projection.locationId,
      )
      const surface = document.surfaces.find(
        (candidate) => candidate.id === projection.surfaceId,
      )
      if (
        !location
        || location.kind !== 'slide-scene'
        || !surface
        || surface.type !== 'slide'
        || session.sceneId !== location.sceneId
      ) {
        return null
      }
      expectedOwner = 'scene'
    }

    const row = projection.unifiedRows.find((candidate) => (
      candidate.owner === expectedOwner
      && candidate.id === projectedItemId
      && candidate.item.kind === 'runtime'
    ))
    if (
      !row
      || row.item.kind !== 'runtime'
      || row.locked
      || !Object.hasOwn(row.item.runtime.content.values, session.key)
    ) {
      return null
    }
    const initialValue = row.item.runtime.content.values[session.key]
    if (typeof initialValue !== 'string') return null

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    try {
      return captureCourseRuntimeContentTextTarget({
        sessionToken: authoringSession.token,
        projectId: document.id,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: row.owner,
        sceneId: row.scopeToken.sceneId,
        itemId: row.id,
        contentKey: session.key,
        initialValue,
      })
    } catch {
      return null
    }
  }

  const rejectRuntimeContentTextAuthoring = (
    code: RuntimeContentTextAuthoringPlanFailureCode,
    reason: string,
  ): RuntimeContentTextAuthoringCommitResult => ({
    ok: false,
    code,
    reason,
  })

  const updateRuntimeContentTextAtTarget = (
    target: CourseRuntimeContentTextTarget,
    value: string,
  ): RuntimeContentTextAuthoringCommitResult => {
    const state = ports.read()
    const document = state.document
    const projection = state.projection
    let authoringSession = state.authoringSession
    if (!document || document.id !== target.courseTarget.projectId) {
      return rejectRuntimeContentTextAuthoring(
        'project-mismatch',
        '运行时文字目标不属于当前 Course Project。',
      )
    }
    if (!projection || !authoringSession) {
      return rejectRuntimeContentTextAuthoring(
        'session-stale',
        '运行时文字编辑会话已过期，请重新选择目标。',
      )
    }
    if (
      authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return rejectRuntimeContentTextAuthoring(
        'session-stale',
        '运行时文字编辑会话已过期，请重新选择目标。',
      )
    }
    const expectedScope = target.courseTarget.owner === 'global' ? 'global' : 'scene'
    if (
      state.editingScope !== expectedScope
      || projection.scope.owner !== target.courseTarget.owner
      || projection.scope.ownerKey !== target.courseTarget.ownerKey
    ) {
      return rejectRuntimeContentTextAuthoring(
        'owner-mismatch',
        '当前编辑范围已切换，运行时文字没有写入。',
      )
    }

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    const planned = planRuntimeContentTextUpdate({
      project: document,
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      },
      target,
      value,
      now: new Date().toISOString(),
    })
    if (!planned.ok) {
      return rejectRuntimeContentTextAuthoring(planned.code, planned.reason)
    }
    if (planned.status === 'no-op') {
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectRuntimeContentTextAuthoring(
        'invalid-document',
        '运行时文字事务缺少结果信息，未写入工程。',
      )
    }
    try {
      const step = createEditorTransactionStep(document, planned.plan)
      if (!step || !ports.persistTransaction(
        step,
        target.courseTarget.owner === 'global'
          ? '已更新全局运行时文字；此内容由整课共享'
          : '已更新运行时文字；此内容由当前场景的所有状态共享',
      )) {
        return rejectRuntimeContentTextAuthoring(
          'invalid-document',
          '当前 Course Project 没有可用的作者会话。',
        )
      }
      return { ok: true, status: 'updated', feedback }
    } catch (error) {
      return rejectRuntimeContentTextAuthoring(
        'invalid-document',
        error instanceof Error ? error.message : '运行时文字事务无效，未写入工程。',
      )
    }
  }

  const rejectRuntimePropertyAuthoring = (
    code: RuntimePropertyAuthoringPlanFailureCode,
    reason: string,
  ): RuntimePropertyAuthoringCommitResult => ({
    ok: false,
    code,
    reason,
  })

  const updateRuntimePropertyAtTarget = (
    target: CourseRuntimePropertyTarget,
    update: CourseRuntimePropertyUpdate,
  ): RuntimePropertyAuthoringCommitResult => {
    const state = ports.read()
    const document = state.document
    const projection = state.projection
    let authoringSession = state.authoringSession
    const stable = target.courseTarget
    if (!document || document.id !== stable.projectId) {
      return rejectRuntimePropertyAuthoring(
        'project-mismatch',
        '运行时属性目标不属于当前 Course Project。',
      )
    }
    if (!projection || !authoringSession) {
      return rejectRuntimePropertyAuthoring(
        'session-stale',
        '运行时属性编辑会话已过期，请重新选择目标。',
      )
    }
    if (
      authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return rejectRuntimePropertyAuthoring(
        'session-stale',
        '运行时属性编辑会话已过期，请重新选择目标。',
      )
    }
    const expectedScope = stable.owner === 'global' ? 'global' : 'scene'
    if (
      state.editingScope !== expectedScope
      || projection.scope.owner !== stable.owner
      || projection.scope.ownerKey !== stable.ownerKey
    ) {
      return rejectRuntimePropertyAuthoring(
        'owner-mismatch',
        '当前编辑范围已切换，运行时属性没有写入。',
      )
    }

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    const planned = planRuntimePropertyUpdate({
      project: document,
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      },
      target,
      update,
      now: new Date().toISOString(),
    })
    if (!planned.ok) {
      return rejectRuntimePropertyAuthoring(planned.code, planned.reason)
    }
    if (planned.status === 'no-op') {
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectRuntimePropertyAuthoring(
        'invalid-document',
        '运行时属性事务缺少结果信息，未写入工程。',
      )
    }
    const fieldLabel = target.field === 'enabled' ? '启用状态' : '渲染模式'
    try {
      const step = createEditorTransactionStep(document, planned.plan)
      if (!step || !ports.persistTransaction(
        step,
        stable.owner === 'global'
          ? `已更新全局运行时${fieldLabel}`
          : `已更新当前作用域的运行时${fieldLabel}`,
      )) {
        return rejectRuntimePropertyAuthoring(
          'invalid-document',
          '当前 Course Project 没有可用的作者会话。',
        )
      }
      return { ok: true, status: 'updated', feedback }
    } catch (error) {
      return rejectRuntimePropertyAuthoring(
        'invalid-document',
        error instanceof Error ? error.message : '运行时属性事务无效，未写入工程。',
      )
    }
  }

  const rejectRuntimeTemplateCreation = (
    code: CourseRuntimeTemplateCreationPlanFailureCode,
    reason: string,
  ): RuntimeTemplateCreationCommitResult => {
    ports.setFeedback({ errorMessage: reason, statusMessage: null })
    return { ok: false, code, reason }
  }

  const createRuntimeTemplateAtTarget = (
    target: CourseRuntimeTemplateCreationTarget,
  ): RuntimeTemplateCreationCommitResult => {
    const state = ports.read()
    const document = state.document
    const projection = state.projection
    let authoringSession = state.authoringSession
    if (!document || document.id !== target.projectId) {
      return rejectRuntimeTemplateCreation(
        'project-mismatch',
        '运行时模板目标不属于当前 Course Project。',
      )
    }
    if (!projection || !authoringSession) {
      return rejectRuntimeTemplateCreation(
        'session-stale',
        '运行时模板创建会话已过期，请重新打开开发工作台。',
      )
    }
    if (
      authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return rejectRuntimeTemplateCreation(
        'session-stale',
        '运行时模板创建会话已过期，请重新打开开发工作台。',
      )
    }
    const expectedScope = target.owner === 'global' ? 'global' : 'scene'
    if (
      state.editingScope !== expectedScope
      || projection.scope.owner !== target.owner
      || projection.scope.ownerKey !== target.ownerKey
    ) {
      return rejectRuntimeTemplateCreation(
        'owner-mismatch',
        '当前编辑范围已切换，运行时模板没有写入。',
      )
    }

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    const planned = planRuntimeTemplateCreation({
      project: document,
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      },
      target,
      newItemId: nanoid(),
      now: new Date().toISOString(),
    })
    if (!planned.ok) {
      return rejectRuntimeTemplateCreation(planned.code, planned.reason)
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectRuntimeTemplateCreation(
        'invalid-document',
        '运行时模板事务缺少结果信息，未写入工程。',
      )
    }
    try {
      const step = createEditorTransactionStep(document, planned.plan)
      if (!step || !ports.persistTransaction(
        step,
        target.owner === 'global'
          ? '已创建全局运行时模板'
          : '已创建场景运行时模板',
      )) {
        return rejectRuntimeTemplateCreation(
          'invalid-document',
          '当前 Course Project 没有可用的作者会话。',
        )
      }
      return { ok: true, status: 'created', feedback }
    } catch (error) {
      return rejectRuntimeTemplateCreation(
        'invalid-document',
        error instanceof Error ? error.message : '运行时模板事务无效，未写入工程。',
      )
    }
  }

  const captureRuntimeAssetReplacementTarget = (
    session: Readonly<RuntimeTargetEditSession>,
  ): CourseRuntimeAssetReplacementTarget | null => {
    const state = ports.read()
    const document = state.document
    const projection = state.projection
    let authoringSession = state.authoringSession
    if (
      !document
      || !projection
      || !authoringSession
      || session.kind !== 'asset'
      || session.projectId !== document.id
      || session.scope !== state.editingScope
      || session.sceneId !== state.activeSceneId
      || authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return null
    }
    let expectedOwner: 'global' | 'scene'
    const projectedItemId = session.nodeId
    if (!projectedItemId) return null
    if (session.scope === 'global') {
      if (projection.surfaceType !== 'slide') return null
      expectedOwner = 'global'
    } else {
      const location = document.locations.find(
        (candidate) => candidate.id === projection.locationId,
      )
      const surface = document.surfaces.find(
        (candidate) => candidate.id === projection.surfaceId,
      )
      if (
        !location
        || location.kind !== 'slide-scene'
        || !surface
        || surface.type !== 'slide'
        || session.sceneId !== location.sceneId
      ) {
        return null
      }
      expectedOwner = 'scene'
    }
    const row = projection.unifiedRows.find((candidate) => (
      candidate.owner === expectedOwner
      && candidate.id === projectedItemId
      && candidate.item.kind === 'runtime'
    ))
    if (
      !row
      || row.item.kind !== 'runtime'
      || row.item.locked
      || !Object.hasOwn(row.item.runtime.assets, session.key)
    ) {
      return null
    }
    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    try {
      return captureCourseRuntimeAssetReplacementTarget({
        sessionToken: authoringSession.token,
        projectId: document.id,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: row.owner,
        sceneId: row.scopeToken.sceneId,
        itemId: row.id,
        bindingKey: session.key,
      })
    } catch {
      return null
    }
  }

  const replaceRuntimeAssetAtTarget = (
    target: CourseRuntimeAssetReplacementTarget,
    asset: AssetMeta,
    bytes: Uint8Array,
  ): RuntimeAssetReplacementCommitResult => {
    const state = ports.read()
    const document = state.document
    const projection = state.projection
    let authoringSession = state.authoringSession
    if (!document || document.id !== target.courseTarget.projectId) {
      return {
        ok: false,
        code: 'project-mismatch',
        reason: 'Runtime 素材替换目标不属于当前 Course Project。',
      }
    }
    if (!projection || !authoringSession) {
      return {
        ok: false,
        code: 'session-stale',
        reason: 'Runtime 素材替换会话已过期，请重新选择目标。',
      }
    }
    if (
      authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return {
        ok: false,
        code: 'session-stale',
        reason: 'Runtime 素材替换会话已过期，请重新选择目标。',
      }
    }
    const targetRow = projection.unifiedRows.find((row) => (
      row.id === target.courseTarget.itemId
      && row.owner === target.courseTarget.owner
      && row.item.kind === 'runtime'
    ))
    const scopeCompatible = target.courseTarget.owner === 'global'
      ? state.editingScope === 'global'
      : state.editingScope === 'scene'
    if (!targetRow || !scopeCompatible) {
      return {
        ok: false,
        code: targetRow ? 'owner-mismatch' : 'item-missing',
        reason: targetRow
          ? 'Runtime 素材替换目标的共享范围已改变。'
          : '原 Runtime 图层已不存在，请重新选择目标。',
      }
    }
    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    const planned = planCourseRuntimeAssetReplacement({
      project: document,
      sidecar: state.sidecar ?? emptyCourseAssetSidecar(),
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: targetRow.owner,
        ownerKey: targetRow.scopeToken.ownerKey,
      },
      target,
      asset,
      bytes,
      now: new Date().toISOString(),
    })
    if (!planned.ok) return planned
    if (planned.status === 'no-op') {
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    try {
      const step = createEditorTransactionStep(document, planned.plan)
      if (!step || !ports.persistTransaction(
        step,
        target.courseTarget.owner === 'global'
          ? '已替换全局运行时图片；此素材由整课共享'
          : '已替换运行时图片；此素材由当前场景的所有状态共享',
      )) {
        return {
          ok: false,
          code: 'invalid-document',
          reason: '当前 Course Project 没有可用的作者会话。',
        }
      }
      return {
        ok: true,
        status: 'replaced',
        feedback: planned.plan.feedback!,
      }
    } catch (error) {
      return {
        ok: false,
        code: 'invalid-document',
        reason: error instanceof Error ? error.message : 'Runtime 素材替换计划无效。',
      }
    }
  }

  return {
    updateRuntimeSourceAtTarget: commitRuntimeSourceAtTarget,
    captureRuntimeContentTextTarget,
    updateRuntimeContentTextAtTarget,
    updateRuntimePropertyAtTarget,
    createRuntimeTemplateAtTarget,
    captureRuntimeAssetReplacementTarget,
    replaceRuntimeAssetAtTarget,
    setSimpleEntranceAnimation(
      nodeId: string,
      config: Parameters<typeof setSlideSimpleEntranceAnimation>[2],
    ) {
      ports.persistSlideCommand((session) => setSlideSimpleEntranceAnimation(
        session,
        nodeId,
        config,
        { expectedRevision: session.history.present.revision },
      ))
    },
    updatePlayback(patch: Parameters<typeof updateCoursePlaybackSettings>[1]) {
      const document = ports.read().document
      if (!document) {
        ports.setFeedback({
          errorMessage: '当前 Course Project 没有可用的作者会话。',
          statusMessage: null,
        })
        return
      }
      const result = updateCoursePlaybackSettings(document, patch, {
        expectedRevision: document.revision,
      })
      if (result.ok && result.nextDocument) {
        ports.persistProject(result.nextDocument, {
          statusMessage: result.reason ?? '成品控制设置已更新',
        })
        return
      }
      if (!result.ok) {
        ports.setFeedback({ errorMessage: result.reason, statusMessage: null })
      }
    },
    updateDesignTokens(tokens: ProjectDesignTokens) {
      const document = ports.read().document
      if (!document) {
        ports.setFeedback({
          errorMessage: '当前 Course Project 没有可用的作者会话。',
          statusMessage: null,
        })
        return
      }
      if (ports.read().hasSlideSession) {
        ports.persistSlideCommand((session) => {
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            draft.designTokens = structuredClone(tokens)
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
        }, { statusMessage: '项目字体与色板 Token 已更新' })
        return
      }
      const project = commitSlideProjectMutation(document, (draft) => {
        draft.designTokens = structuredClone(tokens)
      })
      ports.persistProject(project, { statusMessage: '项目字体与色板 Token 已更新' })
    },
  }
}
