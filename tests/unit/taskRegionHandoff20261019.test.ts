// @vitest-environment node
import { expect, it } from 'vitest'
import { artifactGroupInput } from '../../src/core/tools/artifactGroup'
import { taskTargetDeclaration, taskTargetRegion, taskTargetViewport } from '../../src/shared/workbench/taskTargetContext'

const region = { width: 640, height: 360, transform: [1, 0, 0, 1, 320, 180] as [number, number, number, number, number, number] }
const destination = { documentId: 'doc', epoch: 'epoch', target: { kind: 'container', container: { kind: 'surface', surfaceId: 'page' } } }
const context = { ...destination, revision: 4, path: 'page.structure.json', region,
  viewport: { width: 1280, height: 720 } }

it('carries the host-frozen region with candidate bytes and derives one local viewport', () => {
  const metadata = { targetContext: structuredClone(context) }
  const input = artifactGroupInput('candidate.html', [{ name: 'candidate.html', bytes: new TextEncoder().encode('<button>Run</button>') }], metadata)
  expect(taskTargetViewport(input.metadata?.targetContext)).toEqual({ width: 640, height: 360 })
  expect(taskTargetRegion(input.metadata?.targetContext, destination)).toEqual(region)
  metadata.targetContext.region.width = 700
  expect(taskTargetViewport(input.metadata?.targetContext)).toEqual({ width: 640, height: 360 })
})

it('does not invent a region from an observed full-page viewport, unrelated destination, or reopened document', () => {
  const unresolved = { ...destination, viewport: { width: 1280, height: 720 }, regionStatus: 'unresolved' }
  expect(taskTargetViewport(unresolved)).toEqual(unresolved.viewport)
  expect(taskTargetRegion(unresolved, destination)).toBeUndefined()
  expect(taskTargetRegion(context, { ...destination, epoch: 'reopened' })).toBeUndefined()
  expect(taskTargetRegion(context, { ...destination, target: { kind: 'container', container: { kind: 'surface', surfaceId: 'other-page' } } })).toBeUndefined()
  expect(taskTargetViewport({ regionStatus: 'unresolved' })).toBeUndefined()
})

it('keeps placement reusable across unrelated revisions and confines it to its captured presentation', () => {
  const frozen = { ...context, editingContext: { surfaceId: 'page', stateId: 'state' } }
  expect(taskTargetRegion(frozen, { ...destination, editingContext: frozen.editingContext })).toEqual(context.region)
  expect(taskTargetRegion(frozen, destination)).toBeUndefined()
  expect(taskTargetRegion(context, { ...destination, editingContext: frozen.editingContext })).toBeUndefined()
})

it('restores the declared target for resume without converting old object geometry into a region', () => {
  const declaration = taskTargetDeclaration({ ...context, project: 'current-project', regionStatus: 'explicit' })!
  expect(declaration).toEqual({ path: context.path, project: 'current-project', region })
  declaration.region!.width = 700
  expect(region.width).toBe(640)
  expect(taskTargetDeclaration({ path: 'object.content.html', frame: region, regionStatus: 'current-object' }))
    .toEqual({ path: 'object.content.html' })
  expect(taskTargetDeclaration({ path: context.path, viewport: context.viewport, regionStatus: 'unresolved' }))
    .toEqual({ path: context.path })
  expect(taskTargetDeclaration({ regionStatus: 'unresolved' })).toBeUndefined()
  expect(taskTargetDeclaration({ path: context.path, regionStatus: 'explicit', region: { width: -1 } }))
    .toEqual({ path: context.path })
})
