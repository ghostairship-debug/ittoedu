import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Equivalent candidates now also carry their actual updatedAt diff in receipts.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-17T00:00:00Z')) })
afterEach(() => { vi.useRealTimers() })
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createImageNode, createTextNode } from '@/renderer/project/nativeNodeFactories'
import { encodeImageTransformPng } from '@/renderer/project/imageTransform'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseAuthoringScopeFromLocation, makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { applyEditorTransactionStep, type EditorTransactionState, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { expandGenerationShortCandidate, generationAssetAliases, generationCandidateSchema, generationDestinationAliases, generationRequestSchema, generationShortCandidateSchema, MAX_GENERATION_TASK_DURATION_MS, readGenerationFailure } from '@/shared/generationContract'
import { GENERATION_OPEN, GENERATION_CLOSE, parseGenerationCandidate, readGenerationResult } from '@/shared/generationResult'

function fixture(surfaceType: 'slide' | 'flow' | 'spatial-2d' = 'slide') {
  const document = surfaceType === 'flow' ? createBlankFlowCourseProject() : surfaceType === 'spatial-2d' ? createBlankSpatialCourseProject() : createBlankCourseProject()
  const surface = document.surfaces[0]!
  const title = sceneNodeToCourseLayerItem(createTextNode({ id: 'title', text: '原标题', x: 50, y: 60, width: 360, height: 80, style: { fontSize: 28, bold: true, overflow: 'fixed' } }), 1)
  if (surface.type === 'slide') surface.scenes[0]!.layerItems.push(title)
  else if (surface.type === 'spatial-2d') surface.world.layerItems.push(title)
  else surface.surfaceLayerItems.push({ item: title, visibility: { mode: 'include', locationIds: [document.startLocationId] }, bodyPlane: 'underlay' })
  const located = locateCourseLayer(document, title.layerItemId)!
  const scope = courseAuthoringScopeFromLocation({ project: document, locationId: document.startLocationId, owner: located.source })
  const target = { projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' as const }, sessionGeneration: 1,
    surfaceType: surface.type, surfaceId: surface.id, locationId: scope.locationId, stateId: null, owner: scope.owner, ownerKey: scope.ownerKey,
    itemId: title.layerItemId, authoringAddress: makeLayerItemAuthoringAddress({ projectId: document.id, owner: located.source, surfaceId: surface.id, sceneId: located.sceneId, kind: title.kind, layerItemId: title.layerItemId }) }
  const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace: { version: 1, projectId: document.id, normalizedPath: 'c:/lessons/short.h5lesson' },
    documentRevision: document.revision, sessionGeneration: 1, purpose: 'local-edit', instruction: '把标题改为简谐运动，放大并居中', destinations: [{ kind: 'update', target }], context: {}, allowedCarriers: ['native'] })
  const short = generationShortCandidateSchema.parse({ version: 2, requestId: request.requestId, summary: '更新标题', afterCommit: { version: 1, action: 'finish' },
    steps: [{ id: 'title', tool: 'native.content', destination: 'd1', input: { operation: 'edit', text: '简谐运动', textStyle: { fontSize: 48, align: 'center' } } }] })
  const candidateId = crypto.randomUUID()
  const create = (assetFiles: Record<string, Uint8Array> = {}) => {
    let state: EditorTransactionState = { document: structuredClone(document), resources: { assetFiles: structuredClone(assetFiles), componentPackages: {} } }
    const commits: EditorTransactionStep[] = []
    const coordinator = createGenerationCandidateCoordinator({ readDocument: () => state.document, readResources: () => state.resources, readWorkspace: () => request.workspace, readSessionGeneration: () => request.sessionGeneration,
      commit(step) { state = applyEditorTransactionStep(state, step, 'forward'); commits.push(step); return true } })
    return { coordinator, commits, read: () => state }
  }
  return { request, short, candidateId, document, create }
}

