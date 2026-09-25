import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { generationRequestSchema, readGenerationFailure } from '@/shared/generationContract'
import { dynamicBehaviorObservationSchema } from '@/shared/dynamicBehaviorObservation'

const execute = vi.hoisted(() => vi.fn())
vi.mock('@/renderer/authoring/tools/authoringToolFacade', () => ({ createAuthoringToolFacade: () => ({ execute }) }))

describe('structured candidate preparation failure', () => {
  it('retains step diagnostics, resource identities and earlier plus failed behavior evidence with zero live writes', async () => {
    const document = createBlankCourseProject(), surface = document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('fixture requires Slide')
    const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace: { version: 1, projectId: document.id, normalizedPath: 'c:/lessons/failure.h5lesson' },
      documentRevision: document.revision, sessionGeneration: 1, purpose: 'local-edit', instruction: '更新两个互动参数', context: {}, allowedCarriers: ['existing-component'],
      destinations: [{ kind: 'create', scope: { projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
        surfaceType: 'slide', surfaceId: surface.id, locationId: document.startLocationId, stateId: null, owner: 'scene', ownerKey: `scene:${surface.scenes[0]!.id}`, parent: { kind: 'owner' }, insertion: { kind: 'append' } } }] })
    const evidence = (id: string) => dynamicBehaviorObservationSchema.parse({ version: 1, status: 'observed', mode: 'public-props', projectId: document.id, documentRevision: document.revision,
      locationId: document.startLocationId, stateId: null, instanceIds: [id], sourceIdentities: { [id]: 'source-identity' }, actions: ['update-inputs'], elapsedMs: 1, semanticVerdict: 'requires-review',
      frames: [{ phase: 'running', elapsedMs: 1, capturedAt: 1, stateVersion: 1, publicState: { [id]: { speed: 0.5 } }, width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }] })
    const first = evidence('first'), failed = evidence('failed'), diagnostics = [{ code: 'dynamic-host-failed', message: 'updateProps failed', path: ['locations', document.startLocationId, 'instances', 'failed', 'props', 'speed'] }]
    const receipt = { version: 1, requestId: 'fixture', tool: 'component.configure', destination: request.destinations[0], beforeRevision: 0, afterRevision: 0, affected: [] }
    execute.mockResolvedValueOnce({ ...receipt, status: 'unchanged', diagnostics: [], resources: { assetIds: ['known-asset'], packageIds: ['known-package'] }, behaviorEvidence: [first] })
      .mockResolvedValueOnce({ ...receipt, status: 'failed', diagnostics, resources: { assetIds: [], packageIds: [] }, behaviorEvidence: [failed] })
    const commit = vi.fn(), resources = { assetFiles: {}, componentPackages: {} }, before = structuredClone(document)
    const coordinator = createGenerationCandidateCoordinator({ readDocument: () => document, readResources: () => resources, readWorkspace: () => request.workspace, readSessionGeneration: () => 1, commit })
    const candidateId = crypto.randomUUID(), candidate = { version: 1, requestId: request.requestId, candidateId, summary: '更新参数', steps: ['first', 'failed'].map(id => ({ id, tool: 'component.configure', carrier: 'existing-component', destination: request.destinations[0], input: { operation: 'update', packageId: 'input-package', staticFallback: { assetId: 'input-asset' } } })) }
    const error = await coordinator.prepare(request, candidate).catch(value => value)
    expect(readGenerationFailure(error)).toEqual({ version: 1, stage: 'dynamic-admission', requestId: request.requestId, candidateId, stepId: 'failed', tool: 'component.configure', destination: request.destinations[0], diagnostics,
      recovery: { action: 'repair-candidate', message: '生成的组件/Runtime 在真实宿主准入中失败：按诊断中的实例与字段修正实现后重交同一任务候选；这是实现缺陷而非运输故障，不原样重试，也不退化为截图或静态替代。' },
      assetIds: ['input-asset', 'known-asset'], packageIds: ['input-package', 'known-package'], behaviorEvidence: [first, failed] })
    expect(commit).not.toHaveBeenCalled(); expect(document).toEqual(before)
  })
})
