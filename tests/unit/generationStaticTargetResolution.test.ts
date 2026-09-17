import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { JSONType } from 'zod'
import { generationRequestSchema, type GenerationCandidate } from '../../src/shared/generationContract'
import { checkGenerationStaticPrecheck } from '../../src/shared/generationStaticPrecheck'
import { resolveSlideInteractionTarget, type SlideInteractionTargetIndex } from '../../src/shared/slideInteractionTargetResolver'

const scope = {
  projectId: 'project-1', documentRevision: 0, revisionPolicy: { kind: 'exact' as const }, sessionGeneration: 1,
  surfaceType: 'slide' as const, surfaceId: 'surface-1', locationId: 'location-1', stateId: null,
  owner: 'scene' as const, ownerKey: 'scene-1', parent: { kind: 'owner' as const }, insertion: { kind: 'append' as const },
}

function request(index: SlideInteractionTargetIndex) {
  return generationRequestSchema.parse({ version: 1, requestId: randomUUID(), workspace: {
    version: 1, projectId: scope.projectId, normalizedPath: 'c:/lesson.h5lesson',
  }, documentRevision: scope.documentRevision, sessionGeneration: scope.sessionGeneration, purpose: 'local-edit',
    instruction: '配置互动', destinations: [{ kind: 'create', scope }], context: {}, allowedCarriers: ['native'],
    taskFacts: { version: 1, projectId: scope.projectId, documentRevision: 0, sessionGeneration: 1, source: 'frozen-project',
      indexes: [index], components: [], relations: [] },
  })
}

function candidate(rawInput: JSONType, prior: GenerationCandidate['steps'][number][] = []): GenerationCandidate {
  return { version: 1, requestId: '00000000-0000-4000-8000-000000000001', candidateId: randomUUID(), summary: '互动候选',
    afterCommit: { version: 1, action: 'finish' }, steps: [...prior, { id: 'interaction', tool: 'slide.interaction', carrier: 'native',
      destination: { kind: 'create', scope }, input: rawInput }] }
}

const completeIndex = (items: SlideInteractionTargetIndex['items']): SlideInteractionTargetIndex => ({
  locationId: scope.locationId, surfaceId: scope.surfaceId, stateId: scope.stateId,
  scope: 'applicable-location-items', completeness: 'complete', items,
})

describe('generation static Slide interaction target resolution', () => {
  it('U05-complete-resolution shares ID-first and unique-label diagnostics with the live tool', () => {
    const index = completeIndex([{ id: 'button-1', label: '开关' }, { id: 'explanation', label: '解释' }])
    const valid = checkGenerationStaticPrecheck(candidate({ operation: 'compose', trigger: { kind: 'click', node: '开关' }, effects: [{ kind: 'show', nodes: ['explanation'] }] }), request(index))
    expect(valid).toEqual([])
    const bad = checkGenerationStaticPrecheck(candidate({ operation: 'compose', trigger: { kind: 'click', node: '不存在' }, effects: [{ kind: 'show', nodes: ['explanation'] }] }), request(index))
    expect(bad).toEqual([expect.objectContaining({ stepId: 'interaction', code: 'compose-node-not-found', path: ['input', 'trigger', 'node'] })])
    const ambiguous = completeIndex([{ id: 'button-1', label: '相同' }, { id: 'button-2', label: '相同' }])
    expect(checkGenerationStaticPrecheck(candidate({ operation: 'compose', trigger: { kind: 'click', node: '相同' }, effects: [{ kind: 'show', nodes: ['button-1'] }] }), request(ambiguous)))
      .toMatchObject([{ code: 'compose-node-ambiguous', path: ['input', 'trigger', 'node'] }])
    expect(resolveSlideInteractionTarget({ index, reference: 'button-1', what: '互动目标', path: ['input'] })).toEqual({ status: 'resolved', itemId: 'button-1' })
  })

  it('U05-deferred leaves partial facts and preceding location mutations to the host', () => {
    const partial = completeIndex([{ id: 'button-1', label: '开关' }])
    partial.completeness = 'partial'
    const input = { operation: 'compose', trigger: { kind: 'click', node: 'new-item' }, effects: [{ kind: 'show', nodes: ['new-item'] }] }
    expect(resolveSlideInteractionTarget({ index: partial, reference: 'new-item', what: '互动目标', path: ['input', 'trigger', 'node'] }).status).toBe('deferred')
    expect(checkGenerationStaticPrecheck(candidate(input), request(partial))).toEqual([])
    const prior = { id: 'create-item', tool: 'native.content', carrier: 'native' as const, destination: { kind: 'create' as const, scope }, input: { operation: 'insert' } }
    expect(checkGenerationStaticPrecheck(candidate(input, [prior]), request(completeIndex([{ id: 'button-1', label: '开关' }])))).toEqual([])
    const priorResult = { ...prior, destination: { kind: 'created-item' as const, stepId: 'earlier', index: 0 } }
    expect(checkGenerationStaticPrecheck(candidate(input, [priorResult]), request(completeIndex([{ id: 'button-1', label: '开关' }])))).toEqual([])

    for (const tool of ['selection.delete', 'selection.replace', 'project.document', 'media.apply']) {
      const mutation = { id: `prior-${tool}`, tool, carrier: 'native' as const, destination: { kind: 'create' as const, scope }, input: { operation: 'mutate' } }
      expect(checkGenerationStaticPrecheck(candidate(input, [mutation]), request(completeIndex([{ id: 'button-1', label: '开关' }])))).toEqual([])
    }

    const crossLocationGlobalMutation = {
      id: 'rename-global', tool: 'native.content', carrier: 'native' as const,
      destination: { kind: 'update' as const, target: { ...scope, locationId: 'other-location', owner: 'global' as const, ownerKey: 'global', itemId: 'global-item', authoringAddress: 'courseware://authoring/project-1/global/global-item' } },
      input: { operation: 'edit-label', label: '改名后的全局图层' },
    }
    expect(checkGenerationStaticPrecheck(candidate(input, [crossLocationGlobalMutation]), request(completeIndex([{ id: 'button-1', label: '开关' }])))).toEqual([])
  })
})
