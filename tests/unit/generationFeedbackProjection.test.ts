// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type { GenerationRequest } from '@/shared/generationContract'
import { MAX_GENERATION_PROMPT_BYTES } from '@/shared/generationContract'
import { withDefaultComponentController } from '@/renderer/components/teacherControllerComponent'

function fixture(instruction = '继续核对并完成本课件', textRepeat = 150, previousResultOverride?: Record<string, unknown>) {
  const { project, componentPackages } = withDefaultComponentController(createBlankCourseProject({ includeDefaultController: true }))
  const surface = project.surfaces.find(value => value.type === 'slide')!
  if (surface.type !== 'slide') throw new Error('Slide required')
  const baseScene = surface.scenes[0]!
  const baseLocation = project.locations.find(location => location.kind === 'slide-scene')
  if (!baseLocation || baseLocation.kind !== 'slide-scene') throw new Error('Slide location required')
  for (let index = 1; index < 6; index++) {
    const id = `feedback-scene-${index}`
    surface.scenes.push({ ...structuredClone(baseScene), id })
    project.locations.push({ ...baseLocation, id, sceneId: id, label: `位置${index + 1}` })
  }
  for (const [sceneIndex, scene] of surface.scenes.entries()) {
    scene.layerItems.push(...Array.from({ length: 8 }, (_, itemIndex) => sceneNodeToCourseLayerItem(
      createTextNode({ id: `feedback-text-${sceneIndex}-${itemIndex}`, text: `${sceneIndex}-${itemIndex}-${'可读取的课件正文'.repeat(textRepeat)}` }),
      itemIndex + 2,
    )))
  }
  project.revision = 20
  const locationId = baseLocation.id
  const projection = projectEffectiveLayers({ project, locationId })
  const workspace = { version: 1 as const, projectId: project.id, normalizedPath: '/feedback.h5lesson' }
  const sessionToken = { locationId, surfaceType: projection.surfaceType, revision: project.revision, generation: 1 }
  const previousResult = previousResultOverride ?? { version: 1, requestId: crypto.randomUUID(), candidateId: crypto.randomUUID(), status: 'committed',
    beforeRevision: 19, afterRevision: 20, summary: '已提交本阶段', affected: [], resources: { assetIds: [], packageIds: [] } }
  const snapshot = captureGenerationSnapshot({ document: project, workspace, sessionToken, projection, selectedIds: [], scope: 'course',
    instruction, purpose: 'single-page', intent: 'edit', expectedResult: 'auto',
    previousResult, componentPackages })
  return { project, workspace, snapshot, previousResult }
}

describe('generation feedback page projection', () => {
  it('keeps course identity and full target artifacts while compacting non-active pages', () => {
    const { project, snapshot } = fixture(), context = snapshot.context as any
    expect(context.reference).toBe('course')
    expect(context.pageProjection).toMatchObject({ version: 1, mode: 'non-current-summary', fullPages: 'resources/project/targets.json' })
    expect(context.pages).toHaveLength(6)
    expect(context.pages[0].items).toBeDefined()
    expect(context.pages[1].items).toBeUndefined()
    expect(context.pages[1].summary.items[0]).toEqual(expect.objectContaining({ id: 'feedback-text-1-0', kind: 'native' }))
    expect(context.pages[1].details).toMatchObject({ source: 'resources/project/targets.json', locationId: 'feedback-scene-1' })
    expect(snapshot.taskFacts?.indexes).toHaveLength(project.locations.length)
    const { resourceFiles: _resourceFiles, ...promptProjection } = snapshot
    expect(Buffer.byteLength(JSON.stringify(promptProjection), 'utf8')).toBeLessThanOrEqual(MAX_GENERATION_PROMPT_BYTES - 16000)
    const targetFile = snapshot.resourceFiles!.find(file => file.path === 'project/targets.json')!
    const fullTargets = JSON.parse(targetFile.content)
    expect(fullTargets.pages).toHaveLength(project.locations.length)
    expect(fullTargets.pages[1].items[0].item.content.data.text).toContain('可读取的课件正文')
  })

  it('falls back to all page summaries when the task instruction consumes the margin', () => {
    const { snapshot } = fixture('继续核对并完成本课件', 2000), context = snapshot.context as any
    expect(context.pageProjection).toMatchObject({ version: 1, mode: 'all-summary' })
    expect(context.pages.every((page: any) => page.items === undefined && page.summary)).toBe(true)
  })

  

  it('resourceizes a large committed receipt before the rev21 prompt budget check', () => {
    const receipt = { version: 1, requestId: crypto.randomUUID(), candidateId: crypto.randomUUID(), status: 'committed',
      beforeRevision: 20, afterRevision: 21, summary: '已提交 rev21 阶段', affected: [], resources: { assetIds: [], packageIds: [] },
      semanticChanges: { changes: Array.from({ length: 120 }, (_, index) => ({ path: `pages[${index}].text`, before: 'x'.repeat(450), after: 'y'.repeat(450), kind: 'updated', field: 'text' })), omitted: 0,
        comparison: { status: 'complete', scopes: [{ scope: 'document', status: 'complete' }] }, truncation: { changeLimit: 200, valueLengthLimit: 500, omittedChanges: 0, truncatedValues: 0 } } }
    const { snapshot } = fixture('继续核对并完成本课件', 150, receipt)
    const context = snapshot.context as any
    expect(context.previousResult).toMatchObject({ beforeRevision: 20, afterRevision: 21, fullReceipt: 'resources/project/previous-result.json' })
    expect(JSON.parse(snapshot.resourceFiles!.find(file => file.path === 'project/previous-result.json')!.content)).toEqual(receipt)
    const { resourceFiles: _resourceFiles, ...promptProjection } = snapshot
    expect(Buffer.byteLength(JSON.stringify(promptProjection), 'utf8')).toBeLessThanOrEqual(MAX_GENERATION_PROMPT_BYTES - 16000)
  })
})
