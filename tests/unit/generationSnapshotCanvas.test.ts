// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { captureGenerationFixture as captureGenerationSnapshot } from '../fixtures/generationSnapshot'
import { type GenerationReferenceScope } from '../../src/renderer/authoring/generation/generationSnapshot'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { projectEffectiveLayers } from '../../src/renderer/course/effectiveLayerProjection'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { generationRequestSchema, type GenerationRequest } from '../../src/shared/generationContract'
import { localAgentRequestSchema, localAgentResponseSchema, type LocalAgentCapabilities, type LocalAgentId } from '../../src/shared/localAgentContract'
import type { LocalAgentCliAdapterV2, LocalAgentNativeEvent } from '../../src/shared/localAgentTaskContract'
import { LocalAgentHarness } from '../../src/main/localAgent/harness'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'

type Page = { location: { id: string }; canvas?: { width: number; height: number } }
const pages = (request: Pick<GenerationRequest, 'context'>) => (request.context as { pages: Page[] }).pages
function fixture() {
  const document = createBlankCourseProject(), other = createBlankCourseProject(), flow = createBlankFlowCourseProject()
  const first = document.surfaces[0]!, second = other.surfaces[0]!
  if (first.type !== 'slide' || second.type !== 'slide') throw new Error('Slide fixture required')
  const title = createTextNode({ id: 'canvas-title', text: '标题' })
  first.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(title, 0))
  document.surfaces.push(...other.surfaces, ...flow.surfaces); document.locations.push(...other.locations, ...flow.locations)
  function capture(scope: GenerationReferenceScope = 'selection', projectPath = path.resolve('canvas-unit.h5lesson'), locationId = document.startLocationId) {
    const projection = projectEffectiveLayers({ project: document, locationId })
    return captureGenerationSnapshot({ document, workspace: createWorkspaceIdentity(document.id, projectPath),
      sessionToken: { locationId, surfaceType: projection.surfaceType, revision: document.revision, generation: 1 },
      projection, selectedIds: [title.id], scope, instruction: '说明页面尺寸并判断标题是否居中', purpose: 'local-edit', expectedResult: 'auto', intent: 'discuss' })
  }
  return { document, first, second, flow, other, capture }
}

