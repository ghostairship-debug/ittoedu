import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  componentPackagesFromArchive,
  componentPackagesToArchiveFiles,
} from '@/renderer/components/componentPackageStore'
import { isFlowEditorTransactionFrame } from '@/renderer/course/flowEditorSlice'
import { isSlideAuthoringTransactionFrame } from '@/renderer/course/slideEditorCommands'
import { isSpatialAuthoringTransactionFrame } from '@/renderer/course/spatialAuthoringHistory'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '@/renderer/project/courseProjectArchive'
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
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import type {
  ComponentPackageData,
  ComponentScope,
} from '@/shared/componentTypes'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  FlowBlock,
  LayerItem,
} from '@/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'

const FIXTURE_ROOT = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
)
const FIXED_TIME = '2026-08-24T06:00:00.000Z'
const PACKAGE_ID = 'com.ittoedu.baseline.evidence-panel'
const BASE_VERSION = '4.0.0'
const REPLACEMENT_VERSION = '4.1.0'

type FixtureId = 'slide-heavy' | 'flow-heavy' | 'mixed-spatial'

function fixture(id: FixtureId): CourseProjectArchiveData {
  return openCourseProjectArchive(new Uint8Array(readFileSync(
    join(FIXTURE_ROOT, `${id}.h5lesson`),
  )))
}

function nestRepresentativeFlowComponent(
  project: CourseProjectDocument,
): CourseProjectDocument {
  const next = structuredClone(project)
  const surface = next.surfaces.find((candidate) => candidate.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('Expected a Flow surface')
  const componentIndex = surface.blocks.findIndex((block) => (
    block.type === 'component' && block.component.packageId === PACKAGE_ID
  ))
  const section = surface.blocks.find((block) => block.id === 'flow-section')
  if (componentIndex < 0 || !section || section.type !== 'section') {
    throw new Error('Representative Flow fixture is missing its component or section')
  }
  const [component] = surface.blocks.splice(componentIndex, 1)
  if (!component || component.type !== 'component') {
    throw new Error('Expected the representative Flow component block')
  }
  section.blocks.push(component)
  return courseProjectDocumentSchema.parse(next)
}

function loadFixture(id: FixtureId): CourseProjectArchiveData {
  const archive = fixture(id)
  const project = id === 'flow-heavy'
    ? nestRepresentativeFlowComponent(archive.project)
    : archive.project
  const loaded = { ...archive, project }
  useEditorStore.getState().loadCourseProject(
    project,
    null,
    archive.assetFiles,
    componentPackagesFromArchive(project, archive.componentFiles),
  )
  return loaded
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function clonePackageCore(packageData: ComponentPackageData): ComponentPackageData {
  return {
    manifest: structuredClone(packageData.manifest),
    runtimeSource: packageData.runtimeSource,
    files: Object.fromEntries(
      Object.entries(packageData.files).map(([path, bytes]) => [
        path,
        Uint8Array.from(bytes),
      ]),
    ),
    ...(packageData.contentSha256 === undefined
      ? {}
      : { contentSha256: packageData.contentSha256 }),
    ...(packageData.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: packageData.thumbnailUrl }),
    ...(packageData.provenance === undefined
      ? {}
      : { provenance: { ...packageData.provenance } }),
  }
}

function replacementPackage(
  current: ComponentPackageData,
  options: {
    supportedScopes?: ComponentScope[]
  } = {},
): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
    ...structuredClone(current.manifest),
    name: '基线证据卡 4.1',
    version: REPLACEMENT_VERSION,
    description: '用于 ARCH-2 跨 Surface 组件替换事务的 Component API 4 包。',
    supportedScopes: options.supportedScopes
      ? [...options.supportedScopes]
      : [...current.manifest.supportedScopes],
    defaultProps: {
      ...structuredClone(current.manifest.defaultProps),
      body: '组件包、实例与历史资源增量保持一致。',
    },
  }
  const runtimeSource = `${current.runtimeSource}\n/* ARCH-2 replacement ${REPLACEMENT_VERSION} */\n`
  const files = Object.fromEntries(
    Object.entries(current.files).map(([path, bytes]) => [
      path,
      Uint8Array.from(bytes),
    ]),
  )
  files['manifest.json'] = new TextEncoder().encode(
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  files[manifest.entry] = new TextEncoder().encode(runtimeSource)
  return {
    manifest,
    runtimeSource,
    files,
    contentSha256: componentContentSha256(files),
  }
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, bytes]) => [path, [...bytes]]),
  )
}

