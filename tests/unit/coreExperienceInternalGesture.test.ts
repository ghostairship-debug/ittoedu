// @vitest-environment node
import { expect, it } from 'vitest'
import { IDENTITY_MATRIX, frameCorners, transformPoint } from '../../src/core/components/geometry'
import { FreeTransformGesture, LocalAuthorTransformGesture } from '../../src/renderer/componentPlatform/surfaces/slide/freeTransformGesture'
import type { FreeObjectTarget } from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import type { ComponentAuthorSpot, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { authorSpotGeometryEdits } from '../../src/renderer/componentPlatform/surfaces/slide/authorSpots'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'

const target = (image = false): FreeObjectTarget => ({ instanceId: 'local-target', frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 40, 30] },
  parentToSurface: [2, 0, 0, 2, 80, 50], parent: { kind: 'instance', instanceId: 'web' }, ancestors: ['web'], preserveAspectRatio: image })

it('resizes text content width through the parent and host matrix once without scaling glyphs or changing neighbors', () => {
  const original = target(), frozen = structuredClone(original), host = [0.5, 0, 0, 0.5, 100, 20] as const
  const corner = frameCorners(original.frame, original.parentToSurface)[1], pointer = transformPoint(host, corner)
  const gesture = new FreeTransformGesture({ mode: 'resize', resizeMode: 'box', handle: 'e', targets: [original], pointer, surfaceToPointer: host })
  const [edit] = gesture.update({ x: pointer.x + 80, y: pointer.y }).edits
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected content box')
  expect(edit.frame).toEqual({ width: 280, height: 100, transform: [1, 0, 0, 1, 40, 30] })
  expect(original).toEqual(frozen)
})

it('scales an image uniformly and starts every update from its frozen frame', () => {
  const original = target(true), pointer = frameCorners(original.frame, original.parentToSurface)[1]
  const gesture = new FreeTransformGesture({ mode: 'resize', handle: 'e', targets: [original], pointer, surfaceToPointer: IDENTITY_MATRIX })
  gesture.update({ x: pointer.x + 20, y: pointer.y })
  const [edit] = gesture.update({ x: pointer.x + 200, y: pointer.y }).edits
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected image scaling')
  expect(edit.frame.width).toBe(200)
  expect(edit.frame.height).toBe(100)
  expect(edit.frame.transform.slice(0, 4)).toEqual([1.5, 0, 0, 1.5])
})

it('compiles border-box width and parent-scaled movement into existing content-box and author increments', () => {
  const geometry = { frame: { width: 240, height: 80, transform: [1, 0, 0, 1, 40, 30] as [number, number, number, number, number, number] },
    parentToInstance: [2, 0, 0, 2, 80, 50] as [number, number, number, number, number, number], author: { translateX: 12, width: 200 }, boxInsets: { width: 40, height: 20 } }
  const root = [0.5, 0, 0, 0.5, 0, 0] as const, pointer = transformPoint(root, frameCorners(geometry.frame, geometry.parentToInstance)[1])
  const resize = new LocalAuthorTransformGesture({ geometry, kind: 'text', mode: 'resize', handle: 'e', rootToSurface: root, surfaceToPointer: IDENTITY_MATRIX, pointer })
  expect(resize.update({ x: pointer.x + 60, y: pointer.y }).geometry).toEqual({ width: 260 })
  const drag = new LocalAuthorTransformGesture({ geometry, kind: 'text', mode: 'drag', rootToSurface: root, surfaceToPointer: IDENTITY_MATRIX, pointer })
  drag.update({ x: pointer.x + 10, y: pointer.y })
  expect(drag.update({ x: pointer.x + 50, y: pointer.y }).geometry).toEqual({ translateX: 62 })
  expect(geometry.author).toEqual({ translateX: 12, width: 200 })
})

it('commits the completed local gesture once through canonical History and undoes the whole drag', async () => {
  const geometry = { frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 20, 10] as [number, number, number, number, number, number] },
    parentToInstance: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], author: {}, boxInsets: { width: 0, height: 0 } }
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'local-drag', revision: 0, title: 'Local drag', assets: {},
    definitions: { web: { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } } },
    instances: { web: { id: 'web', definitionId: 'web', data: { html: '<p>Original</p>' }, frame: { width: 400, height: 300, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['web'], designSize: { width: 800, height: 600 } }], global: { underlay: [], overlay: [] } }
  const spot: ComponentAuthorSpot = { id: 'observed', instanceId: 'web', mountGeneration: 1, authorKey: 'local-text', kind: 'text',
    binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, initialValue: 'Original', localBounds: geometry.frame, geometry }
  const gesture = new LocalAuthorTransformGesture({ geometry, kind: 'text', mode: 'drag', rootToSurface: IDENTITY_MATRIX, surfaceToPointer: IDENTITY_MATRIX, pointer: { x: 30, y: 20 } })
  gesture.update({ x: 50, y: 20 })
  const next = gesture.update({ x: 80, y: 40 })
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'drag' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver, { async append() {}, async save() { throw new Error('unused') } })
  const command = captureComponentOperation(project, authorSpotGeometryEdits(project, spot, next.geometry))
  const result = await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: 0, operationId: 'gesture', actor: 'human', mutation: { type: 'command', command } })
  expect(result.status).toBe('applied')
  expect(session.read().undoDepth).toBe(1)
  const model = session.read().model
  if (model.kind !== 'course-v10') throw new Error('Expected course')
  expect(model.project.instances.web.data).toMatchObject({ authoringRecords: { 'local-text': { overrides: { geometry: { translateX: 50, translateY: 20 } } } } })
  expect(model.project.instances.web.frame).toEqual(project.instances.web.frame)
  await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: session.read().revision, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })
  const undone = session.read().model
  expect(undone.kind === 'course-v10' && undone.project.instances.web.data).toEqual(project.instances.web.data)
})
