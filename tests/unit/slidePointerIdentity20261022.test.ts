// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { createSlideWorkspaceAuthoringController } from '../../src/renderer/ui/workspaceSlideAuthoring'

const matrix = [1, 0, 0, 1, 0, 0] as const
function fixture() {
  const project = createBlankCourseProjectV10('Original pointer intent')
  project.definitions.box = { id: 'box', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  for (const [id, x] of [['first', 10], ['other', 300]] as const) project.instances[id] = { id, definitionId: 'box', data: {},
    frame: { width: 100, height: 80, transform: [1, 0, 0, 1, x, 10] } }
  const surface = testContainerInstance(project, 0); surface.childIds = ['first', 'other']
  let ids: readonly string[] = []
  const select = vi.fn((next: readonly string[]) => { ids = next }), report = vi.fn()
  const controller = createSlideWorkspaceAuthoringController({
    read: () => ({ project, documentId: 'document', surfaceId: surface.id, selectedInstanceIds: ids, activeStateId: null }),
    select, report, capture: () => ({ documentId: 'document', surfaceId: surface.id, activeStateId: null } as never), async commit() {},
  })
  return { project, controller, select, report }
}

it('resolves the original object ID after ACK even when another object takes its old screen position', () => {
  const f = fixture(), down = { x: 40, y: 30 }, hit = f.controller.captureHit(down, matrix)
  expect(hit).toEqual({ kind: 'object', instanceId: 'first', activeGroupId: null })
  f.project.instances.first.frame!.transform[4] = 500
  f.project.instances.other.frame!.transform[4] = 10
  f.controller.pointerDown(down, matrix, undefined, hit)
  expect(f.select).toHaveBeenLastCalledWith(['first'])
})

it('reports a retired original target without selecting the replacement at that coordinate', () => {
  const f = fixture(), down = { x: 40, y: 30 }, hit = f.controller.captureHit(down, matrix)
  delete f.project.instances.first
  f.project.instances.other.frame!.transform[4] = 10
  f.controller.pointerDown(down, matrix, undefined, hit)
  expect(f.select).not.toHaveBeenCalled()
  expect(f.report).toHaveBeenCalledOnce()
})

it('preserves a blank-down marquee intent when an object appears beneath the original point', () => {
  const f = fixture(), down = { x: 220, y: 30 }, hit = f.controller.captureHit(down, matrix)
  expect(hit).toEqual({ kind: 'blank', activeGroupId: null })
  f.project.instances.other.frame!.transform[4] = 200
  const result = f.controller.pointerDown(down, matrix, undefined, hit)
  expect(result.marquee).toEqual({ start: down, end: down })
  expect(f.select).toHaveBeenLastCalledWith([])
})
