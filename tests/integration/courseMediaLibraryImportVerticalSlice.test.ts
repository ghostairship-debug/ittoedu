import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'

import {
  createCourseProjectArchive,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '../../src/core/drivers/codecs/courseProjectArchive'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActivePresentationStateId,
  selectActiveSceneId,
  selectEditingScope,
  selectMediaAssetFiles,
  selectSelectedNodeId,
  selectSelectedNodeIds,
  useEditorStore,
} from '@/renderer/store/editorStore'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import type { DocumentModel } from '@/shared/workbench/document'
import {
  bootTriageCourseHost,
  formalCourse,
  projectBody,
  projectCourse,
  redoCourse,
  settleCourse,
  undoCourse,
  type TriageCourseHost,
} from '../helpers/triage-t7-courseHost'

const FIXTURE_ROOT = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
)
const FIXED_TIME = '2026-08-24T05:00:00.000Z'

type FixtureId = 'slide-heavy' | 'flow-heavy' | 'mixed-spatial'

let host: TriageCourseHost

function fixture(id: FixtureId): CourseProjectArchiveData {
  return openCourseProjectArchive(new Uint8Array(readFileSync(
    join(FIXTURE_ROOT, `${id}.h5lesson`),
  )))
}

/**
 * 2.0 起工程内容与素材字节只经主进程 DocumentSession 进入工作台：`projectCourse`
 * 以正式文档打开工程，`archive.assetFiles` 就是该文档的正式 resources.assets。
 */
async function loadFixture(
  id: FixtureId,
  assetFiles?: Record<string, Uint8Array>,
): Promise<CourseProjectArchiveData> {
  const archive = fixture(id)
  await projectCourse(
    host,
    archive.project,
    assetFiles ?? archive.assetFiles,
    componentPackagesFromArchive(archive.project, archive.componentFiles),
  )
  await settleCourse()
  return archive
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function image(id: string, fill: number): { meta: AssetMeta; bytes: Uint8Array } {
  const bytes = Uint8Array.from([fill, fill + 1, fill + 2, fill + 3])
  return {
    meta: {
      id,
      filename: `${id}.png`,
      mimeType: 'image/png',
      kind: 'image',
      path: `assets/${id}.png`,
      byteLength: bytes.byteLength,
      width: 640,
      height: 360,
    },
    bytes,
  }
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([assetId, bytes]) => [assetId, [...bytes]]),
  )
}

function resourceSnapshotDepths() {
  const state = useEditorStore.getState()
  return {
    sidecarPast: state.courseAssetSidecarPast.length,
    sidecarFuture: state.courseAssetSidecarFuture.length,
    componentPast: state.courseComponentPackagesPast.length,
    componentFuture: state.courseComponentPackagesFuture.length,
  }
}

function selectionSnapshot() {
  const state = useEditorStore.getState()
  return {
    locationId: selectActiveCourseLocationId(state),
    activeSceneId: selectActiveSceneId(state),
    activePresentationStateId: selectActivePresentationStateId(state),
    selectedNodeId: selectSelectedNodeId(state),
    selectedNodeIds: [...selectSelectedNodeIds(state)],
    editingScope: selectEditingScope(state),
    slide: state.slideBackend?.kind === 'slide-authoring'
      ? structuredClone(state.slideBackend.getSession().selection)
      : null,
    flow: state.flowSession ? structuredClone(state.flowSession.selection) : null,
    spatial: state.spatialSession ? structuredClone(state.spatialSession.selection) : null,
  }
}

function topologyWithoutAssetMetadata(project: CourseProjectDocument) {
  const clone = structuredClone(project)
  clone.assets = {}
  clone.revision = 0
  clone.updatedAt = ''
  return clone
}

function activeHistory() {
  const state = useEditorStore.getState()
  if (state.spatialSession) {
    return { kind: 'spatial' as const, history: state.spatialSession.history }
  }
  if (state.flowSession) {
    return { kind: 'flow' as const, history: state.flowSession.history }
  }
  if (state.slideBackend?.kind === 'slide-authoring') {
    return { kind: 'slide' as const, history: state.slideBackend.getSession().history }
  }
  throw new Error('Expected an active V9 authoring history')
}

