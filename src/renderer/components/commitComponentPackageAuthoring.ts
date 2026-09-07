import { nanoid } from 'nanoid'
import { captureComponentInsertionTarget, insertComponentPackagesAtTarget, type ComponentInsertionTarget } from './insertComponentPackages'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { captureComponentPackageSourceBaseline, assertComponentPackageSourceBaseline, prepareComponentPackageSourceRevision, planComponentPackageFork, type ComponentPackageSourceBaseline } from './componentPackageRevision'
import { UserFacingError } from '../../shared/errors'
import { createEditorTransactionStep, type EditorTransactionStep } from '../authoring/editorTransaction'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { CourseAssetSidecar } from '../project/v9AssetAdapter'
import type { CourseAuthoringSession } from '../authoring/courseAuthoringSession'
import type { SlideAuthoringSession, SlideCommandResult } from '../course/slideAuthoringBackend'
import type { SlidePersistExtra } from '../store/slices/slideAuthoringSlice'
import type { SpatialAuthoringSession, SpatialCommandResult } from '../course/spatialEditorCommands'
import type { FlowAuthoringSession } from '../project/createFlowCourseProject'
import type { FlowCommandResult } from '../course/flowEditorCommands'
import type { FlowSharedAuthoringResult } from '../course/flowSharedAuthoringAdapters'
import {
  planCourseComponentPackageDeletion,
  planCourseComponentPackageReplacement,
  type CourseComponentPackageReplacementFeedback,
  type CourseComponentPackageReplacementFailureCode,
} from './courseComponentPackageTransactions'
import { commitSlideProjectMutation } from '../course/slideEditorCommands'
import { addSlideComponentLayer } from '../course/v9SlideContentCommands'
import { addSpatialWorldComponentLayer } from '../course/spatialEditorCommands'
import { insertFlowSharedComponent } from '../course/flowSharedAuthoringAdapters'
import { componentPackageMeta } from './editableComponentPackage'

export interface ComponentPackageSourceTarget extends ComponentPackageSourceBaseline {
  readonly projectPath: string | null
  readonly sessionGeneration: number | null
}

export interface CourseProjectRevisionTarget {
  readonly projectId: string
  readonly documentRevision: number
}

export interface ComponentPackageReplacementTarget extends CourseProjectRevisionTarget {
  readonly packageId: string
}

export type ComponentPackageReplacementCommitResult =
  | {
      readonly ok: true
      readonly status: 'replaced' | 'unchanged'
      readonly feedback: CourseComponentPackageReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseComponentPackageReplacementFailureCode
      readonly reason: string
    }

export type ComponentAuthoringState = {
  readonly projectPath?: string | null
  readonly document: CourseProjectDocument | null
  readonly sidecar: CourseAssetSidecar | null
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly authoringSession: CourseAuthoringSession | null
  readonly editingScope: 'scene' | 'global'
  readonly interactionStateId: string | null
  readonly hasSpatialSession: boolean
  readonly hasFlowSession: boolean
}

export type ComponentAuthoringPorts = {
  read(): ComponentAuthoringState
  readSpatialSession(): SpatialAuthoringSession | null
  readFlowSession(): FlowAuthoringSession | null
  readSlideSession?(): SlideAuthoringSession | null
  setFeedback(feedback: { errorMessage?: string | null; statusMessage?: string | null }): void
  setActiveTab(tab: 'components' | 'elements' | 'developer'): void
  persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean
  persistProject(document: CourseProjectDocument, extra?: {
    statusMessage?: string | null
    componentPackages?: Record<string, ComponentPackageData>
  }): void
  persistSpatial(result: SpatialCommandResult, extra?: { statusMessage?: string | null }): void
  persistFlow(result: FlowCommandResult | FlowSharedAuthoringResult, extra?: { statusMessage?: string | null }): void
  persistSlideCommand(
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: SlidePersistExtra,
  ): SlideCommandResult
}

