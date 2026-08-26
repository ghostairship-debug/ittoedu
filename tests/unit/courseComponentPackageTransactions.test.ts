import { describe, expect, it } from 'vitest'
import {
  applyEditorTransactionStep,
  createEditorTransactionStep,
} from '@/renderer/authoring/editorTransaction'
import {
  collectCourseComponentPackageUsage,
  planCourseComponentPackageDeletion,
  planCourseComponentPackageReplacement,
  type CourseComponentPackageReplacementPlanResult,
  type PlanCourseComponentPackageReplacementInput,
} from '@/renderer/components/courseComponentPackageTransactions'
import { componentArchiveRoot } from '@/renderer/project/archivePath'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import type {
  ComponentManifest,
  ComponentPackageData,
  ComponentScope,
} from '@/shared/componentTypes'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  ComponentLayerItem,
  CourseProjectDocument,
  FlowBlock,
} from '@/shared/courseProjectTypes'
import type { EmbeddedComponentPackageMeta } from '@/shared/projectTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const PACKAGE_ID = 'com.example.mixed-component'
const NOW = '2026-08-24T08:30:00.000Z'
const encoder = new TextEncoder()

function componentPackage(
  version: string,
  supportedScopes: ComponentScope[] = ['scene', 'global'],
  marker = version,
  packageId = PACKAGE_ID,
): ComponentPackageData {
  const manifest: ComponentManifest = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: packageId,
    name: 'Mixed Component',
    version,
    entry: 'runtime.js',
    thumbnail: 'thumbnail.png',
    defaultSize: { width: 360, height: 220 },
    minSize: { width: 120, height: 80 },
    preserveAspectRatio: true,
    assets: {},
    defaultProps: { label: 'default' },
    supportedScopes,
    renderMode: 'dom',
  }
  const runtimeSource = `window.CoursewareComponent.define({ marker: '${marker}' })`
  const files = {
    'manifest.json': encoder.encode(JSON.stringify(manifest)),
    'runtime.js': encoder.encode(runtimeSource),
    'thumbnail.png': new Uint8Array([1, version.length, marker.length]),
  }
  return {
    manifest,
    runtimeSource,
    files,
    contentSha256: componentContentSha256(files),
    provenance: {
      sha256: (version.startsWith('1') ? 'a' : 'b').repeat(64),
      importedAt: version.startsWith('1')
        ? '2026-08-20T00:00:00.000Z'
        : '2026-08-24T08:00:00.000Z',
      sourceLabel: version.startsWith('1') ? 'Initial catalog' : 'Updated catalog',
    },
  }
}

function embeddedMetadata(
  packageData: ComponentPackageData,
  authoring = false,
): EmbeddedComponentPackageMeta {
  const root = componentArchiveRoot(
    packageData.manifest.id,
    packageData.manifest.version,
  )
  return {
    packageId: packageData.manifest.id,
    version: packageData.manifest.version,
    name: packageData.manifest.name,
    manifestPath: `${root}/manifest.json`,
    runtimePath: `${root}/${packageData.manifest.entry}`,
    thumbnailPath: `${root}/${packageData.manifest.thumbnail}`,
    contentSha256: componentContentSha256(packageData.files),
    ...packageData.provenance,
    ...(authoring
      ? { editableCopy: true, sourcePackageId: 'com.example.original' }
      : {}),
  }
}

function componentLayer(
  id: string,
  version = '1.0.0',
  order = 1_000,
): ComponentLayerItem {
  return {
    kind: 'component',
    layerItemId: id,
    label: `Component ${id}`,
    frame: { mode: 'absolute', x: order, y: -order, width: 360, height: 220 },
    order,
    visible: true,
    locked: id === 'component-global',
    rotation: 7,
    opacity: 0.85,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    paperSpace: id === 'component-surface' ? 'paper' : 'viewport',
    component: { packageId: PACKAGE_ID, version },
    props: { id, nested: { score: order } },
    staticFallbackAssetId: 'component-fallback',
  }
}