function assetFixture() {
  const f = fixture(), surface = f.document.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Image fixture requires Slide')
  const oldId = 'asset-current', nextId = 'asset-replacement'
  const assetFiles = Object.fromEntries([oldId, nextId].map((id, index) => [id,
    encodeImageTransformPng({ width: 1, height: 1, data: new Uint8Array(index ? [0, 255, 0, 255] : [255, 0, 0, 255]) })]))
  for (const id of [oldId, nextId]) f.document.assets[id] = { id, kind: 'image', filename: `${id}.png`, mimeType: 'image/png',
    path: `assets/${id}.png`, byteLength: assetFiles[id]!.byteLength, width: 1, height: 1 }
  const image = sceneNodeToCourseLayerItem(createImageNode({ id: 'title', assetId: oldId, x: 50, y: 60, width: 360, height: 80 }), 1)
  if (image.kind !== 'native' || image.content.nativeType !== 'image') throw new Error('Image fixture requires Native image')
  surface.scenes[0]!.layerItems = [image]
  f.request.context = JSON.parse(JSON.stringify({ assets: f.document.assets }))
  const content = image.content
  const short = { ...f.short, summary: '替换当前图片的资产引用', steps: [{ ...f.short.steps[0]!,
    input: { operation: 'content', content: { ...content, data: { ...content.data, assetId: { $asset: 'a2' } } } } }] }
  const full = generationCandidateSchema.parse({ ...short, version: 1, candidateId: f.candidateId,
    steps: [{ ...short.steps[0]!, carrier: 'native', destination: f.request.destinations[0],
      input: { operation: 'content', content: { ...content, data: { ...content.data, assetId: nextId } } } }] })
  return { ...f, short, full, assetFiles, oldId, nextId }
}