export function captureComponentPackageReplacementTarget(
  ports: ComponentAuthoringPorts,
  packageId: string,
): ComponentPackageReplacementTarget | null {
  const state = ports.read()
  const document = state.document
  if (
    !document
    || !Object.hasOwn(document.componentPackages, packageId)
    || !Object.hasOwn(state.componentPackages, packageId)
  ) {
    return null
  }
  return Object.freeze({
    projectId: document.id,
    documentRevision: document.revision,
    packageId,
  })
}

export function commitComponentReplacementAtTarget(
  ports: ComponentAuthoringPorts,
  target: ComponentPackageReplacementTarget,
  packageData: ComponentPackageData,
): ComponentPackageReplacementCommitResult {
  const state = ports.read()
  const document = state.document
  if (!document || document.id !== target.projectId) {
    return {
      ok: false,
      code: 'project-mismatch',
      reason: '组件替换目标不属于当前 Course Project，请重新开始替换。',
    }
  }
  const planned = planCourseComponentPackageReplacement({
    project: document,
    componentPackages: state.componentPackages,
    packageId: target.packageId,
    replacement: packageData,
    expected: {
      projectId: target.projectId,
      revision: target.documentRevision,
    },
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
      `组件“${packageData.manifest.name}”已替换为 ${planned.plan.feedback?.replacementVersion ?? packageData.manifest.version}，${planned.plan.feedback?.affectedInstances.length ?? 0} 个实例已同步`,
    )) {
      return {
        ok: false,
        code: 'invalid-document',
        reason: '当前 Course Project 没有可用的作者会话。',
      }
    }
    ports.setActiveTab('components')
    ports.setFeedback({ errorMessage: null })
    return {
      ok: true,
      status: 'replaced',
      feedback: planned.plan.feedback!,
    }
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-document',
      reason: error instanceof Error ? error.message : '组件替换计划无效。',
    }
  }
}

export { componentPackageMeta, editableComponentPackageId } from './editableComponentPackage'