function mixedProjectFixture(): {
  project: CourseProjectDocument
  currentPackage: ComponentPackageData
} {
  const fixture = listCourseProjectV9Fixtures().find((candidate) => candidate.id === 'mixed')
  if (!fixture) throw new Error('Missing Mixed fixture')
  const project = structuredClone(fixture.data.project)
  const currentPackage = componentPackage('1.0.0')
  project.assets['component-fallback'] = {
    id: 'component-fallback',
    filename: 'component-fallback.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/component-fallback.png',
    byteLength: 4,
    width: 2,
    height: 2,
  }
  project.componentPackages[PACKAGE_ID] = embeddedMetadata(currentPackage, true)
  project.globalLayerItems.push({
    item: componentLayer('component-global', '1.0.0', 1_000),
    visibility: { mode: 'all', locationIds: [] },
  })

  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  const flow = project.surfaces.find((surface) => surface.type === 'flow')
  const spatial = project.surfaces.find((surface) => surface.type === 'spatial-2d')
  if (!slide || slide.type !== 'slide' || !flow || flow.type !== 'flow'
    || !spatial || spatial.type !== 'spatial-2d') {
    throw new Error('Mixed fixture is incomplete')
  }
  slide.surfaceLayerItems.push({
    item: componentLayer('component-surface', '1.0.0', 1_001),
    visibility: { mode: 'include', locationIds: ['location-slide'] },
  })
  slide.scenes[0]!.layerItems.push(componentLayer('component-slide', '1.0.0', 1_002))
  flow.surfaceLayerItems.push({
    item: componentLayer('component-flow-overlay', '1.0.0', 1_003),
    visibility: { mode: 'all', locationIds: [] },
  })
  spatial.world.layerItems.push(componentLayer('component-spatial', '1.0.0', 1_004))
  flow.blocks.push({
    id: 'component-section-outer',
    type: 'section',
    title: 'Outer section',
    collapsedByDefault: false,
    blocks: [{
      id: 'component-section-inner',
      type: 'section',
      title: 'Inner section',
      collapsedByDefault: true,
      blocks: [{
        id: 'component-flow',
        type: 'component',
        component: { packageId: PACKAGE_ID, version: '1.0.0' },
        props: { prompt: 'Keep this', choices: ['A', 'B'] },
        staticFallbackAssetId: 'component-fallback',
        wrap: 'right',
      }],
    }],
  })
  return {
    project: courseProjectDocumentSchema.parse(project),
    currentPackage,
  }
}

function flowComponent(blocks: readonly FlowBlock[]): Extract<FlowBlock, { type: 'component' }> {
  for (const block of blocks) {
    if (block.type === 'component' && block.id === 'component-flow') return block
    if (block.type === 'section') {
      try {
        return flowComponent(block.blocks)
      } catch {
        // Search the next sibling.
      }
    }
  }
  throw new Error('Missing nested Flow component')
}

function componentCarriers(project: CourseProjectDocument): Map<string, ComponentLayerItem | Extract<FlowBlock, { type: 'component' }>> {
  const result = new Map<string, ComponentLayerItem | Extract<FlowBlock, { type: 'component' }>>()
  for (const entry of project.globalLayerItems) {
    if (entry.item.kind === 'component') result.set(entry.item.layerItemId, entry.item)
  }
  for (const surface of project.surfaces) {
    for (const entry of surface.surfaceLayerItems) {
      if (entry.item.kind === 'component') result.set(entry.item.layerItemId, entry.item)
    }
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        for (const item of scene.layerItems) {
          if (item.kind === 'component') result.set(item.layerItemId, item)
        }
      }
    } else if (surface.type === 'flow') {
      const block = flowComponent(surface.blocks)
      result.set(block.id, block)
    } else {
      for (const item of surface.world.layerItems) {
        if (item.kind === 'component') result.set(item.layerItemId, item)
      }
    }
  }
  return result
}