describe('current Slide canvas dimensions in generation snapshots', () => {
  it.each(['selection', 'page', 'course'] as const)('reads the formal Slide canvas for %s scope', scope => {
    const f = fixture(), canvas = f.first.canvas
    const readCanvas = vi.fn(() => canvas)
    Object.defineProperty(f.first, 'canvas', { configurable: true, enumerable: true, get: readCanvas })
    const request = f.capture(scope)
    expect(readCanvas).toHaveBeenCalled()
    expect(pages(request)[0]!.canvas).toEqual({ width: 1280, height: 720 })
    expect(pages(request)[0]!.canvas).not.toBe(canvas)
    if (scope === 'course') {
      expect(pages(request).find(page => page.location.id === f.other.startLocationId)!.canvas).toEqual(f.second.canvas)
      expect(pages(request).find(page => page.location.id === f.flow.startLocationId)).not.toHaveProperty('canvas')
    }
  })
  it('keeps current dimensions in each new snapshot without aliasing the live Surface or prior snapshot', () => {
    const f = fixture(), before = f.capture()
    f.first.canvas = { width: 1280, height: 720 }; f.document.revision += 1
    const after = f.capture()
    expect(pages(before)[0]!.canvas).toEqual({ width: 1280, height: 720 })
    expect(pages(after)[0]!.canvas).toEqual(f.first.canvas)
    expect(pages(after)[0]!.canvas).not.toBe(f.first.canvas)
    expect(pages(after)[0]!.canvas).not.toBe(pages(before)[0]!.canvas)
    expect(after.documentRevision).toBe(before.documentRevision + 1)
  })
  it('does not invent a Slide canvas for Flow, and old requests without canvas remain readable', () => {
    const f = fixture()
    expect(pages(f.capture('page', undefined, f.flow.startLocationId))[0]).not.toHaveProperty('canvas')
    const old = f.capture(); delete pages(old)[0]!.canvas
    expect(pages(generationRequestSchema.parse(old))[0]).not.toHaveProperty('canvas')
  })

  it.each(['codex', 'claude', 'opencode'] as const)('preserves canvas through strict IPC, actual Main storage, candidate request and %s prompt', async adapterId => {
    // The adapter is a deterministic unit port. Main's public harness, repository,
    // filesystem staging, strict parsers and prompt producer execute normally.
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-main-roundtrip-'))
    const f = fixture(), request = f.capture('course', path.join(directory, 'lesson.h5lesson'))
    const raw = localAgentRequestSchema.parse({ operation: 'generate', projectId: request.workspace.projectId,
      projectPath: request.workspace.normalizedPath, adapter: adapterId, request })
    if (raw.operation !== 'generate') throw new Error('Generate request required')
    let turn!: Parameters<LocalAgentCliAdapterV2['startTurn']>[0]
    let candidateRequest!: GenerationRequest
    const capabilities: LocalAgentCapabilities = { version: 1, adapter: adapterId, cliVersion: 'unit-port',
      models: [{ id: 'default', resolvedModel: null, label: 'Default', image: 'unknown', effort: { kind: 'unsupported' } }],
      current: { model: 'default', resolvedModel: null, effort: null },
      input: { image: 'unknown', readFile: 'supported', question: 'structured', correction: 'turn-boundary', cancel: 'supported' } }
    const adapter: LocalAgentCliAdapterV2 = {
      id: adapterId,
      async open(input) { candidateRequest = JSON.parse(await fs.readFile(path.join(input.candidateRoot!, 'request.json'), 'utf8')); return { externalSessionId: 'unit-native', capabilities } },
      async configure() { return capabilities },
      async startTurn(input) { turn = input; return { nativeTurnId: 'unit-turn' } },
      async input() { throw new Error('Unit test does not send follow-up input') },
      async *events(): AsyncIterable<LocalAgentNativeEvent> {
        const identity = { taskId: turn.taskId, epoch: turn.epoch, workspace: turn.workspace, runId: turn.runId, nativeTurnId: 'unit-turn' }
        yield { ...identity, kind: 'configuration', capabilities }
        yield { ...identity, kind: 'text', phase: 'body', itemId: 'reply', operation: 'replace', text: '只读尺寸确认' }
        yield { ...identity, kind: 'turn-ended', status: 'completed', failure: null }
      },
      async close() {},
    }
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => adapter)
    try {
      const id = await harness.generate(request.workspace, adapterId as LocalAgentId, raw.request)
      await expect.poll(() => harness.running).toBe(false)
      const reopened = await new LocalAgentRepository(directory).list(request.workspace)
      const stored = localAgentResponseSchema.parse({ enabled: true, records: reopened.records }).records!.find(record => record.id === id)!
      expect(stored.status).toBe('completed')
      expect(pages(stored.generationRequest!)).toEqual(pages(request))
      expect(pages(candidateRequest)).toEqual(pages(request))
      const wire = JSON.parse(turn.text.split('\n').at(-1)!) as GenerationRequest
      const aliases = (candidateRequest as GenerationRequest & { destinationAliases: Record<string, { kind: string; target?: unknown }> }).destinationAliases
      const expandedPages = pages(wire).map(page => ({ ...page,
        backgrounds: (page as any).backgrounds?.map((background: any) => {
          expect(typeof background.target).toBe('string')
          const destination = aliases[background.target]!
          expect(destination.kind).toBe('update')
          return { ...background, target: destination.target }
        }),
      }))
      expect(expandedPages).toEqual(pages(request))
      expect(pages(wire).map(page => page.canvas)).toEqual(pages(request).map(page => page.canvas))
      expect(stored.generationRequest!.documentRevision).toBe(request.documentRevision)
    } finally {
      await harness.close()
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