export function createComponentAuthoringActions(ports: ComponentAuthoringPorts) {
  return {
    captureComponentInsertionTarget: () => captureComponentInsertionTarget(ports),
    insertComponentPackagesAtTarget: (target: ComponentInsertionTarget, packages: readonly ComponentPackageData[]) =>
      insertComponentPackagesAtTarget(ports, target, packages),
    captureComponentPackageReplacementTarget: (packageId: string) => (
      captureComponentPackageReplacementTarget(ports, packageId)
    ),
    replaceComponentPackageAtTarget: (
      target: ComponentPackageReplacementTarget,
      packageData: ComponentPackageData,
    ) => commitComponentReplacementAtTarget(ports, target, packageData),
    replaceComponentPackage(packageId: string, packageData: ComponentPackageData) {
      const replacementId = packageData.manifest.id
      if (replacementId !== packageId) {
        throw new UserFacingError(
          '组件替换失败',
          `所选组件包 ID 为“${replacementId}”，与待替换的“${packageId}”不一致。`,
          '请选择同一组件 ID 的新版本；替换不会自动把实例迁移到另一种组件。',
        )
      }
      const currentPackage = ports.read().componentPackages[packageId]
      const currentHash = currentPackage?.provenance?.sha256
      const replacementHash = packageData.provenance?.sha256
      if (
        currentPackage?.manifest.version === packageData.manifest.version &&
        currentHash !== undefined &&
        replacementHash !== undefined &&
        currentHash !== replacementHash
      ) {
        throw new UserFacingError(
          '组件替换失败',
          `组件“${packageId}”的 ${packageData.manifest.version} 版本与工程内同版本哈希不一致。`,
          '同一 ID 与版本必须锁定到完全相同的包；请让组件维护者提升版本号后再更新。',
        )
      }
      const target = captureComponentPackageReplacementTarget(ports, packageId)
      if (!target) {
        throw new UserFacingError(
          '组件替换失败',
          `工程中不存在可替换的组件包“${packageId}”。`,
          '请刷新工程组件列表后重试。',
        )
      }
      const result = commitComponentReplacementAtTarget(ports, target, packageData)
      if (!result.ok) {
        throw new UserFacingError(
          '组件替换失败',
          result.reason,
          result.code === 'unsupported-scope'
            ? '请使用 supportedScopes 覆盖现有实例范围的同 ID 组件包，或先删除不兼容范围内的实例。'
            : '当前工程未发生变化，请检查组件包内容、版本与工程状态后重试。',
        )
      }
    },
    importComponentPackage(packageData: ComponentPackageData) {
      createComponentAuthoringActions(ports).importComponentPackages([packageData])
    },
    importComponentPackages(packageData: ComponentPackageData[]) {
      if (packageData.length === 0) return
      const existingPackages = ports.read().componentPackages
      const pendingIds = new Set<string>()
      for (const data of packageData) {
        const id = data.manifest.id
        if (pendingIds.has(id)) {
          throw new UserFacingError(
            '组件批量导入失败',
            `所选文件中包含多个 ID 为“${id}”的组件包。`,
            '每个组件 ID 每批只能加入一个版本；请取消重复选择后重试。',
          )
        }
        pendingIds.add(id)
        const existing = existingPackages[id]
        if (!existing) continue
        const sameVersion = existing.manifest.version === data.manifest.version
        throw new UserFacingError(
          '组件导入失败',
          sameVersion
            ? `组件“${existing.manifest.name}” ${existing.manifest.version} 已经加入工程。`
            : `工程已包含组件“${existing.manifest.name}” ${existing.manifest.version}，不能再加入同 ID 的 ${data.manifest.version}。`,
          sameVersion
            ? '请直接从“工程组件”插入实例；若要更新代码，请使用该组件的管理菜单。'
            : '请从“工程组件”的管理菜单审阅更新或替换，实例会统一升级。',
        )
      }
      const document = ports.read().document
      if (!document) {
        ports.setFeedback({
          errorMessage: '当前 Course Project 没有可用的作者会话。',
          statusMessage: null,
        })
        return
      }
      const packagesToAdd = Object.fromEntries(
        packageData.map((data) => [data.manifest.id, data]),
      )
      const statusMessage = packageData.length === 1
        ? `已将组件“${packageData[0]!.manifest.name}”加入工程`
        : `已将 ${packageData.length} 个组件加入工程`
      const project = commitSlideProjectMutation(document, (draft) => {
        packageData.forEach((data) => {
          draft.componentPackages[data.manifest.id] = componentPackageMeta(data)
        })
      })
      ports.persistProject(project, { componentPackages: packagesToAdd, statusMessage })
      ports.setActiveTab('components')
    },
    deleteComponentPackage(packageId: string): boolean {
      const state = ports.read()
      const document = state.document
      if (!document) {
        ports.setFeedback({
          errorMessage: '当前 Course Project 没有可用的作者会话。',
          statusMessage: null,
        })
        return false
      }
      const planned = planCourseComponentPackageDeletion({
        project: document,
        componentPackages: state.componentPackages,
        packageId,
        expected: {
          projectId: document.id,
          revision: document.revision,
        },
        now: new Date().toISOString(),
      })
      if (!planned.ok) {
        ports.setFeedback({ errorMessage: planned.reason, statusMessage: null })
        return false
      }
      const packageName = state.componentPackages[packageId]?.manifest.name ?? packageId
      try {
        const step = createEditorTransactionStep(document, planned.plan)
        if (!step || !ports.persistTransaction(step, `未使用组件包“${packageName}”已删除`)) {
          ports.setFeedback({
            errorMessage: '当前 Course Project 没有可用的作者会话。',
            statusMessage: null,
          })
          return false
        }
      } catch (error) {
        ports.setFeedback({
          errorMessage: error instanceof Error ? error.message : '组件删除未写入当前课件。',
          statusMessage: null,
        })
        return false
      }
      ports.setActiveTab('components')
      return true
    },
    createEditableComponentCopy(packageId: string, nodeId?: string): string | null {
      const state = ports.read()
      const source = state.componentPackages[packageId]
      if (!source) {
        ports.setFeedback({
          errorMessage: `工程中不存在组件包“${packageId}”。`,
          statusMessage: null,
        })
        return null
      }
      if (
        nodeId &&
        state.editingScope === 'scene' &&
        state.interactionStateId !== null
      ) {
        ports.setFeedback({
          errorMessage:
            '命名状态只能覆盖图层属性，不能改变元素内容。请切换到“基础”后再创建可编辑副本。',
          statusMessage: null,
        })
        return null
      }
      const document = state.document
      if (!document) {
        ports.setFeedback({
          errorMessage: '当前 Course Project 没有可用的作者会话。',
          statusMessage: null,
        })
        return null
      }
      const nextId = `${packageId}.editable.${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`
      const plan = planComponentPackageFork(document, state.componentPackages, packageId, nextId, nodeId)
      const step = createEditorTransactionStep(document, plan)
      if (!step || !ports.persistTransaction(step, '已为当前实例创建独立组件包；原包仍保留')) return null
      ports.setActiveTab('developer')
      ports.setFeedback({ errorMessage: null })
      return nextId
    },
    captureComponentPackageSourceTarget(packageId: string): ComponentPackageSourceTarget {
      const state = ports.read()
      if (!state.document) throw new Error('当前没有工程')
      return Object.freeze({ ...captureComponentPackageSourceBaseline(state.document, packageId),
        projectPath: state.projectPath ?? null, sessionGeneration: state.authoringSession?.token.generation ?? null })
    },
    async updateComponentPackageSources(target: ComponentPackageSourceTarget, files: Readonly<Record<string, Uint8Array>>, signal?: AbortSignal): Promise<'updated' | 'unchanged'> {
      const check = () => {
        const current = ports.read()
        if (signal?.aborted) throw new Error('组件源码校验已取消，草稿已保留')
        if (!current.document || (current.projectPath ?? null) !== target.projectPath
          || (current.authoringSession?.token.generation ?? null) !== target.sessionGeneration) throw new Error('stale：编辑会话已改变，草稿已保留')
        assertComponentPackageSourceBaseline(current.document, target)
        return current
      }
      const state = check()
      const result = await prepareComponentPackageSourceRevision({ project: state.document!,
        resources: { componentPackages: state.componentPackages, assetFiles: state.sidecar?.files ?? {} },
        baseline: target, files, operationId: crypto.randomUUID() }, signal)
      const current = check()
      if (!result.ok) throw new Error(result.reason)
      if (result.status === 'no-op') return 'unchanged'
      const step = createEditorTransactionStep(current.document!, result.plan)
      if (!step || !ports.persistTransaction(step, `组件源码已更新，${result.plan.feedback?.affectedInstances.length ?? 0} 个实例已同步`)) throw new Error('组件源码未提交，草稿已保留')
      ports.setFeedback({ errorMessage: null })
      return 'updated'
    },
    addExternalComponentNode(packageId: string, x?: number, y?: number, presetId?: string) {
      const state = ports.read()
      const data = state.componentPackages[packageId]
      if (!data) return
      const extras = {
        statusMessage: `已添加“${data.manifest.name}”`,
      }
      if (state.hasSpatialSession) {
        const spatial = ports.readSpatialSession()
        if (!spatial) return
        ports.persistSpatial(addSpatialWorldComponentLayer(spatial, {
          packageId,
          ...(typeof x === 'number' ? { x } : {}),
          ...(typeof y === 'number' ? { y } : {}),
        }, { expectedRevision: spatial.history.present.revision }), extras)
        return
      }
      if (state.hasFlowSession) {
        const flow = ports.readFlowSession()
        const document = state.document
        if (!flow || !document) return
        ports.persistFlow(insertFlowSharedComponent(document, flow.selection, {
          packageId,
          manifest: data.manifest,
        }), extras)
        return
      }
      ports.persistSlideCommand((session) => addSlideComponentLayer(session, {
        packageId,
        manifest: data.manifest,
        presetId,
        ...(typeof x === 'number' ? { x } : {}),
        ...(typeof y === 'number' ? { y } : {}),
      }, { expectedRevision: session.history.present.revision }), extras)
    },
  }
}

export type { AssetMeta }