describe('request-scoped short generation candidates', () => {
  it('applies existing asset aliases and full IDs as the same reversible image transaction', async () => {
    const f = assetFixture(), expanded = expandGenerationShortCandidate(f.short, f.request, f.candidateId)
    expect(expanded).toEqual(f.full)
    const a = f.create(f.assetFiles), b = f.create(f.assetFiles), before = structuredClone(a.read())
    const pa = await a.coordinator.prepare(f.request, expanded), pb = await b.coordinator.prepare(f.request, f.full)
    const ra = a.coordinator.apply(pa.previewId), rb = b.coordinator.apply(pb.previewId)
    expect(ra).toEqual(rb); expect(ra.status).toBe('committed')
    expect({ ...a.read(), document: { ...a.read().document, updatedAt: b.read().document.updatedAt } }).toEqual(b.read())
    expect(locateCourseLayer(a.read().document, 'title')!.item).toMatchObject({ frame: { x: 50, y: 60, width: 360, height: 80 }, content: { data: { assetId: f.nextId } } })
    for (const [id, bytes] of Object.entries(f.assetFiles)) expect(Array.from(a.read().resources.assetFiles[id]!)).toEqual(Array.from(bytes))
    expect(a.commits).toHaveLength(1)
    expect(applyEditorTransactionStep(a.read(), a.commits[0]!, 'inverse')).toEqual(before)
    expect(applyEditorTransactionStep(before, a.commits[0]!, 'forward')).toEqual(a.read())
  })

  it.each(['unknown', 'malformed', 'no-longer-in-request'] as const)('rejects %s asset aliases with the exact step input diagnostic path', mode => {
    const f = assetFixture(), request = structuredClone(f.request), short: any = structuredClone(f.short)
    if (mode === 'unknown') short.steps[0].input.content.data.assetId = { $asset: 'a99' }
    if (mode === 'malformed') short.steps[0].input.content.data.assetId = { $asset: 'a2', assetId: f.oldId }
    if (mode === 'no-longer-in-request') request.context = JSON.parse(JSON.stringify({ assets: { [f.oldId]: f.document.assets[f.oldId] } }))
    const result = readGenerationResult(`${GENERATION_OPEN}${JSON.stringify(short)}${GENERATION_CLOSE}`, request, { candidateId: f.candidateId })
    expect(result).toMatchObject({ kind: 'candidate-format-error', failure: { stage: 'candidate-parse', requestId: request.requestId, candidateId: f.candidateId,
      diagnostics: [expect.objectContaining({ path: mode === 'malformed'
        ? ['steps', 0, 'input', 'content', 'data', 'assetId'] : ['steps', 0, 'input', 'content', 'data', 'assetId', '$asset'] })] } })
    if (mode !== 'malformed') expect(result).toMatchObject({ finding: expect.stringContaining('资产别名') })
    expect(f.create(f.assetFiles).commits).toHaveLength(0)
  })

  it('binds asset aliases to the frozen request and preserves literal strings, prior results and legacy candidates', async () => {
    const f = assetFixture(), aliases = generationAssetAliases(f.request)
    expect(aliases).toEqual({ a1: f.oldId, a2: f.nextId })
    aliases.a2 = 'invented-staged-id'
    expect(expandGenerationShortCandidate(f.short, f.request, f.candidateId)).toEqual(f.full)
    expect(parseGenerationCandidate(f.full, f.request.requestId)).toEqual(f.full)
    const literal = { ...f.short, steps: [
      { ...f.short.steps[0]!, id: 'first', input: { operation: 'edit', text: 'a2', values: ['a2', { $asset: 'a2' }] } },
      { ...f.short.steps[0]!, id: 'next', input: { result: { $result: { stepId: 'first', kind: 'item-id', index: 0 } } } },
    ] }
    const expanded = expandGenerationShortCandidate(literal, f.request, f.candidateId)
    expect(expanded.steps[0]!.input).toEqual({ operation: 'edit', text: 'a2', values: ['a2', f.nextId] })
    expect(expanded.steps[1]!.input).toEqual(literal.steps[1]!.input)
    expect(() => expandGenerationShortCandidate(f.short, { ...f.request, requestId: crypto.randomUUID() }, f.candidateId)).toThrow('其他请求')
    const test = f.create(f.assetFiles)
    test.read().document.revision++
    await expect(test.coordinator.prepare(f.request, expandGenerationShortCandidate(f.short, f.request, f.candidateId))).rejects.toThrow('stale')
    expect(test.commits).toHaveLength(0)
  })

  it.each(['slide', 'flow', 'spatial-2d'] as const)('matches full candidate behavior and one reversible transaction on %s', async surfaceType => {
    const f = fixture(surfaceType), short = expandGenerationShortCandidate(f.short, f.request, f.candidateId)
    const full = generationCandidateSchema.parse({ version: 1, requestId: f.request.requestId, candidateId: f.candidateId, summary: f.short.summary, afterCommit: f.short.afterCommit,
      steps: f.short.steps.map(step => ({ ...step, carrier: 'native', destination: f.request.destinations[0] })) })
    expect(short).toEqual(full)
    const a = f.create(), b = f.create()
    const before = structuredClone(a.read())
    const pa = await a.coordinator.prepare(f.request, short), pb = await b.coordinator.prepare(f.request, full)
    const ra = a.coordinator.apply(pa.previewId), rb = b.coordinator.apply(pb.previewId)
    expect(ra).toEqual(rb); expect(ra.status).toBe('committed')
    expect({ ...a.read(), document: { ...a.read().document, updatedAt: b.read().document.updatedAt } }).toEqual(b.read()); expect(a.commits).toHaveLength(1)
    expect(locateCourseLayer(a.read().document, 'title')!.item).toMatchObject({ frame: { x: 50, y: 60, width: 360, height: 80 }, content: { data: { text: '简谐运动', style: { fontSize: 48, align: 'center', bold: true } } } })
    const undone = applyEditorTransactionStep(a.read(), a.commits[0]!, 'inverse')
    expect(undone).toEqual(before)
    expect(applyEditorTransactionStep(undone, a.commits[0]!, 'forward')).toEqual(a.read())
  })

  it('keeps the host candidate identity stable on repeated reads and rejects incomplete host context', () => {
    const f = fixture(), text = `${GENERATION_OPEN}${JSON.stringify(f.short)}${GENERATION_CLOSE}`
    const one = readGenerationResult(text, f.request, { candidateId: f.candidateId })
    expect(readGenerationResult(text, structuredClone(f.request), { candidateId: f.candidateId })).toEqual(one)
    expect(one).toMatchObject({ kind: 'candidate', candidate: { candidateId: f.candidateId, version: 1 } })
    expect(readGenerationResult(text, f.request)).toMatchObject({ kind: 'candidate-format-error' })
    expect(() => parseGenerationCandidate(f.short, f.request.requestId, { candidateId: f.candidateId })).toThrow('完整请求')
    const aliases = generationDestinationAliases(f.request)
    if (aliases.d1!.kind === 'update') aliases.d1!.target.documentRevision++
    expect(aliases.d1).not.toEqual(f.request.destinations[0])
  })

  it('retains exact nested schema diagnostic codes and paths in candidate-format failures', () => {
    const f = fixture(), invalid = { ...f.short, steps: [{ ...f.short.steps[0], id: 9 }] }
    const result = readGenerationResult(`${GENERATION_OPEN}${JSON.stringify(invalid)}${GENERATION_CLOSE}`, f.request, { candidateId: f.candidateId })
    expect(result).toMatchObject({ kind: 'candidate-format-error', failure: { version: 1, stage: 'candidate-parse', requestId: f.request.requestId, candidateId: f.candidateId,
      diagnostics: [{ code: 'invalid_type', path: ['steps', 0, 'id'], message: expect.stringContaining('string') }], assetIds: [], packageIds: [] } })
    expect(readGenerationResult(`${GENERATION_OPEN}{broken${GENERATION_CLOSE}`, f.request)).toMatchObject({ kind: 'candidate-format-error', failure: {
      stage: 'candidate-parse', diagnostics: [{ code: 'candidate-format', path: [], message: expect.any(String) }] } })
  })

  it.each(['unknown-alias', 'cross-request', 'identity-override', 'scope-override', 'forward-reference', 'empty-candidate'] as const)('rejects %s instead of guessing current selection', mode => {
    const f = fixture(), invalid: any = structuredClone(f.short)
    if (mode === 'unknown-alias') invalid.steps[0].destination = 'd99'
    if (mode === 'cross-request') invalid.requestId = crypto.randomUUID()
    if (mode === 'identity-override') invalid.candidateId = crypto.randomUUID()
    if (mode === 'scope-override') invalid.steps[0].destination = f.request.destinations[0]
    if (mode === 'forward-reference') invalid.steps[0].input = { assetId: { $result: { stepId: 'future', kind: 'asset-id' } } }
    if (mode === 'empty-candidate') invalid.steps = []
    expect(() => expandGenerationShortCandidate(invalid, f.request, f.candidateId)).toThrow()
    expect(f.create().commits).toHaveLength(0)
  })

  it('derives the carrier for actual operations and requires an explicit observe reason while accepting legacy V1', () => {
    const f = fixture(), raw = { ...f.short, afterCommit: { version: 1, action: 'observe', reason: '核对动画周期' }, steps: [{ ...f.short.steps[0], tool: 'component.insert', input: { operation: 'existing', packageId: 'example' } }] }
    expect(expandGenerationShortCandidate(raw, f.request, f.candidateId).steps[0]?.carrier).toBe('existing-component')
    expect(generationShortCandidateSchema.safeParse({ ...raw, afterCommit: { version: 1, action: 'observe' } }).success).toBe(false)
    const { afterCommit: _, ...legacy } = expandGenerationShortCandidate(f.short, f.request, f.candidateId)
    expect(parseGenerationCandidate(legacy, f.request.requestId)).toEqual(legacy)
  })

  it('retires rationale and normalizes one tool-input projection without touching source strings', () => {
    const f = fixture(), input = { source: 'const text = "{\\"x\\":1}";' }
    const raw = { ...f.short, steps: [{ ...f.short.steps[0], tool: 'runtime.source', input: JSON.stringify(input), lowerCarrierReason: 'old unused reason' }] }
    const candidate = parseGenerationCandidate(raw, f.request, { candidateId: f.candidateId })
    expect(candidate.steps[0]!.input).toEqual(input)
    expect(candidate.steps[0]).not.toHaveProperty('lowerCarrierReason')
    expect(generationShortCandidateSchema.safeParse(raw).success).toBe(false)
    expect(() => parseGenerationCandidate({ ...raw, steps: [{ ...raw.steps[0], input: JSON.stringify(JSON.stringify(input)) }] }, f.request, { candidateId: f.candidateId })).toThrow('重复序列化')
  })

  it('resolves ordered short batch destinations and input result references in one host transaction', async () => {
    const f = fixture(), test = f.create(), update = f.request.destinations[0]!
    if (update.kind !== 'update') throw new Error('fixture requires update')
    const { itemId: _itemId, authoringAddress: _address, ...scope } = update.target
    const request = generationRequestSchema.parse({ ...f.request, destinations: [...f.request.destinations, { kind: 'create', scope: { ...scope, parent: { kind: 'owner' }, insertion: { kind: 'append' } } }] })
    const short = { ...f.short, steps: [
      { id: 'create', tool: 'native.content', destination: 'd2', input: { operation: 'insert', template: { nativeType: 'text', text: '先创建' } } },
      { id: 'configure', tool: 'native.content', destination: { kind: 'created-item', stepId: 'create', index: 0 }, input: { operation: 'properties', properties: { label: { $result: { stepId: 'create', kind: 'item-id', index: 0 } } } } },
      f.short.steps[0],
    ] }
    const prepared = await test.coordinator.prepare(request, expandGenerationShortCandidate(short, request, f.candidateId))
    expect(test.coordinator.apply(prepared.previewId).status).toBe('committed'); expect(test.commits).toHaveLength(1)
    const surface = test.read().document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('fixture requires Slide')
    const created = surface.scenes[0]!.layerItems.find(item => item.layerItemId !== 'title')!
    expect(created.label).toBe(created.layerItemId)
    expect(applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse').document).toEqual(f.document)
  })

  it('rejects stale expanded targets and retains structured diagnostics from a later failed step without writes', async () => {
    const f = fixture(), candidate = expandGenerationShortCandidate(f.short, f.request, f.candidateId), test = f.create()
    const stale = structuredClone(f.request)
    stale.documentRevision++
    if (stale.destinations[0]!.kind === 'update') stale.destinations[0]!.target.documentRevision++
    await expect(test.coordinator.prepare(stale, expandGenerationShortCandidate({ ...f.short, requestId: stale.requestId }, stale, f.candidateId))).rejects.toThrow('stale')
    candidate.steps.push({ ...candidate.steps[0]!, id: 'invalid-style', input: { operation: 'edit', textStyle: { fontSize: -5 } } })
    const error = await test.coordinator.prepare(f.request, candidate).catch(value => value)
    const failure = readGenerationFailure(error)!
    expect(failure).toMatchObject({ version: 1, stage: 'prepare', requestId: f.request.requestId, candidateId: f.candidateId, stepId: 'invalid-style', tool: 'native.content', assetIds: [], packageIds: [] })
    expect(failure.diagnostics.some(value => value.code === 'invalid-input' && value.path.includes('fontSize'))).toBe(true)
    expect(test.read().document).toEqual(f.document); expect(test.commits).toHaveLength(0)
  })

  it('emits an unchanged receipt with no revision or undo entry for a real semantic no-op', async () => {
    const f = fixture(), test = f.create(), short = { ...f.short, steps: [{ ...f.short.steps[0], input: { operation: 'edit', text: '原标题', textStyle: { fontSize: 28 } } }] }
    const prepared = await test.coordinator.prepare(f.request, expandGenerationShortCandidate(short, f.request, f.candidateId))
    expect({ ...prepared.document, revision: f.document.revision, updatedAt: f.document.updatedAt }).toEqual(f.document)
    expect(test.coordinator.apply(prepared.previewId)).toMatchObject({ status: 'unchanged', receipt: { status: 'unchanged', beforeRevision: f.document.revision, afterRevision: f.document.revision, affected: [], resources: { assetIds: [], packageIds: [] } } })
    expect(test.commits).toHaveLength(0); expect(test.read().document).toEqual(f.document)
  })

  it('keeps request execution deadlines within the single absolute task budget', () => {
    const f = fixture(), startedAt = 1_000
    expect(generationRequestSchema.parse({ ...f.request, execution: { version: 1, startedAt, deadlineAt: startedAt + MAX_GENERATION_TASK_DURATION_MS } }).execution?.startedAt).toBe(startedAt)
    for (const deadlineAt of [startedAt, startedAt - 1, startedAt + MAX_GENERATION_TASK_DURATION_MS + 1]) {
      expect(generationRequestSchema.safeParse({ ...f.request, execution: { version: 1, startedAt, deadlineAt } }).success).toBe(false)
    }
  })

  it('rejects an expired prepared candidate at the canonical apply boundary without a write', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    try {
      const f = fixture(), test = f.create(), request = { ...f.request, execution: { version: 1 as const, startedAt: 1000, deadlineAt: 1100 } }
      const prepared = await test.coordinator.prepare(request, expandGenerationShortCandidate(f.short, request, f.candidateId))
      vi.setSystemTime(1100)
      expect(test.coordinator.apply(prepared.previewId)).toEqual({ status: 'stale' })
      expect(test.commits).toHaveLength(0); expect(test.read().document).toEqual(f.document)
    } finally { vi.useRealTimers() }
  })
})