function inputFor(
  project: CourseProjectDocument,
  currentPackage: ComponentPackageData,
  replacement: ComponentPackageData,
): PlanCourseComponentPackageReplacementInput {
  return {
    project,
    componentPackages: { [PACKAGE_ID]: currentPackage },
    packageId: PACKAGE_ID,
    replacement,
    expected: { projectId: project.id, revision: project.revision },
    now: NOW,
  }
}

function deletionInputFor(
  project: CourseProjectDocument,
  currentPackage: ComponentPackageData,
) {
  return {
    project,
    componentPackages: { [PACKAGE_ID]: currentPackage },
    packageId: PACKAGE_ID,
    expected: { projectId: project.id, revision: project.revision },
    now: NOW,
  }
}

function removePackageReferences(project: CourseProjectDocument): void {
  const isTargetLayer = (item: ComponentLayerItem) => (
    item.component.packageId === PACKAGE_ID
  )
  const removeFlowBlocks = (blocks: FlowBlock[]): FlowBlock[] => {
    const remaining: FlowBlock[] = []
    for (const block of blocks) {
      if (block.type === 'component' && block.component.packageId === PACKAGE_ID) continue
      if (block.type === 'section') block.blocks = removeFlowBlocks(block.blocks)
      remaining.push(block)
    }
    return remaining
  }

  project.globalLayerItems = project.globalLayerItems.filter((entry) => (
    entry.item.kind !== 'component' || !isTargetLayer(entry.item)
  ))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems = surface.surfaceLayerItems.filter((entry) => (
      entry.item.kind !== 'component' || !isTargetLayer(entry.item)
    ))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => {
        scene.layerItems = scene.layerItems.filter((item) => (
          item.kind !== 'component' || !isTargetLayer(item)
        ))
      })
    } else if (surface.type === 'flow') {
      surface.blocks = removeFlowBlocks(surface.blocks)
    } else {
      surface.world.layerItems = surface.world.layerItems.filter((item) => (
        item.kind !== 'component' || !isTargetLayer(item)
      ))
    }
  }
}

