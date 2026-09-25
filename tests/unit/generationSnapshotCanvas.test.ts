// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { captureGenerationFixture as captureGenerationSnapshot } from '../fixtures/generationSnapshot'
import { type GenerationReferenceScope } from '../../src/renderer/authoring/generation/generationSnapshot'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { projectEffectiveLayers } from '../../src/renderer/course/effectiveLayerProjection'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { generationRequestSchema, type GenerationRequest } from '../../src/shared/generationContract'
import { localAgentRequestSchema, localAgentResponseSchema, type LocalAgentCapabilities, type LocalAgentId } from '../../src/shared/localAgentContract'
import type { LocalAgentCliAdapterV2, LocalAgentNativeEvent } from '../../src/shared/localAgentTaskContract'
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

  
})