function packageSnapshot(packageData: ComponentPackageData | undefined) {
  if (!packageData) return null
  return {
    manifest: structuredClone(packageData.manifest),
    runtimeSource: packageData.runtimeSource,
    files: byteMap(packageData.files),
    contentSha256: packageData.contentSha256,
    thumbnailUrl: packageData.thumbnailUrl,
    provenance: packageData.provenance
      ? { ...packageData.provenance }
      : undefined,
  }
}

function componentResourceSnapshot() {
  return Object.fromEntries(
    Object.entries(useEditorStore.getState().componentPackages)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([packageId, packageData]) => [packageId, packageSnapshot(packageData)]),
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

function lastComponentTransactionChange() {
  const active = activeHistory()
  const entry = active.history.past.at(-1)
  const transaction = active.kind === 'slide'
    ? Boolean(entry && isSlideAuthoringTransactionFrame(entry))
    : active.kind === 'flow'
      ? Boolean(entry && isFlowEditorTransactionFrame(entry))
      : Boolean(entry && isSpatialAuthoringTransactionFrame(entry))
  expect(transaction).toBe(true)
  if (!entry || !('kind' in entry) || entry.kind !== 'editor-transaction') {
    throw new Error('Expected an editor transaction history frame')
  }
  expect(entry.resourceChanges.assetFileChanges).toBeUndefined()
  expect(entry.resourceChanges.componentPackageChanges).toHaveLength(1)
  const change = entry.resourceChanges.componentPackageChanges?.[0]
  if (!change) throw new Error('Expected one component package resource delta')
  return change
}

interface ComponentReferenceSnapshot {
  carrier: 'global-layer' | 'surface-layer' | 'slide-scene' | 'spatial-world' | 'flow-block'
  id: string
  surfaceId: string | null
  sceneId: string | null
  depth: number | null
  packageId: string
  version: string
}

function collectComponentReferences(
  project: CourseProjectDocument,
): ComponentReferenceSnapshot[] {
  const references: ComponentReferenceSnapshot[] = []
  const appendLayer = (
    item: LayerItem,
    context: Omit<ComponentReferenceSnapshot, 'id' | 'packageId' | 'version'>,
  ) => {
    if (item.kind !== 'component' || item.component.packageId !== PACKAGE_ID) return
    references.push({
      ...context,
      id: item.layerItemId,
      packageId: item.component.packageId,
      version: item.component.version,
    })
  }
  const appendBlocks = (
    blocks: readonly FlowBlock[],
    surfaceId: string,
    depth: number,
  ) => {
    for (const block of blocks) {
      if (block.type === 'section') appendBlocks(block.blocks, surfaceId, depth + 1)
      else if (block.type === 'component' && block.component.packageId === PACKAGE_ID) {
        references.push({
          carrier: 'flow-block',
          id: block.id,
          surfaceId,
          sceneId: null,
          depth,
          packageId: block.component.packageId,
          version: block.component.version,
        })
      }
    }
  }

  project.globalLayerItems.forEach((entry) => appendLayer(entry.item, {
    carrier: 'global-layer',
    surfaceId: null,
    sceneId: null,
    depth: null,
  }))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => appendLayer(entry.item, {
      carrier: 'surface-layer',
      surfaceId: surface.id,
      sceneId: null,
      depth: null,
    }))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach((item) => appendLayer(item, {
        carrier: 'slide-scene',
        surfaceId: surface.id,
        sceneId: scene.id,
        depth: null,
      })))
    } else if (surface.type === 'flow') {
      appendBlocks(surface.blocks, surface.id, 0)
    } else {
      surface.world.layerItems.forEach((item) => appendLayer(item, {
        carrier: 'spatial-world',
        surfaceId: surface.id,
        sceneId: null,
        depth: null,
      }))
    }
  }
  return references.sort((left, right) => left.id.localeCompare(right.id))
}

function retargetReferencesForComparison(
  project: CourseProjectDocument,
  version: string,
): void {
  const retargetLayer = (item: LayerItem) => {
    if (item.kind === 'component' && item.component.packageId === PACKAGE_ID) {
      item.component.version = version
    }
  }
  const retargetBlocks = (blocks: FlowBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'section') retargetBlocks(block.blocks)
      else if (block.type === 'component' && block.component.packageId === PACKAGE_ID) {
        block.component.version = version
      }
    }
  }
  project.globalLayerItems.forEach((entry) => retargetLayer(entry.item))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => retargetLayer(entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach(retargetLayer))
    } else if (surface.type === 'flow') {
      retargetBlocks(surface.blocks)
    } else {
      surface.world.layerItems.forEach(retargetLayer)
    }
  }
}