function planned(result: CourseComponentPackageReplacementPlanResult) {
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`)
  if (result.status !== 'planned') throw new Error('Expected a transaction plan')
  return result.plan
}

function expectPackageValue(
  actual: ComponentPackageData,
  expected: ComponentPackageData,
): void {
  expect(actual.manifest).toEqual(expected.manifest)
  expect(actual.runtimeSource).toBe(expected.runtimeSource)
  expect(actual.contentSha256).toBe(expected.contentSha256)
  expect(actual.thumbnailUrl).toBe(expected.thumbnailUrl)
  expect(actual.provenance).toEqual(expected.provenance)
  expect(Object.keys(actual.files).sort()).toEqual(Object.keys(expected.files).sort())
  for (const [path, bytes] of Object.entries(expected.files)) {
    expect([...actual.files[path]!], path).toEqual([...bytes])
  }
}

describe('Course component package replacement transaction planner', () => {
  it('retargets every V9 carrier recursively and applies/inverts one detached package delta', () => {
    const { project, currentPackage } = mixedProjectFixture()
    const replacement = componentPackage('2.0.0')
    const beforeProject = structuredClone(project)
    const beforeCurrent = structuredClone(currentPackage)
    const beforeReplacement = structuredClone(replacement)
    const beforeCarriers = componentCarriers(project)

    const plan = planned(planCourseComponentPackageReplacement(inputFor(
      project,
      currentPackage,
      replacement,
    )))

    expect(project).toEqual(beforeProject)
    expectPackageValue(currentPackage, beforeCurrent)
    expectPackageValue(replacement, beforeReplacement)
    expect(plan.projectId).toBe(project.id)
    expect(plan.baseRevision).toBe(project.revision)
    expect(plan.nextDocument.revision).toBe(project.revision + 1)
    expect(plan.nextDocument.updatedAt).toBe(NOW)
    expect(plan.nextDocument.componentPackages[PACKAGE_ID]).toMatchObject({
      packageId: PACKAGE_ID,
      version: '2.0.0',
      contentSha256: replacement.contentSha256,
      sha256: replacement.provenance?.sha256,
      sourceLabel: 'Updated catalog',
      editableCopy: true,
      sourcePackageId: 'com.example.original',
    })
    expect(plan.feedback?.affectedInstances.map((reference) => reference.carrier))
      .toEqual([
        'global-layer',
        'surface-layer',
        'slide-scene',
        'surface-layer',
        'flow-block',
        'spatial-world',
      ])

    const nextCarriers = componentCarriers(plan.nextDocument)
    expect([...nextCarriers.keys()]).toEqual([...beforeCarriers.keys()])
    for (const [id, before] of beforeCarriers) {
      const expected = structuredClone(before)
      expected.component.version = '2.0.0'
      expect(nextCarriers.get(id), id).toEqual(expected)
    }
    const expectedDocument = structuredClone(beforeProject)
    expectedDocument.componentPackages[PACKAGE_ID] = structuredClone(
      plan.nextDocument.componentPackages[PACKAGE_ID]!,
    )
    for (const carrier of componentCarriers(expectedDocument).values()) {
      carrier.component.version = '2.0.0'
    }
    expectedDocument.revision += 1
    expectedDocument.updatedAt = NOW
    expect(plan.nextDocument).toEqual(expectedDocument)

    expect(plan.resourceChanges.componentPackageChanges).toHaveLength(1)
    const change = plan.resourceChanges.componentPackageChanges![0]!
    expect(change.packageId).toBe(PACKAGE_ID)
    if (!change.before || !change.after) throw new Error('Expected a replace delta')
    expectPackageValue(change.before, beforeCurrent)
    expect(change.after).toMatchObject({
      manifest: { id: PACKAGE_ID, version: '2.0.0' },
      contentSha256: replacement.contentSha256,
    })
    expect(change.before).not.toBe(currentPackage)
    expect(change.after).not.toBe(replacement)
    expect(change.before!.files['runtime.js']).not.toBe(currentPackage.files['runtime.js'])
    expect(change.after!.files['runtime.js']).not.toBe(replacement.files['runtime.js'])
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.nextDocument)).toBe(true)
    expect(Object.isFrozen(plan.nextDocument.surfaces)).toBe(true)
    expect(Object.isFrozen(change.before)).toBe(true)
    expect(Object.isFrozen(change.before!.files)).toBe(true)
    expect(Object.isFrozen(change.after)).toBe(true)
    expect(Object.isFrozen(change.after!.manifest)).toBe(true)
    expect(Object.isFrozen(change.after!.files['runtime.js'])).toBe(false)

    project.title = 'Caller mutated title'
    const callerGlobal = componentCarriers(project).get('component-global')
    if (!callerGlobal) throw new Error('Missing caller global component')
    callerGlobal.props = { caller: 'mutated' }
    expect(plan.nextDocument.title).toBe(beforeProject.title)
    expect(componentCarriers(plan.nextDocument).get('component-global')?.props)
      .toEqual({ id: 'component-global', nested: { score: 1_000 } })

    currentPackage.files['runtime.js']![0] = 0
    replacement.files['runtime.js']![0] = 0
    expect(change.before!.files['runtime.js']![0]).toBe(beforeCurrent.files['runtime.js']![0])
    expect(change.after!.files['runtime.js']![0]).toBe(beforeReplacement.files['runtime.js']![0])

    const step = createEditorTransactionStep(beforeProject, plan)
    if (!step) throw new Error('Expected a replacement transaction step')
    const forward = applyEditorTransactionStep({
      document: beforeProject,
      resources: {
        componentPackages: { [PACKAGE_ID]: beforeCurrent },
        assetFiles: {},
      },
    }, step, 'forward')
    expect(forward.document).toEqual(plan.nextDocument)
    expectPackageValue(forward.resources.componentPackages[PACKAGE_ID]!, change.after)

    const inverse = applyEditorTransactionStep(forward, step, 'inverse')
    expect(inverse.document).toEqual(beforeProject)
    expectPackageValue(inverse.resources.componentPackages[PACKAGE_ID]!, beforeCurrent)
  })

  it('returns an explicit no-op for the exact installed version and bytes', () => {
    const { project, currentPackage } = mixedProjectFixture()
    const before = structuredClone(project)
    const result = planCourseComponentPackageReplacement(inputFor(
      project,
      currentPackage,
      structuredClone(currentPackage),
    ))

    expect(result).toMatchObject({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        packageId: PACKAGE_ID,
        previousVersion: '1.0.0',
        replacementVersion: '1.0.0',
      },
    })
    expect(project).toEqual(before)

    const changedTransientValue = structuredClone(currentPackage)
    changedTransientValue.thumbnailUrl = 'blob:replacement-thumbnail'
    const nonNoOp = planCourseComponentPackageReplacement(inputFor(
      project,
      currentPackage,
      changedTransientValue,
    ))
    expect(nonNoOp).toMatchObject({ ok: true, status: 'planned' })

    const currentWithoutCache = structuredClone(currentPackage)
    const replacementWithoutCache = structuredClone(currentPackage)
    delete (currentWithoutCache as { contentSha256?: string }).contentSha256
    delete (replacementWithoutCache as { contentSha256?: string }).contentSha256
    const noCache = planCourseComponentPackageReplacement(inputFor(
      project,
      currentWithoutCache,
      replacementWithoutCache,
    ))
    expect(noCache).toMatchObject({ ok: true, status: 'no-op', plan: null })
  })

  it('rejects stale identity, missing resources, ID/hash/version conflicts and stale instances', () => {
    const cases: Array<{
      label: string
      code: string
      mutate: (input: PlanCourseComponentPackageReplacementInput) => void
    }> = [
      {
        label: 'project identity',
        code: 'project-mismatch',
        mutate: (input) => {
          ;(input.expected as { projectId: string }).projectId = 'another-project'
        },
      },
      {
        label: 'revision',
        code: 'revision-conflict',
        mutate: (input) => {
          ;(input.expected as { revision: number }).revision += 1
        },
      },
      {
        label: 'resource missing',
        code: 'package-resource-missing',
        mutate: (input) => {
          delete (input.componentPackages as Record<string, ComponentPackageData>)[PACKAGE_ID]
        },
      },
      {
        label: 'clock',
        code: 'invalid-clock',
        mutate: (input) => {
          ;(input as { now: string }).now = 'not-an-iso-clock'
        },
      },
      {
        label: 'replacement ID',
        code: 'package-identity-mismatch',
        mutate: (input) => {
          ;(input.replacement.manifest as { id: string }).id = 'com.example.other'
        },
      },
      {
        label: 'non-exact requested ID',
        code: 'package-identity-mismatch',
        mutate: (input) => {
          ;(input as { packageId: string }).packageId = ` ${PACKAGE_ID}`
        },
      },
      {
        label: 'current content hash',
        code: 'content-hash-mismatch',
        mutate: (input) => {
          input.project.componentPackages[PACKAGE_ID]!.contentSha256 = 'f'.repeat(64)
        },
      },
      {
        label: 'replacement cached hash',
        code: 'content-hash-mismatch',
        mutate: (input) => {
          ;(input.replacement as { contentSha256: string }).contentSha256 = 'f'.repeat(64)
        },
      },
      {
        label: 'current external runtime mismatch',
        code: 'content-hash-mismatch',
        mutate: (input) => {
          ;(input.componentPackages[PACKAGE_ID] as ComponentPackageData).runtimeSource +=
            '\n// caller-only tamper'
        },
      },
      {
        label: 'current manifest file/object mismatch',
        code: 'content-hash-mismatch',
        mutate: (input) => {
          ;(input.componentPackages[PACKAGE_ID] as ComponentPackageData)
            .manifest.name = 'Object-only current name'
        },
      },
      {
        label: 'replacement external runtime mismatch',
        code: 'invalid-replacement',
        mutate: (input) => {
          input.replacement.runtimeSource += '\n// caller-only tamper'
        },
      },
      {
        label: 'replacement manifest file/object mismatch',
        code: 'invalid-replacement',
        mutate: (input) => {
          const fileManifest = JSON.parse(new TextDecoder().decode(
            input.replacement.files['manifest.json'],
          )) as ComponentManifest
          fileManifest.name = 'File-only name'
          input.replacement.files['manifest.json'] = encoder.encode(
            JSON.stringify(fileManifest),
          )
          ;(input.replacement as { contentSha256: string }).contentSha256 =
            componentContentSha256(input.replacement.files)
        },
      },
      {
        label: 'current provenance lock',
        code: 'content-hash-mismatch',
        mutate: (input) => {
          input.project.componentPackages[PACKAGE_ID]!.sourceLabel = 'Different source'
        },
      },
      {
        label: 'replacement provenance',
        code: 'invalid-replacement',
        mutate: (input) => {
          input.replacement.provenance!.sha256 = 'not-a-sha256'
        },
      },
      {
        label: 'same-version different bytes',
        code: 'version-conflict',
        mutate: (input) => {
          ;(input as { replacement: ComponentPackageData }).replacement = componentPackage(
            '1.0.0',
            ['scene', 'global'],
            'different-runtime',
          )
        },
      },
      {
        label: 'same-version different archive provenance hash',
        code: 'version-conflict',
        mutate: (input) => {
          ;(input as { replacement: ComponentPackageData }).replacement =
            structuredClone(input.componentPackages[PACKAGE_ID]!)
          input.replacement.provenance!.sha256 = 'c'.repeat(64)
          input.replacement.provenance!.sourceLabel = 'Conflicting same version'
        },
      },
      {
        label: 'stale nested Flow instance',
        code: 'instance-version-mismatch',
        mutate: (input) => {
          const flow = input.project.surfaces.find((surface) => surface.type === 'flow')
          if (!flow || flow.type !== 'flow') throw new Error('Missing Flow surface')
          flowComponent(flow.blocks).component.version = '0.9.0'
        },
      },
      {
        label: 'final V9 schema',
        code: 'invalid-document',
        mutate: (input) => {
          input.project.startLocationId = 'missing-location'
        },
      },
    ]

    for (const failureCase of cases) {
      const { project, currentPackage } = mixedProjectFixture()
      const input = inputFor(project, currentPackage, componentPackage('2.0.0'))
      failureCase.mutate(input)
      const beforeProject = structuredClone(input.project)
      const beforePackages = structuredClone(input.componentPackages)
      const beforeReplacement = structuredClone(input.replacement)
      const result = planCourseComponentPackageReplacement(input)
      expect(result, failureCase.label).toMatchObject({
        ok: false,
        code: failureCase.code,
      })
      expect(input.project, failureCase.label).toEqual(beforeProject)
      const actualCurrent = input.componentPackages[PACKAGE_ID]
      const expectedCurrent = beforePackages[PACKAGE_ID]
      if (actualCurrent && expectedCurrent) {
        expectPackageValue(actualCurrent, expectedCurrent)
      } else {
        expect(actualCurrent, failureCase.label).toBe(expectedCurrent)
      }
      expectPackageValue(input.replacement, beforeReplacement)
    }
  })

  it('requires replacement scopes for both global and every Surface-owned carrier', () => {
    for (const [supportedScopes, expectedScope] of [
      [['scene'] as ComponentScope[], '全局层'],
      [['global'] as ComponentScope[], '场景层'],
    ] as const) {
      const { project, currentPackage } = mixedProjectFixture()
      const result = planCourseComponentPackageReplacement(inputFor(
        project,
        currentPackage,
        componentPackage('2.0.0', supportedScopes),
      ))
      expect(result).toMatchObject({ ok: false, code: 'unsupported-scope' })
      if (!result.ok) expect(result.reason).toContain(expectedScope)
    }
  })
})

describe('Course component package deletion transaction planner', () => {
  it('collects every V9 carrier and rejects a referenced package without mutation', () => {
    const { project, currentPackage } = mixedProjectFixture()
    const beforeProject = structuredClone(project)
    const beforePackage = structuredClone(currentPackage)

    const usage = collectCourseComponentPackageUsage(project, PACKAGE_ID)
    expect(usage).toMatchObject({
      packageId: PACKAGE_ID,
      packageExists: true,
      sceneInstanceCount: 5,
      globalInstanceCount: 1,
      totalInstanceCount: 6,
    })
    expect(usage.references.map((reference) => ({
      carrier: reference.carrier,
      instanceId: reference.instanceId,
    }))).toEqual([
      { carrier: 'global-layer', instanceId: 'component-global' },
      { carrier: 'surface-layer', instanceId: 'component-surface' },
      { carrier: 'slide-scene', instanceId: 'component-slide' },
      { carrier: 'surface-layer', instanceId: 'component-flow-overlay' },
      { carrier: 'flow-block', instanceId: 'component-flow' },
      { carrier: 'spatial-world', instanceId: 'component-spatial' },
    ])

    const result = planCourseComponentPackageDeletion(
      deletionInputFor(project, currentPackage),
    )
    expect(result).toMatchObject({ ok: false, code: 'package-referenced' })
    if (result.ok || result.code !== 'package-referenced') {
      throw new Error('Expected referenced-package rejection')
    }
    expect(result.references).toEqual(usage.references)
    expect(project).toEqual(beforeProject)
    expectPackageValue(currentPackage, beforePackage)
  })

  it('removes an unused package with one invertible document-and-bytes transaction', () => {
    const { project, currentPackage } = mixedProjectFixture()
    removePackageReferences(project)
    expect(collectCourseComponentPackageUsage(project, PACKAGE_ID)).toMatchObject({
      packageExists: true,
      totalInstanceCount: 0,
    })
    const beforeProject = structuredClone(project)
    const beforePackage = structuredClone(currentPackage)

    const result = planCourseComponentPackageDeletion(
      deletionInputFor(project, currentPackage),
    )
    expect(result).toMatchObject({ ok: true, status: 'planned' })
    if (!result.ok) throw new Error(`${result.code}: ${result.reason}`)
    const plan = result.plan

    expect(plan.nextDocument.componentPackages[PACKAGE_ID]).toBeUndefined()
    expect(plan.nextDocument.revision).toBe(beforeProject.revision + 1)
    expect(plan.nextDocument.updatedAt).toBe(NOW)
    expect(plan.feedback).toEqual({
      kind: 'component-package-deleted',
      packageId: PACKAGE_ID,
      version: '1.0.0',
    })
    const change = plan.resourceChanges.componentPackageChanges?.[0]
    if (!change || !change.before) throw new Error('Expected a removal package delta')
    expect(change.packageId).toBe(PACKAGE_ID)
    expect(change.after).toBeUndefined()
    expectPackageValue(change.before, beforePackage)

    const step = createEditorTransactionStep(beforeProject, plan)
    if (!step) throw new Error('Expected a removal transaction step')
    const forward = applyEditorTransactionStep({
      document: beforeProject,
      resources: {
        componentPackages: { [PACKAGE_ID]: beforePackage },
        assetFiles: {},
      },
    }, step, 'forward')
    expect(forward.document).toEqual(plan.nextDocument)
    expect(forward.resources.componentPackages[PACKAGE_ID]).toBeUndefined()

    const inverse = applyEditorTransactionStep(forward, step, 'inverse')
    expect(inverse.document).toEqual(beforeProject)
    expectPackageValue(inverse.resources.componentPackages[PACKAGE_ID]!, beforePackage)
  })
})
