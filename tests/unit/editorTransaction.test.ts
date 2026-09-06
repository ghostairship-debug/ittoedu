import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import {
  applyEditorTransactionStep,
  createEditorTransactionStep,
  type EditorTransactionState,
} from '@/renderer/authoring/editorTransaction'
import { planAssetFileHistoryChange } from '@/renderer/store/courseResourceState'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { courseAuthoringScopeFromLocation } from '@/renderer/authoring/courseAuthoringScope'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { generationRequestSchema, generationCandidateSchema, MAX_GENERATION_PROMPT_BYTES, type GenerationCandidate } from '@/shared/generationContract'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { describeAuthoringTools } from '@/renderer/authoring/tools/authoringToolFacade'
import { captureGenerationRepair, generationRepairMadeProgress } from '@/renderer/authoring/generation/generationRepair'

describe('generation context snapshots', () => {
  it('exports formal tool schemas and captures a fresh immutable scope without changing the document', () => {
    const f = generationFixture(), document = f.read().document, before = structuredClone(document)
    const input = { document, workspace: f.request.workspace, sessionToken: { locationId: document.startLocationId, surfaceType: 'slide' as const, generation: 1, revision: document.revision },
      projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId }), selectedIds: [], scope: 'page' as const, instruction: '添加文字', purpose: 'single-page' as const }
    const first = captureGenerationSnapshot(input), second = captureGenerationSnapshot(input)
    expect(first.requestId).not.toBe(second.requestId)
    expect(first.destinations[0]).toEqual(f.request.destinations[0])
    expect(document).toEqual(before)
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThan(MAX_GENERATION_PROMPT_BYTES - 16000)
    expect(describeAuthoringTools(['native.content'])[0]?.inputSchema).toHaveProperty('oneOf')
    const textInput = describeAuthoringTools(['native.content'])[0]?.references?.text as any
    expect(textInput.required).toEqual(expect.arrayContaining(['text', 'runs', 'style']))
    const textStyle = textInput.$defs[textInput.properties.style.$ref.split('/').at(-1)]
    expect(textStyle.required).toEqual(expect.arrayContaining(['fontSize', 'bold', 'verticalAlign', 'overflow']))
    expect(describeAuthoringTools(['component.configure'])[0]?.candidateCarrier).toEqual({ default: 'existing-component' })
    expect(describeAuthoringTools(['component.insert'])[0]?.candidateCarrier.operations?.candidate).toBe('generated-component')
    expect(() => describeAuthoringTools(['unregistered'])).toThrow('未开放')
    expect(() => captureGenerationSnapshot({ ...input, scope: 'selection' })).toThrow('请选择')
    expect(() => captureGenerationSnapshot({ ...input, sessionToken: { ...input.sessionToken, revision: 100 } })).toThrow('过期')
  })
})

function generationFixture() {
  let document = createBlankCourseProject({ title: '生成事务' })
  let resources = { assetFiles: {}, componentPackages: {} }
  let generation = 1
  let workspace = { version: 1 as const, projectId: document.id, normalizedPath: '/fixtures/generation.h5lesson' }
  const commits: import('@/renderer/authoring/editorTransaction').EditorTransactionStep[] = []
  const scope = courseAuthoringScopeFromLocation({ project: document, locationId: document.startLocationId })
  const destination = { kind: 'create' as const, scope: { projectId: document.id, documentRevision: document.revision,
    revisionPolicy: { kind: 'exact' as const }, sessionGeneration: generation, surfaceType: 'slide' as const,
    surfaceId: scope.surfaceId, locationId: scope.locationId, stateId: null, owner: scope.owner, ownerKey: scope.ownerKey,
    parent: { kind: 'owner' as const }, insertion: { kind: 'append' as const } } }
  const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace,
    documentRevision: document.revision, sessionGeneration: generation, purpose: 'single-page', instruction: '生成两个文字对象',
    destinations: [destination], context: { title: document.title }, allowedCarriers: ['native'] })
  const candidate: GenerationCandidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '添加讲解和题目',
    steps: ['讲解', '题目'].map((text, index) => ({ id: `s${index}`, tool: 'native.content', carrier: 'native', destination,
      input: { operation: 'insert', template: { nativeType: 'text', text } } })) }
  const coordinator = createGenerationCandidateCoordinator({ readDocument: () => document, readResources: () => resources,
    readWorkspace: () => workspace, readSessionGeneration: () => generation,
    commit(step) { const next = applyEditorTransactionStep({ document, resources }, step, 'forward'); document = next.document; resources = next.resources; commits.push(step); return true } })
  return { coordinator, request, candidate, commits, read: () => ({ document, resources }),
    edit: () => { document = { ...document, revision: document.revision + 1, title: '教师修改' } },
    saveAs: () => { workspace = { ...workspace, normalizedPath: '/fixtures/new.h5lesson' } },
    stop: () => { generation++ },
  }
}