function projectWithoutReplacementFields(
  project: CourseProjectDocument,
  baseline: CourseProjectDocument,
) {
  const clone = structuredClone(project)
  clone.revision = baseline.revision
  clone.updatedAt = baseline.updatedAt
  clone.componentPackages[PACKAGE_ID] = structuredClone(
    baseline.componentPackages[PACKAGE_ID]!,
  )
  retargetReferencesForComparison(clone, BASE_VERSION)
  return clone
}

function sessionStableShape() {
  const session = useEditorStore.getState().courseAuthoringSession
  if (!session) throw new Error('Expected a Course authoring session')
  return {
    locationId: session.token.locationId,
    surfaceType: session.token.surfaceType,
    itemIds: [...session.itemIds],
  }
}

function expectFrozenCourseSession() {
  const session = useEditorStore.getState().courseAuthoringSession
  if (!session) throw new Error('Expected a Course authoring session')
  expect(Object.isFrozen(session)).toBe(true)
  expect(Object.isFrozen(session.token)).toBe(true)
  expect(Object.isFrozen(session.itemIds)).toBe(true)
  return session
}

function authoritativeWriteSnapshot() {
  const state = useEditorStore.getState()
  const active = activeHistory()
  return {
    project: structuredClone(activeProject()),
    derivedProject: structuredClone(selectActiveCourseProjectDocument(state)!),
    assetFiles: byteMap(selectMediaAssetFiles(state)),
    componentPackages: componentResourceSnapshot(),
    activeHistory: structuredClone(active.history),
    sidecarPast: state.courseAssetSidecarPast.map((sidecar) => byteMap(sidecar.files)),
    sidecarFuture: state.courseAssetSidecarFuture.map((sidecar) => byteMap(sidecar.files)),
    componentPast: structuredClone(state.courseComponentPackagesPast),
    componentFuture: structuredClone(state.courseComponentPackagesFuture),
    selection: selectionSnapshot(),
    courseAuthoringSession: structuredClone(state.courseAuthoringSession),
    dirty: state.dirty,
    activeTab: state.activeTab,
    statusMessage: state.statusMessage,
    errorMessage: state.errorMessage,
  }
}