function courseResources(model: DocumentModel) {
  if (model.kind !== 'course-v9') throw new Error('Expected a Course Project V9 document')
  return model.resources
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right) return left === right
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

/**
 * 2.0 的唯一正式 History 在主进程 DocumentSession：一次编辑事务表现为"恰好一个新的
 * 历史步"，其资源增量就是该步前后两个 DocumentModel 之间发生变化的素材字节。整份资源
 * 快照不会产生任何增量，所以这里仍然断言"增量正好是这几个素材 ID"。
 */
function transactionAssetIds(before: DocumentModel, after: DocumentModel): string[] {
  const beforeAssets = courseResources(before).assets
  const afterAssets = courseResources(after).assets
  const assetIds = new Set([...Object.keys(beforeAssets), ...Object.keys(afterAssets)])
  return [...assetIds]
    .filter((assetId) => !sameBytes(beforeAssets[assetId], afterAssets[assetId]))
    .sort()
}

function authoritativeWriteSnapshot() {
  const state = useEditorStore.getState()
  const active = activeHistory()
  const formal = formalCourse(host)
  return {
    project: structuredClone(activeProject()),
    derivedProject: structuredClone(selectActiveCourseProjectDocument(state)!),
    files: byteMap(selectMediaAssetFiles(state)),
    activeHistory: structuredClone(active.history),
    sidecarPast: state.courseAssetSidecarPast.map((sidecar) => byteMap(sidecar.files)),
    sidecarFuture: state.courseAssetSidecarFuture.map((sidecar) => byteMap(sidecar.files)),
    componentPackages: structuredClone(state.componentPackages),
    componentPast: structuredClone(state.courseComponentPackagesPast),
    componentFuture: structuredClone(state.courseComponentPackagesFuture),
    selection: selectionSnapshot(),
    courseAuthoringSession: structuredClone(state.courseAuthoringSession),
    dirty: state.dirty,
    statusMessage: state.statusMessage,
    errorMessage: state.errorMessage,
    // 唯一正式 writer 的状态：被拒绝的目标提交不得改动主进程文档一步。
    formal: {
      revision: formal.revision,
      undoDepth: formal.undoDepth,
      redoDepth: formal.redoDepth,
      model: structuredClone(formal.model),
    },
  }
}

async function prepareSurface(id: FixtureId) {
  await loadFixture(id)
  if (id === 'slide-heavy') {
    useEditorStore.getState().activateCourseLocation('slide-location-intro')
    useEditorStore.getState().selectNode('slide-intro-title')
    await settleCourse()
    return useEditorStore.getState().captureMediaLibraryImportTarget()
  }
  if (id === 'flow-heavy') {
    useEditorStore.getState().activateCourseLocation('flow-location-start')
    await settleCourse()
    return useEditorStore.getState().captureMediaLibraryImportTarget()
  }

  // A media-library target is project-scoped: switching only the location is
  // permitted. The commit must join the history of the Surface active when the
  // asynchronous result returns.
  const target = useEditorStore.getState().captureMediaLibraryImportTarget()
  useEditorStore.getState().activateCourseLocation('mixed-location-spatial-detail')
  useEditorStore.getState().selectNode('mixed-spatial-node-a')
  await settleCourse()
  return target
}

beforeEach(async () => {
  host = await bootTriageCourseHost()
})

