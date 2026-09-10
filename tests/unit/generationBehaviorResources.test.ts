import { describe, expect, it } from 'vitest'
import { attachGenerationBehaviorEvidence } from '@/renderer/authoring/generation/generationBehaviorResources'
import { generationCommitReceiptSchema, generationRequestSchema } from '@/shared/generationContract'
import { dynamicBehaviorObservationSchema } from '@/shared/dynamicBehaviorObservation'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
function fixture() {
  const workspace = { version: 1 as const, projectId: 'formal-project', normalizedPath: 'c:/lessons/formal.h5lesson' }
  const request = generationRequestSchema.parse({
    version: 1, requestId: crypto.randomUUID(), workspace, documentRevision: 2, sessionGeneration: 1,
    purpose: 'local-edit', instruction: '检查当前正式替换的立方体', allowedCarriers: ['runtime'], context: {},
    destinations: [{ kind: 'update', target: { projectId: workspace.projectId, documentRevision: 2,
      revisionPolicy: { kind: 'exact' }, sessionGeneration: 1, surfaceType: 'slide', surfaceId: 'slide', locationId: 'scene',
      stateId: null, owner: 'scene', ownerKey: 'scene:scene', itemId: 'cube', authoringAddress: 'scene/cube' } }],
    observation: { documentRevision: 2, sessionGeneration: 1, draftEpoch: 0, viewEpoch: 1, runtime: null,
      surfaceId: 'slide', locationId: 'scene', stateId: null, source: 'authoring', capturedAt: 1000,
      files: [{ fileId: 'current-frame', relativePath: 'observation/current-frame.png', role: 'image', mediaType: 'image/png', byteLength: atob(png).length }] },
    resourceFiles: [{ path: 'observation/current-frame.png', role: 'image', mediaType: 'image/png', encoding: 'base64', content: png }],
  })
  const evidence = dynamicBehaviorObservationSchema.parse({
    version: 1, status: 'observed', mode: 'full-admission', projectId: workspace.projectId, documentRevision: 1,
    locationId: 'scene', stateId: null, instanceIds: ['cube'], sourceIdentities: { cube: 'actual-candidate-source' },
    actions: ['suspend', 'resume'], elapsedMs: 1000, semanticVerdict: 'requires-review',
    frames: ['running', 'paused', 'resumed'].map((phase, index) => ({ phase, elapsedMs: index * 250, capturedAt: 500 + index * 250,
      stateVersion: 0, publicState: {}, width: 1280, height: 720, dataUrl: `data:image/png;base64,${png}` })),
  })
  const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: crypto.randomUUID(), candidateId: crypto.randomUUID(),
    workspace, status: 'committed', beforeRevision: 1, afterRevision: 2, affected: [], resources: { assetIds: [], packageIds: [] } })
  return { request, evidence, receipt }
}

describe('admission evidence in the next native feedback', () => {
  it('keeps explicit candidate click frames and a compact factual result after commit without labelling them live', () => {
    const { request, evidence, receipt } = fixture()
    evidence.buttonClick = { version: 1, instanceId: 'cube', label: '显示答案', input: 'electron-mouse', x: 120, y: 80,
      beforeText: '答案尚未显示', afterText: '正确答案：一个周期', textTruncated: false,
      clickedAt: 800, observedAt: 900, functionalResult: 'requires-review' }
    evidence.actions.push('click-button')
    evidence.frames.push({ ...evidence.frames[0]!, phase: 'before-button-click' }, { ...evidence.frames[0]!, phase: 'after-button-click' })
    const result = attachGenerationBehaviorEvidence(request, [evidence], receipt)
    expect(result.observation!.files.filter(file => file.role === 'image')).toHaveLength(3)
    expect(result.context).toMatchObject({ behaviorEvidence: { buttonClicks: [{ afterText: '正确答案：一个周期',
      source: 'candidate-host-before-commit', functionalResult: 'requires-review' }] } })
    const metadata = JSON.parse(result.resourceFiles!.find(file => file.path === 'observation/dynamic/behavior.json')!.content)
    expect(metadata.observations[0].frames[0].fileId).toBeUndefined()
    expect(metadata.observations[0].frames[4]).toMatchObject({ phase: 'after-button-click', source: 'candidate-host-before-commit' })
    expect(result.resourceFiles!.find(file => file.path === 'observation/dynamic/0/frame-4.png')!.content).toBe(png)
  })
  it('retains candidate images and their actual resource references when no formal commit exists', () => {
    const { request, evidence } = fixture()
    const result = attachGenerationBehaviorEvidence(request, [evidence])
    const metadata = JSON.parse(result.resourceFiles!.find(file => file.path === 'observation/dynamic/behavior.json')!.content)
    expect(result.observation!.files.filter(file => file.role === 'image')).toHaveLength(4)
    expect(metadata.imageFeedback).toBe('candidate-host-frames')
    expect(metadata.committedCandidate).toBeNull()
    expect(metadata.instruction).toContain('尚未正式提交')
    for (const frame of metadata.observations[0].frames) {
      const file = result.observation!.files.find(file => file.fileId === frame.fileId)!
      const resource = result.resourceFiles!.find(resource => resource.path === file.relativePath)!
      expect(frame.path).toBe(`resources/${resource.path}`)
      expect(resource.content).toBe(png)
      expect(resource.role).toBe('image')
    }
    expect(request.observation!.files).toHaveLength(1)
    expect(evidence.frames[0]!.dataUrl).toBe(`data:image/png;base64,${png}`)
  })

  it('preserves admission diagnostics but never forwards old admission images after a formal commit', () => {
    const { request, evidence, receipt } = fixture()
    const result = attachGenerationBehaviorEvidence(request, [evidence], receipt)
    const metadata = JSON.parse(result.resourceFiles!.find(file => file.path === 'observation/dynamic/behavior.json')!.content)
    expect(result.observation!.files.filter(file => file.role === 'image')).toEqual(request.observation!.files)
    expect(result.resourceFiles!.filter(file => file.role === 'image')).toEqual(request.resourceFiles)
    expect(metadata.imageFeedback).toBe('current-formal-host-only')
    expect(metadata.committedCandidate).toMatchObject({ candidateId: receipt.candidateId, beforeRevision: 1, afterRevision: 2 })
    expect(metadata.observations[0]).toMatchObject({ sourceIdentities: evidence.sourceIdentities, actions: ['suspend', 'resume'] })
    for (const frame of metadata.observations[0].frames) {
      expect(frame.imageAttachment).toBe('not-forwarded-after-commit')
      expect(frame.dataUrl).toBeUndefined()
      expect(frame.fileId).toBeUndefined()
      expect(frame.path).toBeUndefined()
    }
    expect(metadata.instruction).toContain('不代表最终布局、裁剪或速度')
  })

  it('rejects a receipt from another workspace or revision instead of relabeling evidence as current', () => {
    const { request, evidence, receipt } = fixture()
    expect(() => attachGenerationBehaviorEvidence(request, [evidence], { ...receipt,
      workspace: { ...receipt.workspace, normalizedPath: 'c:/lessons/other.h5lesson' } })).toThrow('回执与当前工程观察不一致')
    expect(() => attachGenerationBehaviorEvidence(request, [evidence], { ...receipt, beforeRevision: 0, afterRevision: 1 })).toThrow('回执与当前工程观察不一致')
  })
})
