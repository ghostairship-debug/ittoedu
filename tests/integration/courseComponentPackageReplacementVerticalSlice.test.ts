import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  componentPackagesFromArchive,
  componentPackagesToArchiveFiles,
} from '@/renderer/components/componentPackageStore'
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
import type { DocumentModel } from '@/shared/workbench/document'

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

let host: TriageCourseHost

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

async function loadFixture(id: FixtureId): Promise<CourseProjectArchiveData> {
  const archive = fixture(id)
  const project = id === 'flow-heavy'
    ? nestRepresentativeFlowComponent(archive.project)
    : archive.project
  const loaded = { ...archive, project }
  await projectCourse(
    host,
    project,
    archive.assetFiles,
    componentPackagesFromArchive(project, archive.componentFiles),
  )
  await settleCourse()
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

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right) return left === right
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function sameByteMap(
  left: Readonly<Record<string, Uint8Array>> | undefined,
  right: Readonly<Record<string, Uint8Array>> | undefined,
): boolean {
  if (!left || !right) return left === right
  const paths = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const path of paths) {
    if (!sameBytes(left[path], right[path])) return false
  }
  return true
}

function courseResources(model: DocumentModel): Extract<DocumentModel, { kind: 'course-v9' }>['resources'] {
  if (model.kind !== 'course-v9') throw new Error('Expected a Course Project V9 document')
  return model.resources
}

/** Formal asset ids whose bytes differ between two committed document models. */
function changedAssetIds(before: DocumentModel, after: DocumentModel): string[] {
  const beforeAssets = courseResources(before).assets
  const afterAssets = courseResources(after).assets
  return [...new Set([...Object.keys(beforeAssets), ...Object.keys(afterAssets)])]
    .filter((assetId) => !sameBytes(beforeAssets[assetId], afterAssets[assetId]))
    .sort()
}

/** Formal component package keys whose files differ between two committed document models. */
function changedComponentPackageKeys(before: DocumentModel, after: DocumentModel): string[] {
  const beforePackages = courseResources(before).components
  const afterPackages = courseResources(after).components
  return [...new Set([...Object.keys(beforePackages), ...Object.keys(afterPackages)])]
    .filter((key) => !sameByteMap(beforePackages[key], afterPackages[key]))
    .sort()
}

/** Package ids (key without the version suffix) whose formal files differ. */
function changedComponentPackageIds(before: DocumentModel, after: DocumentModel): string[] {
  return [...new Set(changedComponentPackageKeys(before, after).map(
    (key) => key.slice(0, key.lastIndexOf('@')),
  ))].sort()
}

/** Committed archive keys of one package id, e.g. `com.example.card@4.1.0`. */
function packageKeysFor(model: DocumentModel, packageId = PACKAGE_ID): string[] {
  return Object.keys(courseResources(model).components)
    .filter((key) => key.slice(0, key.lastIndexOf('@')) === packageId)
    .sort()
}

/** Decode one committed model's component package through the product's own archive reader. */
function packageSnapshotFromModel(model: DocumentModel, packageId = PACKAGE_ID) {
  if (model.kind !== 'course-v9') throw new Error('Expected a Course Project V9 document')
  return packageSnapshot(
    componentPackagesFromArchive(model.project, model.resources.components)[packageId],
  )
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
  const committed = formalCourse(host)
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
    formal: {
      revision: committed.revision,
      undoDepth: committed.undoDepth,
      redoDepth: committed.redoDepth,
      model: structuredClone(committed.model),
    },
    dirty: state.dirty,
    activeTab: state.activeTab,
    statusMessage: state.statusMessage,
    errorMessage: state.errorMessage,
  }
}

async function prepareSurface(id: FixtureId) {
  await loadFixture(id)
  if (id === 'slide-heavy') {
    useEditorStore.getState().activateCourseLocation('slide-location-practice')
    useEditorStore.getState().selectNode('slide-practice-component')
    await settleCourse()
    return useEditorStore.getState().captureComponentPackageReplacementTarget(PACKAGE_ID)
  }
  if (id === 'flow-heavy') {
    useEditorStore.getState().activateCourseLocation('flow-location-component')
    await settleCourse()
    return useEditorStore.getState().captureComponentPackageReplacementTarget(PACKAGE_ID)
  }

  // Package replacement is project-scoped. A target captured on the Slide
  // location may commit to the Spatial history that is current on completion.
  const target = useEditorStore.getState()
    .captureComponentPackageReplacementTarget(PACKAGE_ID)
  useEditorStore.getState().activateCourseLocation('mixed-location-spatial-detail')
  useEditorStore.getState().selectNode('mixed-spatial-component')
  await settleCourse()
  return target
}

beforeEach(async () => {
  host = await bootTriageCourseHost()
})