function prepareSurface(id: FixtureId) {
  loadFixture(id)
  if (id === 'slide-heavy') {
    useEditorStore.getState().activateCourseLocation('slide-location-practice')
    useEditorStore.getState().selectNode('slide-practice-component')
    return useEditorStore.getState().captureComponentPackageReplacementTarget(PACKAGE_ID)
  }
  if (id === 'flow-heavy') {
    useEditorStore.getState().activateCourseLocation('flow-location-component')
    return useEditorStore.getState().captureComponentPackageReplacementTarget(PACKAGE_ID)
  }

  // Package replacement is project-scoped. A target captured on the Slide
  // location may commit to the Spatial history that is current on completion.
  const target = useEditorStore.getState()
    .captureComponentPackageReplacementTarget(PACKAGE_ID)
  useEditorStore.getState().activateCourseLocation('mixed-location-spatial-detail')
  useEditorStore.getState().selectNode('mixed-spatial-component')
  return target
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('ARCH-2 Course component package replacement vertical slice', () => {
  it.each([
    ['slide-heavy', 'slide'] as const,
    ['flow-heavy', 'flow'] as const,
    ['mixed-spatial', 'spatial'] as const,
  ])('commits one package delta to the current %s Surface history without full snapshots', (fixtureId, expectedKind) => {
    const target = prepareSurface(fixtureId)
    if (!target) throw new Error('Expected a captured component replacement target')
    expect(activeHistory().kind).toBe(expectedKind)

    const beforeProject = structuredClone(activeProject())
    const beforeReferences = collectComponentReferences(beforeProject)
    expect(beforeReferences.length).toBeGreaterThan(0)
    expect(beforeReferences.every((reference) => reference.version === BASE_VERSION)).toBe(true)
    if (fixtureId === 'flow-heavy') {
      expect(beforeReferences).toEqual([expect.objectContaining({
        carrier: 'flow-block',
        id: 'flow-component',
        depth: 1,
      })])
    }
    const beforePackage = packageSnapshot(
      useEditorStore.getState().componentPackages[PACKAGE_ID],
    )
    const beforeSelection = selectionSnapshot()
    const historySelection = expectedKind === 'spatial'
      ? {
          ...beforeSelection,
          selectedNodeId: null,
          selectedNodeIds: [],
          spatial: beforeSelection.spatial
            ? { ...beforeSelection.spatial, selectionIds: [] }
            : null,
        }
      : beforeSelection
    const beforeSessionShape = sessionStableShape()
    const beforeCourseSession = expectFrozenCourseSession()
    const beforeHistoryDepth = activeHistory().history.past.length
    const beforeResourceDepths = resourceSnapshotDepths()
    const replacement = replacementPackage(
      useEditorStore.getState().componentPackages[PACKAGE_ID]!,
    )

    const result = useEditorStore.getState().replaceComponentPackageAtTarget(
      target,
      replacement,
    )
    expect(result).toMatchObject({
      ok: true,
      status: 'replaced',
      feedback: {
        kind: 'component-package-replaced',
        packageId: PACKAGE_ID,
        previousVersion: BASE_VERSION,
        replacementVersion: REPLACEMENT_VERSION,
      },
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.feedback.affectedInstances.map((reference) => reference.instanceId).sort())
      .toEqual(beforeReferences.map((reference) => reference.id).sort())

    const afterProject = structuredClone(activeProject())
    const afterReferences = collectComponentReferences(afterProject)
    expect(afterReferences.map(({ version: _version, ...reference }) => reference))
      .toEqual(beforeReferences.map(({ version: _version, ...reference }) => reference))
    expect(afterReferences.every((reference) => (
      reference.packageId === PACKAGE_ID && reference.version === REPLACEMENT_VERSION
    ))).toBe(true)
    expect(projectWithoutReplacementFields(afterProject, beforeProject))
      .toEqual(beforeProject)
    expect(afterProject.revision).toBe(beforeProject.revision + 1)
    expect(afterProject.componentPackages[PACKAGE_ID]).toEqual({
      packageId: PACKAGE_ID,
      version: REPLACEMENT_VERSION,
      name: replacement.manifest.name,
      manifestPath: `components/${PACKAGE_ID}@${REPLACEMENT_VERSION}/manifest.json`,
      runtimePath: `components/${PACKAGE_ID}@${REPLACEMENT_VERSION}/${replacement.manifest.entry}`,
      thumbnailPath: `components/${PACKAGE_ID}@${REPLACEMENT_VERSION}/${replacement.manifest.thumbnail}`,
      contentSha256: replacement.contentSha256,
    })
    expect(packageSnapshot(useEditorStore.getState().componentPackages[PACKAGE_ID]))
      .toEqual(packageSnapshot(replacement))
    expect(activeHistory().history.past).toHaveLength(beforeHistoryDepth + 1)
    const change = lastComponentTransactionChange()
    expect(change.packageId).toBe(PACKAGE_ID)
    expect(packageSnapshot(change.before)).toEqual(beforePackage)
    expect(packageSnapshot(change.after)).toEqual(packageSnapshot(replacement))
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    expect(selectionSnapshot()).toEqual(beforeSelection)
    expect(sessionStableShape()).toEqual(beforeSessionShape)
    const committedSession = expectFrozenCourseSession()
    expect(committedSession.token.revision).toBe(afterProject.revision)
    expect(committedSession.token.generation).toBe(beforeCourseSession.token.generation)

    useEditorStore.getState().undo()
    expect(activeProject()).toEqual(beforeProject)
    expect(packageSnapshot(useEditorStore.getState().componentPackages[PACKAGE_ID]))
      .toEqual(beforePackage)
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    expect(selectionSnapshot()).toEqual(historySelection)
    expect(sessionStableShape()).toEqual(beforeSessionShape)
    const undoneSession = expectFrozenCourseSession()
    expect(undoneSession.token.revision).toBe(beforeProject.revision)
    expect(undoneSession.token.generation).toBeGreaterThan(
      committedSession.token.generation,
    )

    useEditorStore.getState().redo()
    expect(activeProject()).toEqual(afterProject)
    expect(packageSnapshot(useEditorStore.getState().componentPackages[PACKAGE_ID]))
      .toEqual(packageSnapshot(replacement))
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    expect(selectionSnapshot()).toEqual(historySelection)
    expect(sessionStableShape()).toEqual(beforeSessionShape)
    const redoneSession = expectFrozenCourseSession()
    expect(redoneSession.token.revision).toBe(afterProject.revision)
    expect(redoneSession.token.generation).toBeGreaterThan(
      undoneSession.token.generation,
    )
  })

  it('keeps no-op, incompatible scope, project mismatch and stale revision as zero-write outcomes', () => {
    loadFixture('slide-heavy')
    useEditorStore.getState().activateCourseLocation('slide-location-practice')
    const target = useEditorStore.getState()
      .captureComponentPackageReplacementTarget(PACKAGE_ID)
    if (!target) throw new Error('Expected a captured component replacement target')
    const currentPackage = useEditorStore.getState().componentPackages[PACKAGE_ID]
    if (!currentPackage) throw new Error('Expected the representative component package')

    let before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceComponentPackageAtTarget(
      target,
      clonePackageCore(currentPackage),
    )).toMatchObject({
      ok: true,
      status: 'unchanged',
      feedback: {
        packageId: PACKAGE_ID,
        previousVersion: BASE_VERSION,
        replacementVersion: BASE_VERSION,
      },
    })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceComponentPackageAtTarget(
      target,
      replacementPackage(currentPackage, { supportedScopes: ['global'] }),
    )).toMatchObject({ ok: false, code: 'unsupported-scope' })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceComponentPackageAtTarget({
      ...target,
      projectId: 'another-course-project',
    }, replacementPackage(currentPackage))).toMatchObject({
      ok: false,
      code: 'project-mismatch',
    })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    useEditorStore.getState().renameProject('ARCH-2 intervening component edit')
    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceComponentPackageAtTarget(
      target,
      replacementPackage(currentPackage),
    )).toMatchObject({ ok: false, code: 'revision-conflict' })
    expect(authoritativeWriteSnapshot()).toEqual(before)
  })

  it('saves and reopens replacement files, then publishes API 4 without mutating authoring state', () => {
    loadFixture('flow-heavy')
    useEditorStore.getState().activateCourseLocation('flow-location-component')
    const target = useEditorStore.getState()
      .captureComponentPackageReplacementTarget(PACKAGE_ID)
    if (!target) throw new Error('Expected a captured component replacement target')
    const replacement = replacementPackage(
      useEditorStore.getState().componentPackages[PACKAGE_ID]!,
    )
    expect(useEditorStore.getState().replaceComponentPackageAtTarget(target, replacement))
      .toMatchObject({ ok: true, status: 'replaced' })

    const beforeReadEndpoints = authoritativeWriteSnapshot()
    const state = useEditorStore.getState()
    const componentFiles = componentPackagesToArchiveFiles(state.componentPackages)
    expect(Object.keys(componentFiles)).toEqual([
      `${PACKAGE_ID}@${REPLACEMENT_VERSION}`,
    ])
    const bytes = createCourseProjectArchive({
      project: activeProject(),
      assetFiles: selectMediaAssetFiles(state),
      componentFiles,
    }, { mtime: FIXED_TIME })
    const reopened = openCourseProjectArchive(bytes)
    expect(reopened.project).toEqual(activeProject())
    expect(Object.keys(reopened.componentFiles)).toEqual([
      `${PACKAGE_ID}@${REPLACEMENT_VERSION}`,
    ])
    expect(byteMap(reopened.componentFiles[`${PACKAGE_ID}@${REPLACEMENT_VERSION}`]!))
      .toEqual(byteMap(replacement.files))
    const reopenedPackages = componentPackagesFromArchive(
      reopened.project,
      reopened.componentFiles,
    )
    expect(packageSnapshot(reopenedPackages[PACKAGE_ID]))
      .toEqual(packageSnapshot(replacement))

    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: reopenedPackages,
    })
    expect(publishedCourseV2Schema.parse(published)).toEqual(published)
    const publishedKey = `${PACKAGE_ID}@${REPLACEMENT_VERSION}`
    expect(Object.keys(published.components)).toEqual([publishedKey])
    expect(published.components[publishedKey]).toMatchObject({
      id: PACKAGE_ID,
      version: REPLACEMENT_VERSION,
      apiVersion: 4,
      scopes: ['scene', 'global'],
    })
    const flow = published.surfaces.find((surface) => surface.type === 'flow')
    if (!flow || flow.type !== 'flow') throw new Error('Expected published Flow surface')
    const section = flow.blocks.find((block) => block.id === 'flow-section')
    if (!section || section.type !== 'section') {
      throw new Error('Expected the published recursive Flow section')
    }
    expect(section.blocks.find((block) => block.id === 'flow-component'))
      .toMatchObject({
        type: 'component',
        component: { packageId: PACKAGE_ID, version: REPLACEMENT_VERSION },
      })
    expect(authoritativeWriteSnapshot()).toEqual(beforeReadEndpoints)
  })
})