describe('ARCH-2 project-scoped media-library import vertical slice', () => {
  it.each([
    ['slide-heavy', 'slide'] as const,
    ['flow-heavy', 'flow'] as const,
    ['mixed-spatial', 'spatial'] as const,
  ])('commits one two-asset transaction on %s without placement or full resource snapshots', async (fixtureId, expectedKind) => {
    const target = await prepareSurface(fixtureId)
    if (!target) throw new Error('Expected a captured media-library target')
    expect(activeHistory().kind).toBe(expectedKind)

    const items = [
      image(`arch2-${fixtureId}-asset-a`, 11),
      image(`arch2-${fixtureId}-asset-b`, 21),
    ]
    const beforeProject = structuredClone(activeProject())
    const beforeFiles = byteMap(selectMediaAssetFiles(useEditorStore.getState()))
    const beforeHistoryDepth = formalCourse(host).undoDepth
    const beforeModel = structuredClone(formalCourse(host).model)
    const beforeResourceDepths = resourceSnapshotDepths()
    const beforeSelection = selectionSnapshot()
    const beforeSession = structuredClone(useEditorStore.getState().courseAuthoringSession)
    if (!beforeSession) throw new Error('Expected a Course authoring session')

    const result = useEditorStore.getState().importAssetsAtTarget(target, items)
    expect(result).toMatchObject({
      ok: true,
      status: 'imported',
      feedback: {
        kind: 'media-library-imported',
        importedAssetIds: items.map((item) => item.meta.id),
        addedAssetIds: items.map((item) => item.meta.id),
      },
    })
    await settleCourse()

    const afterProject = structuredClone(activeProject())
    expect(afterProject.revision).toBe(beforeProject.revision + 1)
    // 一次编辑事务 = 恰好一个新的正式历史步，且该步的素材增量正好是两个导入素材。
    expect(formalCourse(host).undoDepth).toBe(beforeHistoryDepth + 1)
    expect(transactionAssetIds(beforeModel, formalCourse(host).model))
      .toEqual(items.map((item) => item.meta.id).sort())
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    expect(selectionSnapshot()).toEqual(beforeSelection)
    const committedSession = useEditorStore.getState().courseAuthoringSession
    if (!committedSession) throw new Error('Expected the committed authoring session')
    expect(committedSession.token.revision).toBe(afterProject.revision)
    expect(committedSession.token.generation).toBe(beforeSession.token.generation)
    expect(committedSession.itemIds).toEqual(beforeSession.itemIds)
    expect(Object.isFrozen(committedSession)).toBe(true)
    expect(Object.isFrozen(committedSession.itemIds)).toBe(true)
    expect(topologyWithoutAssetMetadata(afterProject))
      .toEqual(topologyWithoutAssetMetadata(beforeProject))
    for (const item of items) {
      expect(afterProject.assets[item.meta.id]).toEqual(item.meta)
      expect(selectMediaAssetFiles(useEditorStore.getState())[item.meta.id])
        .toEqual(item.bytes)
    }

    await undoCourse(host)
    // 撤销恢复同一份正文；DocumentSession 的 revision 只前进，因此按正文比较并显式断言前进。
    expect(projectBody(activeProject())).toEqual(projectBody(beforeProject))
    expect(activeProject().revision).toBeGreaterThan(beforeProject.revision)
    expect(byteMap(selectMediaAssetFiles(useEditorStore.getState()))).toEqual(beforeFiles)
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    const undoneSession = useEditorStore.getState().courseAuthoringSession
    if (!undoneSession) throw new Error('Expected the undone authoring session')
    expect(undoneSession.token.revision).toBe(activeProject().revision)
    expect(undoneSession.token.generation).toBeGreaterThan(
      committedSession.token.generation,
    )
    expect(undoneSession.itemIds).toEqual(beforeSession.itemIds)
    expect(Object.isFrozen(undoneSession)).toBe(true)
    expect(Object.isFrozen(undoneSession.itemIds)).toBe(true)

    await redoCourse(host)
    expect(projectBody(activeProject())).toEqual(projectBody(afterProject))
    expect(activeProject().revision).toBeGreaterThan(afterProject.revision)
    for (const item of items) {
      expect(selectMediaAssetFiles(useEditorStore.getState())[item.meta.id])
        .toEqual(item.bytes)
    }
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    const redoneSession = useEditorStore.getState().courseAuthoringSession
    if (!redoneSession) throw new Error('Expected the redone authoring session')
    expect(redoneSession.token.revision).toBe(activeProject().revision)
    expect(redoneSession.token.generation).toBeGreaterThan(
      undoneSession.token.generation,
    )
    expect(redoneSession.itemIds).toEqual(beforeSession.itemIds)
    expect(Object.isFrozen(redoneSession)).toBe(true)
    expect(Object.isFrozen(redoneSession.itemIds)).toBe(true)
  })

  it('rejects stale revision, project mismatch and conflict, while exact reuse is a zero-write no-op', async () => {
    await loadFixture('slide-heavy')
    useEditorStore.getState().activateCourseLocation('slide-location-intro')
    await settleCourse()

    const exactId = 'slide-hero'
    const exactMeta = structuredClone(activeProject().assets[exactId])
    const exactBytes = selectMediaAssetFiles(useEditorStore.getState())[exactId]?.slice()
    if (!exactMeta || !exactBytes) throw new Error('Fixture asset is incomplete')

    const target = useEditorStore.getState().captureMediaLibraryImportTarget()
    if (!target) throw new Error('Expected a captured media-library target')
    let before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().importAssetsAtTarget(target, [{
      meta: exactMeta,
      bytes: exactBytes,
    }])).toMatchObject({
      ok: true,
      status: 'unchanged',
      feedback: { reusedAssetIds: [exactId], importedAssetIds: [] },
    })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().importAssetsAtTarget(target, [{
      meta: { ...exactMeta, filename: 'same-id-conflict.png' },
      bytes: exactBytes,
    }])).toMatchObject({ ok: false, code: 'asset-conflict' })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().importAssetsAtTarget({
      projectId: 'another-course-project',
      documentRevision: target.documentRevision,
    }, [image('arch2-wrong-project', 31)])).toMatchObject({
      ok: false,
      code: 'project-mismatch',
    })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    useEditorStore.getState().renameProject('ARCH-2 intervening edit')
    await settleCourse()
    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().importAssetsAtTarget(
      target,
      [image('arch2-stale-revision', 41)],
    )).toMatchObject({ ok: false, code: 'revision-conflict' })
    expect(authoritativeWriteSnapshot()).toEqual(before)
  })

  it('keeps legacy snapshot stacks aligned around a delta frame', async () => {
    await loadFixture('slide-heavy')
    useEditorStore.getState().activateCourseLocation('slide-location-intro')
    await settleCourse()
    const originalTitle = activeProject().title
    // 2.0 起 renderer 不再维护资源快照栈（courseViewPatch / projectCourseDocument 恒清空），
    // 历史深度只能来自主进程 DocumentSession。两者一起断言：renderer 栈恒为空（delta 帧不落
    // 整份资源快照），而重命名与 delta 帧各推进恰好一个正式历史步。
    const emptyResourceDepths = {
      sidecarPast: 0,
      sidecarFuture: 0,
      componentPast: 0,
      componentFuture: 0,
    }
    expect(resourceSnapshotDepths()).toEqual(emptyResourceDepths)

    useEditorStore.getState().renameProject('ARCH-2 legacy before delta')
    await settleCourse()
    expect(formalCourse(host).undoDepth).toBe(1)
    expect(resourceSnapshotDepths()).toEqual(emptyResourceDepths)

    const target = useEditorStore.getState().captureMediaLibraryImportTarget()
    if (!target) throw new Error('Expected a captured media-library target')
    const imported = image('arch2-legacy-delta-asset', 51)
    expect(useEditorStore.getState().importAssetsAtTarget(target, [imported]))
      .toMatchObject({ ok: true, status: 'imported' })
    await settleCourse()
    expect(formalCourse(host).undoDepth).toBe(2)
    expect(resourceSnapshotDepths()).toEqual(emptyResourceDepths)

    useEditorStore.getState().renameProject('ARCH-2 legacy after delta')
    await settleCourse()
    expect(formalCourse(host).undoDepth).toBe(3)
    expect(resourceSnapshotDepths()).toEqual(emptyResourceDepths)

    await undoCourse(host)
    expect(activeProject().title).toBe('ARCH-2 legacy before delta')
    expect(activeProject().assets[imported.meta.id]).toEqual(imported.meta)
    expect(formalCourse(host)).toMatchObject({ undoDepth: 2, redoDepth: 1 })
    expect(resourceSnapshotDepths()).toEqual(emptyResourceDepths)

    await undoCourse(host)
    expect(activeProject().title).toBe('ARCH-2 legacy before delta')
    expect(activeProject().assets[imported.meta.id]).toBeUndefined()
    expect(selectMediaAssetFiles(useEditorStore.getState())[imported.meta.id]).toBeUndefined()
    expect(formalCourse(host)).toMatchObject({ undoDepth: 1, redoDepth: 2 })

    await undoCourse(host)
    expect(activeProject().title).toBe(originalTitle)
    expect(formalCourse(host)).toMatchObject({ undoDepth: 0, redoDepth: 3 })
    expect(resourceSnapshotDepths()).toEqual(emptyResourceDepths)

    await redoCourse(host)
    await redoCourse(host)
    expect(activeProject().assets[imported.meta.id]).toEqual(imported.meta)
    expect(selectMediaAssetFiles(useEditorStore.getState())[imported.meta.id])
      .toEqual(imported.bytes)
    expect(formalCourse(host)).toMatchObject({ undoDepth: 2, redoDepth: 1 })

    await redoCourse(host)
    expect(activeProject().title).toBe('ARCH-2 legacy after delta')
    expect(formalCourse(host)).toMatchObject({ undoDepth: 3, redoDepth: 0 })
    expect(resourceSnapshotDepths()).toEqual(emptyResourceDepths)
  })

  it('rejects the reserved __proto__ asset ID with a clear reason and writes nothing', async () => {
    await loadFixture('slide-heavy')
    await settleCourse()
    const target = useEditorStore.getState().captureMediaLibraryImportTarget()
    if (!target) throw new Error('Expected a captured media-library target')
    const before = structuredClone(activeProject())

    const result = useEditorStore.getState().importAssetsAtTarget(target, [image('__proto__', 61)])
    expect(result).toMatchObject({ ok: false, code: 'invalid-asset' })
    if (result.ok) throw new Error('expected rejection')
    expect(result.reason).toContain('保留名称')
    await settleCourse()
    expect(activeProject()).toEqual(before)
    expect(Object.hasOwn(selectMediaAssetFiles(useEditorStore.getState()), '__proto__')).toBe(false)
  })

  it('fails closed on a project with missing referenced asset bytes and keeps Published reads side-effect free', async () => {
    // 2.0 有意删除了 1.x 的"打开损坏工程再修复素材"路径：V9 archive 合同在
    // DocumentSession.create 之前就拒绝"声明了字节却没有字节"的素材
    // (src/core/drivers/codecs/courseProjectArchive.ts:354)，诊断账本也把
    // asset-bytes-missing 标为 archive-shadowed
    // (src/shared/courseProjectValidationDiagnostics.ts:94-98)。原用例的"修复"意图
    // 因此改述为失败关闭：坏工程不得被打开，也不得产生任何正式文档写入。
    const source = fixture('slide-heavy')
    const referencedAssetId = 'slide-hero'
    const referencedBytes = source.assetFiles[referencedAssetId]?.slice()
    if (!referencedBytes) throw new Error('Fixture asset is incomplete')
    const filesWithoutReferencedAsset = Object.fromEntries(
      Object.entries(source.assetFiles)
        .filter(([assetId]) => assetId !== referencedAssetId)
        .map(([assetId, bytes]) => [assetId, bytes.slice()]),
    )

    const activeBefore = useEditorStore.getState().courseDocument.documentId
    await expect(loadFixture('slide-heavy', filesWithoutReferencedAsset))
      .rejects.toThrow(/素材“slide-hero\.png”缺少二进制内容/)
    expect(useEditorStore.getState().courseDocument.documentId).toBe(activeBefore)

    const healthy = await loadFixture('slide-heavy')
    const referencedMeta = healthy.project.assets[referencedAssetId]
    if (!referencedMeta) throw new Error('Fixture asset is incomplete')
    useEditorStore.getState().activateCourseLocation('slide-location-intro')
    await settleCourse()
    expect(selectMediaAssetFiles(useEditorStore.getState())[referencedAssetId])
      .toEqual(referencedBytes)

    const beforeReadEndpoints = authoritativeWriteSnapshot()
    const state = useEditorStore.getState()
    const archiveBytes = createCourseProjectArchive({
      project: activeProject(),
      assetFiles: selectMediaAssetFiles(state),
      componentFiles: healthy.componentFiles,
    }, { mtime: FIXED_TIME })
    const reopened = openCourseProjectArchive(archiveBytes)
    expect(reopened.project.assets[referencedAssetId]).toEqual(referencedMeta)
    expect(reopened.assetFiles[referencedAssetId]).toEqual(referencedBytes)

    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: componentPackagesFromArchive(reopened.project, reopened.componentFiles),
    })
    expect(published.assets[referencedAssetId]?.url)
      .toMatch(/^data:image\/png;base64,/)
    expect(authoritativeWriteSnapshot()).toEqual(beforeReadEndpoints)
  })
})