describe('CLI generation candidate atomic preparation and commit', () => {
  it('imports an existing trusted catalog package atomically and rejects changed or untrusted catalog content', async () => {
    const f = generationFixture(), before = structuredClone(f.read())
    const manifest = { schemaVersion: 4, runtimeApiVersion: 4, id: 'com.example.catalog', name: '目录组件', version: '1.0.0', entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 }, minSize: { width: 80, height: 45 }, preserveAspectRatio: true, assets: {}, defaultProps: {}, supportedScopes: ['scene'], renderMode: 'dom' }
    const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'runtime.js': strToU8('window.CoursewareComponent.define({id:"com.example.catalog",runtimeApiVersion:4,create(){return{destroy(){}}}})') })
    const entry = { sourceId: 'builtin', sourceLabel: '内置', sourceTrust: 'built-in', packageId: manifest.id, version: manifest.version, sha256: 'a'.repeat(64) }
    const read = vi.fn(async () => ({ ...entry, bytes }))
    const originalApi = window.desktopAPI
    Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { loadComponentCatalog: async () => ({ packages: [entry] }), readComponentCatalogPackage: read } })
    try {
      const request = { ...f.request, allowedCarriers: ['existing-component'] }
      const candidate = { ...f.candidate, steps: [{ ...f.candidate.steps[0], tool: 'component.insert', carrier: 'existing-component', lowerCarrierReason: '需要现有组件交互',
        input: { operation: 'catalog', sourceId: entry.sourceId, packageId: entry.packageId, version: entry.version, sha256: entry.sha256 } }] }
      entry.sourceTrust = 'prompt'
      await expect(f.coordinator.prepare(request, candidate)).rejects.toThrow('尚未受信')
      expect(read).not.toHaveBeenCalled()
      entry.sourceTrust = 'built-in'; entry.sha256 = 'b'.repeat(64)
      await expect(f.coordinator.prepare(request, candidate)).rejects.toThrow('已改变')
      expect(read).not.toHaveBeenCalled()
      entry.sha256 = 'a'.repeat(64)
      const preview = await f.coordinator.prepare(request, candidate)
      expect(f.read()).toEqual(before)
      expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
      expect(f.commits).toHaveLength(1)
      expect(f.read().document.componentPackages[manifest.id]).toBeDefined()
      expect(applyEditorTransactionStep(f.read(), f.commits[0], 'inverse')).toEqual(before)
    } finally { Object.defineProperty(window, 'desktopAPI', { configurable: true, value: originalApi }) }
  })
  it('repairs against the original immutable baseline and ignores metadata-only progress', async () => {
    const f = generationFixture(), before = structuredClone(f.read())
    const bad = structuredClone(f.candidate)
    bad.steps[0].input = { operation: 'insert', template: { nativeType: 'not-supported' } }
    await expect(f.coordinator.prepare(f.request, bad)).rejects.toThrow()
    const repair = captureGenerationRepair(f.request, bad, 'unsupported nativeType')
    expect(repair.requestId).not.toBe(f.request.requestId)
    expect(repair.destinations).toEqual(f.request.destinations)
    expect(repair.documentRevision).toBe(f.request.documentRevision)
    expect(repair.sessionGeneration).toBe(f.request.sessionGeneration)
    const noChange = { ...bad, requestId: repair.requestId, candidateId: crypto.randomUUID(), summary: '已经修复', steps: bad.steps.map((step, i) => ({ ...step, id: `renamed-${i}` })) }
    expect(generationRepairMadeProgress(bad, noChange)).toBe(false)
    const fixed = { ...f.candidate, requestId: repair.requestId }
    expect(generationRepairMadeProgress(bad, fixed)).toBe(true)
    const preview = await f.coordinator.prepare(repair, fixed)
    expect(f.read()).toEqual(before)
    expect(f.commits).toHaveLength(0)
    f.edit()
    expect(f.coordinator.apply(preview.previewId).status).toBe('stale')
    expect(f.commits).toHaveLength(0)
  })
  it('builds Flow and Spatial content from earlier creation receipts as a single reversible course transaction', async () => {
    const f = generationFixture(), original = structuredClone(f.read())
    const first = f.request.destinations[0]!
    if (first.kind !== 'create') throw new Error('wrong fixture')
    const destination = { kind: 'create' as const, scope: { ...first.scope, owner: 'global' as const, ownerKey: 'global', parent: { kind: 'course-locations' as const } } }
    const request = { ...f.request, destinations: [destination], purpose: 'whole-course', confirmedDocuments: { teachingPlan: '认识分数：先讲解平均分，再操作观察。', presentationScript: 'Flow 讲义解释；Spatial 观察不同分法。' } }
    const candidate = { ...f.candidate, steps: [
      { id: 'flow', tool: 'course.navigation', carrier: 'native', destination, input: { operation: 'add-surface', surfaceType: 'flow', title: '分数讲义' } },
      { id: 'paragraph', tool: 'flow.content', carrier: 'native', destination: { kind: 'created-scope', stepId: 'flow', parent: { kind: 'flow-body', parentBlockId: null }, insertion: { kind: 'append' } }, input: { operation: 'insert', block: { type: 'paragraph', text: '平均分是各份大小相同。' } } },
      { id: 'spatial', tool: 'course.navigation', carrier: 'native', destination, input: { operation: 'add-surface', surfaceType: 'spatial-2d', title: '观察分法' } },
      { id: 'world-text', tool: 'native.content', carrier: 'native', destination: { kind: 'created-scope', stepId: 'spatial', parent: { kind: 'owner' }, insertion: { kind: 'append' } }, input: { operation: 'insert', template: { nativeType: 'text', text: '各份是否同样大？' } } },
    ] }
    const preview = await f.coordinator.prepare(request, candidate)
    expect(f.read()).toEqual(original)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
    expect(f.read().document.surfaces.map(surface => surface.type)).toEqual(['slide', 'flow', 'spatial-2d'])
    expect(JSON.stringify(f.read().document)).toContain('平均分是各份大小相同。')
    expect(JSON.stringify(f.read().document)).toContain('各份是否同样大？')
    expect(f.commits).toHaveLength(1)
    expect(applyEditorTransactionStep(f.read(), f.commits[0]!, 'inverse')).toEqual(original)
  })
  it('resolves host-created IDs inside typed tool inputs and rejects missing resources without writes', async () => {
    const f = generationFixture()
    f.candidate.steps[1] = { id: 's1', carrier: 'native', tool: 'native.content', destination: { kind: 'created-item', stepId: 's0', index: 0 },
      input: { operation: 'properties', properties: { label: { $result: { stepId: 's0', kind: 'item-id', index: 0 } } } } }
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
    const surface = f.read().document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('wrong fixture')
    expect(surface.scenes[0]!.layerItems[0]!.label).toBe(surface.scenes[0]!.layerItems[0]!.layerItemId)
    const invalid = generationFixture(), original = structuredClone(invalid.read())
    invalid.candidate.steps[1] = { ...f.candidate.steps[1]!, input: { operation: 'properties', properties: { label: { $result: { stepId: 's0', kind: 'asset-id' } } } } }
    await expect(invalid.coordinator.prepare(invalid.request, invalid.candidate)).rejects.toThrow('asset-id')
    expect(invalid.read()).toEqual(original)
    invalid.candidate.steps[0]!.input = { $result: { stepId: 's1', kind: 'item-id' } }
    expect(generationCandidateSchema.safeParse(invalid.candidate).success).toBe(false)
  })
  it('previews two real product commands without writes and applies/undoes one transaction', async () => {
    const f = generationFixture(), original = structuredClone(f.read())
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.read()).toEqual(original)
    expect(f.commits).toHaveLength(0)
    expect(preview.plannedEffects).toHaveLength(2)
    preview.document.title = '伪造预览'
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
    expect(f.read().document.title).toBe(original.document.title)
    expect(f.read().document.revision).toBe(original.document.revision + 1)
    expect(f.commits).toHaveLength(1)
    const surface = f.read().document.surfaces[0]!
    expect(surface.type === 'slide' && surface.scenes[0]!.layerItems).toHaveLength(2)
    expect(applyEditorTransactionStep(f.read(), f.commits[0]!, 'inverse')).toEqual(original)
    expect(f.coordinator.apply(preview.previewId).status).toBe('stale')
  })

  it('rejects a bad later command with no partial document, resource or history write', async () => {
    const f = generationFixture(), original = structuredClone(f.read())
    f.candidate.steps[1]!.input = { operation: 'insert', template: { nativeType: 'text', rawV9Patch: true } }
    await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toThrow()
    expect(f.read()).toEqual(original)
    expect(f.commits).toHaveLength(0)
  })

  it('resolves a created item from a host result and edits it inside the same transaction', async () => {
    const f = generationFixture()
    f.candidate.steps[1] = { id: 's1', carrier: 'native', tool: 'native.content', destination: { kind: 'created-item', stepId: 's0', index: 0 }, input: { operation: 'properties', properties: { label: '讲解文字' } } }
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
    const surface = f.read().document.surfaces[0]!
    expect(surface.type === 'slide' && surface.scenes[0]!.layerItems[0]!.label).toBe('讲解文字')
  })

  it.each(['edit', 'saveAs', 'stop'] as const)('rejects preview application after %s', async operation => {
    const f = generationFixture()
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    f[operation]()
    const before = structuredClone(f.read())
    expect(f.coordinator.apply(preview.previewId).status).toBe('stale')
    expect(f.read()).toEqual(before)
    expect(f.commits).toHaveLength(0)
  })

  it('discard cancels asynchronous preparation and rejects a forged preview token', async () => {
    const f = generationFixture()
    const pending = f.coordinator.prepare(f.request, f.candidate)
    f.coordinator.discard()
    await expect(pending).rejects.toThrow('stale')
    expect(f.coordinator.apply('forged').status).toBe('stale')
    expect(f.commits).toHaveLength(0)
  })

  it('rejects unknown envelopes, forward references and destinations outside the request', async () => {
    const f = generationFixture()
    expect(generationCandidateSchema.safeParse({ ...f.candidate, rawV9Patch: {} }).success).toBe(false)
    expect(generationRequestSchema.safeParse({ ...f.request, purpose: 'whole-course' }).success).toBe(false)
    f.candidate.steps[0]!.destination = { kind: 'created-item', stepId: 's1', index: 0 }
    expect(generationCandidateSchema.safeParse(f.candidate).success).toBe(false)
    f.candidate.steps[0]!.destination = { ...f.request.destinations[0]!, scope: { ...(f.request.destinations[0] as Extract<typeof f.request.destinations[number], {kind:'create'}>).scope, ownerKey: 'other' } } as GenerationCandidate['steps'][number]['destination']
    await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toThrow('范围')
    expect(f.commits).toHaveLength(0)
  })
})

const FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
  'slide-heavy.h5lesson',
)
const REPLACEMENT_ASSET_ID = 'slide-hero-replacement'
const REPLACEMENT_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

function fixture() {
  return openCourseProjectArchive(
    new Uint8Array(readFileSync(FIXTURE_PATH)),
  )
}

function imageAssetId(
  project: CourseProjectDocument,
  itemId: string,
): string {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => (
        candidate.layerItemId === itemId
      ))
      if (
        item?.kind === 'native' &&
        item.content.nativeType === 'image'
      ) {
        return item.content.data.assetId
      }
    }
  }
  throw new Error(`Slide image item is missing: ${itemId}`)
}

function replaceSlideImageReference(
  project: CourseProjectDocument,
  itemId: string,
  assetId: string,
): void {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => (
        candidate.layerItemId === itemId
      ))
      if (
        item?.kind === 'native' &&
        item.content.nativeType === 'image'
      ) {
        item.content.data.assetId = assetId
        return
      }
    }
  }
  throw new Error(`Slide image item is missing: ${itemId}`)
}

describe('Editor transaction resource step', () => {
  it('carries a Slide-heavy document and added image bytes as one reversible step', () => {
    const archive = fixture()
    const baseDocument = archive.project
    const baseAssetId = imageAssetId(baseDocument, 'slide-intro-hero')
    const baseAsset = baseDocument.assets[baseAssetId]
    if (!baseAsset) throw new Error('Slide-heavy fixture is missing image metadata')

    const nextDocument = structuredClone(baseDocument)
    nextDocument.assets[REPLACEMENT_ASSET_ID] = {
      ...structuredClone(baseAsset),
      id: REPLACEMENT_ASSET_ID,
      filename: 'replacement.png',
      path: `assets/${REPLACEMENT_ASSET_ID}.png`,
      byteLength: REPLACEMENT_BYTES.byteLength,
    }
    replaceSlideImageReference(
      nextDocument,
      'slide-intro-hero',
      REPLACEMENT_ASSET_ID,
    )
    nextDocument.revision = baseDocument.revision + 1
    nextDocument.updatedAt = '2026-08-24T01:00:00.000Z'

    const callerBytes = REPLACEMENT_BYTES.slice()
    const step = createEditorTransactionStep(baseDocument, {
      projectId: baseDocument.id,
      baseRevision: baseDocument.revision,
      nextDocument,
      resourceChanges: {
        assetFileChanges: [planAssetFileHistoryChange(
          REPLACEMENT_ASSET_ID,
          undefined,
          callerBytes,
        )!],
      },
      selectionHint: {
        itemId: 'slide-intro-hero',
        authoringAddress: 'scene:slide-scene-intro/layer:slide-intro-hero',
      },
      feedback: { kind: 'image-replaced' },
    })
    if (!step) throw new Error('Expected an image replacement transaction')

    callerBytes[0] = 0
    nextDocument.assets[REPLACEMENT_ASSET_ID]!.filename = 'mutated.png'
    expect(step.nextDocument.assets[REPLACEMENT_ASSET_ID]!.filename)
      .toBe('replacement.png')
    expect([...step.resourceChanges.assetFileChanges![0]!.after!])
      .toEqual([...REPLACEMENT_BYTES])
    expect(Object.isFrozen(step)).toBe(true)
    expect(Object.isFrozen(step.nextDocument)).toBe(true)
    expect(step).not.toHaveProperty('past')
    expect(step).not.toHaveProperty('future')

    const initialState: EditorTransactionState = {
      document: baseDocument,
      resources: {
        componentPackages: {},
        assetFiles: archive.assetFiles,
      },
    }
    const forward = applyEditorTransactionStep(initialState, step, 'forward')
    expect(forward.document.revision).toBe(baseDocument.revision + 1)
    expect(imageAssetId(forward.document, 'slide-intro-hero'))
      .toBe(REPLACEMENT_ASSET_ID)
    expect([...forward.resources.assetFiles[REPLACEMENT_ASSET_ID]!])
      .toEqual([...REPLACEMENT_BYTES])
    expect(forward.resources.assetFiles[baseAssetId])
      .toEqual(archive.assetFiles[baseAssetId])

    const inverse = applyEditorTransactionStep(forward, step, 'inverse')
    expect(inverse.document).toEqual(baseDocument)
    expect(inverse.resources.assetFiles[REPLACEMENT_ASSET_ID]).toBeUndefined()
    expect(inverse.resources.assetFiles).toEqual(archive.assetFiles)
  })

  it('does not create a step for a cloned document and byte-identical resources', () => {
    const archive = fixture()
    const baseBytes = archive.assetFiles['slide-hero']
    if (!baseBytes) throw new Error('Slide-heavy fixture is missing slide-hero bytes')
    const step = createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument: structuredClone(archive.project),
      resourceChanges: {
        assetFileChanges: [{
          assetId: 'slide-hero',
          before: baseBytes,
          after: baseBytes.slice(),
        }],
      },
    })
    expect(step).toBeNull()
  })

  it('requires every non-no-op document or resource commit to advance revision once', () => {
    const archive = fixture()
    const modifiedWithoutRevision = structuredClone(archive.project)
    modifiedWithoutRevision.title = `${modifiedWithoutRevision.title} changed`
    expect(() => createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument: modifiedWithoutRevision,
      resourceChanges: {},
    })).toThrow(/revision.*1/)

    const skippedRevision = structuredClone(archive.project)
    skippedRevision.revision += 2
    expect(() => createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument: skippedRevision,
      resourceChanges: {},
    })).toThrow(/revision.*1/)

    const baseBytes = archive.assetFiles['slide-hero']
    if (!baseBytes) throw new Error('Slide-heavy fixture is missing slide-hero bytes')
    expect(() => createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument: structuredClone(archive.project),
      resourceChanges: {
        assetFileChanges: [{
          assetId: 'slide-hero',
          before: baseBytes,
          after: new Uint8Array([1, 2, 3]),
        }],
      },
    })).toThrow(/revision.*1/)
  })

  it('rejects mismatched identity, revision, and stale application', () => {
    const archive = fixture()
    const nextDocument = structuredClone(archive.project)
    nextDocument.revision += 1

    expect(() => createEditorTransactionStep(archive.project, {
      projectId: 'another-project',
      baseRevision: archive.project.revision,
      nextDocument,
      resourceChanges: {},
    })).toThrow(/Course Project/)
    expect(() => createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision + 1,
      nextDocument,
      resourceChanges: {},
    })).toThrow(/baseRevision/)

    const step = createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument,
      resourceChanges: {},
    })
    if (!step) throw new Error('Expected a revision transaction')
    const staleDocument = structuredClone(archive.project)
    staleDocument.revision += 2
    expect(() => applyEditorTransactionStep({
      document: staleDocument,
      resources: { componentPackages: {}, assetFiles: archive.assetFiles },
    }, step, 'forward')).toThrow(/revision/)
  })
})