describe('ARCH-2 Course component package replacement vertical slice', () => {
  it.each([
    ['slide-heavy', 'slide'] as const,
    ['flow-heavy', 'flow'] as const,
    ['mixed-spatial', 'spatial'] as const,
  ])('commits one package delta to the current %s Surface history without full snapshots', async (fixtureId, expectedKind) => {
    const target = await prepareSurface(fixtureId)
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
    const beforeSessionShape = sessionStableShape()
    const beforeCourseSession = expectFrozenCourseSession()
    const beforeHistoryDepth = formalCourse(host).undoDepth
    const beforeModel = structuredClone(formalCourse(host).model)
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
    await settleCourse()

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
    // The formal document session owns the history: exactly one new step, and
    // that step carries only the component package delta, never asset bytes.
    const committedSnapshot = formalCourse(host)
    expect(committedSnapshot.undoDepth).toBe(beforeHistoryDepth + 1)
    const afterModel = structuredClone(committedSnapshot.model)
    expect(changedAssetIds(beforeModel, afterModel)).toEqual([])
    // Exactly one package delta: the baseline key disappears, the replacement key appears.
    expect(changedComponentPackageKeys(beforeModel, afterModel))
      .toEqual([`${PACKAGE_ID}@${BASE_VERSION}`, `${PACKAGE_ID}@${REPLACEMENT_VERSION}`].sort())
    expect(changedComponentPackageIds(beforeModel, afterModel)).toEqual([PACKAGE_ID])
    expect(packageKeysFor(beforeModel)).toEqual([`${PACKAGE_ID}@${BASE_VERSION}`])
    expect(packageKeysFor(afterModel)).toEqual([`${PACKAGE_ID}@${REPLACEMENT_VERSION}`])
    expect(packageSnapshotFromModel(beforeModel)).toEqual(beforePackage)
    expect(packageSnapshotFromModel(afterModel)).toEqual(packageSnapshot(replacement))
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    expect(selectionSnapshot()).toEqual(beforeSelection)
    expect(sessionStableShape()).toEqual(beforeSessionShape)
    const committedSession = expectFrozenCourseSession()
    expect(committedSession.token.revision).toBe(afterProject.revision)
    expect(committedSession.token.generation).toBe(beforeCourseSession.token.generation)

    await undoCourse(host)
    await settleCourse()
    expect(projectBody(activeProject())).toEqual(projectBody(beforeProject))
    expect(packageSnapshot(useEditorStore.getState().componentPackages[PACKAGE_ID]))
      .toEqual(beforePackage)
    expect(formalCourse(host).undoDepth).toBe(beforeHistoryDepth)
    expect(formalCourse(host).redoDepth).toBe(1)
    // Undo restores content; the document revision keeps moving forward.
    expect(formalCourse(host).revision).toBeGreaterThan(committedSnapshot.revision)
    const undoneRevision = formalCourse(host).revision
    expect(packageSnapshotFromModel(formalCourse(host).model)).toEqual(beforePackage)
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    // View state lives outside the document: `CourseDocumentView.selection` is
    // not part of DocumentModel, and both `spatialAuthoringSlice.undo` and
    // `CourseDocumentBridge.finishHistory` reset only transient editing state
    // (`editingTextNodeId`). The renderer therefore reconciles the selection
    // against the restored project and keeps a selection that is still valid,
    // instead of reverting it to the session-open snapshot as 1.x did when it
    // replaced the whole session state.
    expect(selectionSnapshot()).toEqual(beforeSelection)
    expect(selectSelectedNodeId(useEditorStore.getState()))
      .toBe(beforeSelection.selectedNodeId)
    expect(sessionStableShape()).toEqual(beforeSessionShape)
    const undoneSession = expectFrozenCourseSession()
    expect(undoneSession.token.revision).toBe(formalCourse(host).revision)
    expect(undoneSession.token.generation).toBeGreaterThan(
      committedSession.token.generation,
    )

    await redoCourse(host)
    await settleCourse()
    expect(projectBody(activeProject())).toEqual(projectBody(afterProject))
    expect(packageSnapshot(useEditorStore.getState().componentPackages[PACKAGE_ID]))
      .toEqual(packageSnapshot(replacement))
    expect(formalCourse(host).undoDepth).toBe(beforeHistoryDepth + 1)
    expect(formalCourse(host).redoDepth).toBe(0)
    expect(formalCourse(host).revision).toBeGreaterThan(undoneRevision)
    expect(packageSnapshotFromModel(formalCourse(host).model))
      .toEqual(packageSnapshot(replacement))
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    expect(selectionSnapshot()).toEqual(beforeSelection)
    expect(sessionStableShape()).toEqual(beforeSessionShape)
    const redoneSession = expectFrozenCourseSession()
    expect(redoneSession.token.revision).toBe(formalCourse(host).revision)
    expect(redoneSession.token.generation).toBeGreaterThan(
      undoneSession.token.generation,
    )
  })

  it('keeps no-op, incompatible scope, project mismatch and stale revision as zero-write outcomes', async () => {
    await loadFixture('slide-heavy')
    useEditorStore.getState().activateCourseLocation('slide-location-practice')
    await settleCourse()
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
    await settleCourse()
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceComponentPackageAtTarget(
      target,
      replacementPackage(currentPackage, { supportedScopes: ['global'] }),
    )).toMatchObject({ ok: false, code: 'unsupported-scope' })
    await settleCourse()
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceComponentPackageAtTarget({
      ...target,
      projectId: 'another-course-project',
    }, replacementPackage(currentPackage))).toMatchObject({
      ok: false,
      code: 'project-mismatch',
    })
    await settleCourse()
    expect(authoritativeWriteSnapshot()).toEqual(before)

    useEditorStore.getState().renameProject('ARCH-2 intervening component edit')
    await settleCourse()
    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceComponentPackageAtTarget(
      target,
      replacementPackage(currentPackage),
    )).toMatchObject({ ok: false, code: 'revision-conflict' })
    await settleCourse()
    expect(authoritativeWriteSnapshot()).toEqual(before)
  })

  it('saves and reopens replacement files, then publishes API 4 without mutating authoring state', async () => {
    await loadFixture('flow-heavy')
    useEditorStore.getState().activateCourseLocation('flow-location-component')
    await settleCourse()
    const target = useEditorStore.getState()
      .captureComponentPackageReplacementTarget(PACKAGE_ID)
    if (!target) throw new Error('Expected a captured component replacement target')
    const replacement = replacementPackage(
      useEditorStore.getState().componentPackages[PACKAGE_ID]!,
    )
    expect(useEditorStore.getState().replaceComponentPackageAtTarget(target, replacement))
      .toMatchObject({ ok: true, status: 'replaced' })
    await settleCourse()

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
