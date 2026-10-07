// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { IDENTITY_MATRIX, composeMatrices, frameCorners, matrixAroundPoint, rotationMatrix, scaleMatrix, transformPoint, translationMatrix } from '../../src/core/components/geometry'
import { FreeTransformGesture, LocalAuthorTransformGesture } from '../../src/renderer/componentPlatform/surfaces/slide/freeTransformGesture'
import type { FreeObjectTarget } from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import type { ComponentAuthorSpot, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { authorSpotEdits, authorSpotGeometryEdits } from '../../src/renderer/componentPlatform/surfaces/slide/authorSpots'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { registerRuntimeLightEditDocument, runtimeLightEditCommands } from '../../src/renderer/composition/runtime/runtimeLightEditCommands'
import type { CapturedComponentOperation, CapturedCourseTarget, CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'

vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: { getState: () => ({ courseView: { activeDocumentId: 'doc' } }) } }))

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

it('keeps the intended handle frame when the source rotates around its center and that center changes with text width', () => {
  const source = rotationMatrix(Math.PI / 6), origin = { x: 100, y: 50 }, base = matrixAroundPoint(source, origin)
  const geometry = { frame: { width: 200, height: 100, transform: [...composeMatrices(translationMatrix(40, 60), base)] as [number, number, number, number, number, number] },
    parentToInstance: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], author: {}, boxInsets: { width: 0, height: 0 },
    sourceOffset: { current: { x: base[4], y: base[5] }, widthDelta: { x: (1 - source[0]) / 2, y: -source[1] / 2 },
      heightDelta: { x: -source[2] / 2, y: (1 - source[3]) / 2 } } }
  const parent = [0.7, 0, 0, 0.7, 80, 20] as const, at = (x: number, y: number) => transformPoint(parent, transformPoint(geometry.frame.transform, { x, y }))
  for (const kind of ['text', 'image'] as const) {
    const gesture = new LocalAuthorTransformGesture({ geometry, kind, mode: 'resize', handle: 'e', rootToSurface: parent,
      surfaceToPointer: IDENTITY_MATRIX, pointer: at(200, 50) })
    const update = gesture.update(at(250, 50)), patch = update.geometry
    const nextWidth = patch.width ?? 200, nextHeight = patch.height ?? 100
    const consumed = composeMatrices(translationMatrix(40, 60), translationMatrix(patch.translateX ?? 0, patch.translateY ?? 0),
      rotationMatrix((patch.rotation ?? 0) * Math.PI / 180), scaleMatrix(patch.scaleX ?? 1, patch.scaleY ?? patch.scaleX ?? 1),
      matrixAroundPoint(source, { x: nextWidth / 2, y: nextHeight / 2 }))
    update.frame.transform.forEach((expected, index) => expect(consumed[index]).toBeCloseTo(expected, 8))
    if (kind === 'text') expect(patch.width).toBeCloseTo(250)
    else expect(patch.scaleX).toBeCloseTo(1.25)
  }
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

it('anchors one static same-looking object in its source transaction and binds only that object after cold serialization', () => {
  const html = '<html><body><p>same</p><p>same</p></body></html>', from = html.lastIndexOf('same')
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'static-anchor', revision: 0, title: 'Static', assets: {},
    definitions: { web: { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } } },
    instances: { web: { id: 'web', definitionId: 'web', data: { html }, frame: { width: 400, height: 300, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['web'] }], global: { underlay: [], overlay: [] } }
  const spot: ComponentAuthorSpot = { id: 'static-second', instanceId: 'web', mountGeneration: 1, authorKey: 'second-same', kind: 'text', bindingStatus: 'unresolved',
    binding: { kind: 'dom', path: [{ tag: 'body', index: 0 }, { tag: 'p', index: 1 }], textIndex: 0, baseline: 'same' }, initialValue: 'same',
    sourceRegion: { kind: 'data', path: ['html'], start: from, end: from + 4, encoding: 'html-text' },
    localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 30] } }
  const edits = authorSpotGeometryEdits(project, spot, { translateX: 42 })
  const next = applyComponentOperation(project, captureComponentOperation(project, edits))
  const driver = new CourseV10Driver(), cold = driver.load(driver.serialize({ kind: 'course-v10', project: next, resources: { assets: {}, components: {} } }))
  if (cold.kind !== 'course-v10') throw new Error('Expected course')
  const data = cold.project.instances.web.data as { html: string; authoringRecords: Record<string, any> }, frame = document.createElement('iframe')
  document.body.append(frame)
  const doc = frame.contentDocument!
  doc.open(); doc.write(data.html); doc.close()
  const runtime = createDomAuthoring(doc.documentElement, { records: () => data.authoringRecords })
  const paragraphs = doc.querySelectorAll('p')
  expect(paragraphs[0].style.getPropertyValue('translate')).toBe('')
  expect(paragraphs[1].style.getPropertyValue('translate')).toContain('42px')
  expect(paragraphs[0].textContent).toBe('same')
  expect(paragraphs[1].textContent).toBe('same')
  expect(paragraphs[1].getAttribute('data-cw-author-key')).toBe('second-same')
  const changed = applyComponentOperation(cold.project, captureComponentOperation(cold.project, authorSpotEdits(cold.project,
    { ...spot, binding: data.authoringRecords['second-same'].binding, bindingStatus: 'bound' }, 'Changed', { assets: {}, components: {} })))
  const changedData = changed.instances.web.data as typeof data
  expect(changedData.html).toBe(data.html)
  data.authoringRecords = changedData.authoringRecords
  runtime.refresh()
  expect(paragraphs[0].textContent).toBe('same')
  expect(paragraphs[1].textContent).toBe('Changed')
  expect(paragraphs[1].style.getPropertyValue('translate')).toContain('42px')
  runtime.dispose(); frame.remove()
})

it('prepares a frozen bound text reply from the current snapshot after remount without overwriting newer geometry or another object', async () => {
  const binding = { kind: 'dom' as const, path: [{ tag: 'p', index: 0, attributes: { id: 'title' } }], baseline: 'Original' }
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'reply', revision: 0, title: 'Reply', assets: {},
    definitions: { web: { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } } },
    instances: { web: { id: 'web', definitionId: 'web', data: { html: '<p id="title">Original</p><p id="other">Other</p>',
      authoringRecords: { title: { kind: 'text', binding, overrides: { text: 'Original', geometry: { translateX: 0 } } },
        other: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'p', index: 1, attributes: { id: 'other' } }], baseline: 'Other' }, overrides: { text: 'Other' } } } },
      frame: { width: 400, height: 300, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['web'] }], global: { underlay: [], overlay: [] } }
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'reply' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver, { async append() {}, async save() { throw new Error('unused') } })
  const current = (): CapturedCourseTarget => {
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('Expected course')
    return { documentId: 'doc', epoch: 'epoch', project: model.project, editingProject: model.project, resources: model.resources,
      surfaceId: 'slide', activeStateId: null, instanceId: 'web', instanceIds: ['web'] }
  }
  const bridge = { captureTarget: current,
    capture: (edits: Parameters<typeof captureComponentOperation>[1], target: CapturedCourseTarget) => ({ ...captureComponentOperation(target.project, edits), documentId: 'doc', epoch: 'epoch' }),
    editCaptured: async (captured: CapturedComponentOperation) => {
      const { documentId, epoch, ...command } = captured
      const result = await session.execute({ documentId, epoch, baseRevision: session.read().revision, operationId: 'reply', actor: 'human', mutation: { type: 'command', command } })
      if (result.status !== 'applied') throw new Error(JSON.stringify(result))
      return result
    },
  } as unknown as CourseV10DocumentBridge
  const captured = current(), spot: ComponentAuthorSpot = { id: 'retired-mount', instanceId: 'web', mountGeneration: 1, kind: 'text', authorKey: 'title', binding,
    bindingStatus: 'bound', initialValue: 'Original', localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  const stop = registerRuntimeLightEditDocument('doc', { authorSpots: () => [], subscribeAuthorSpots: () => () => {} } as unknown as ComponentPlatformRuntime, bridge)
  const human = captureComponentOperation(project, [{ type: 'data.set', instanceId: 'web', path: ['authoringRecords', 'title', 'overrides', 'geometry', 'translateX'], value: 25 },
    { type: 'data.set', instanceId: 'web', path: ['authoringRecords', 'other', 'overrides', 'text'], value: 'Other object changed' }])
  expect((await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: 0, operationId: 'human', actor: 'human', mutation: { type: 'command', command: human } })).status).toBe('applied')
  try {
    expect(await runtimeLightEditCommands.setPageText({ target: captured, spot, bridge }, 'AI reply')).toEqual({ ok: true, changed: true })
    expect(current().project.instances.web.data).toMatchObject({ authoringRecords: { title: { overrides: { text: 'AI reply', geometry: { translateX: 25 } } },
      other: { overrides: { text: 'Other object changed' } } } })
  } finally { stop() }
})

it('creates the first dynamic author record from the exact registered record path and saves one canonical edit', async () => {
  const key = 'dom-conversation-heading', html = '<div id="root"></div>'
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'first-record', revision: 0, title: 'React heading', assets: {},
    definitions: { web: { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } } },
    instances: { web: { id: 'web', definitionId: 'web', data: { html, resourceBindings: {} }, frame: { width: 1280, height: 720, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['web'] }], global: { underlay: [], overlay: [] } }
  const spot: ComponentAuthorSpot = { id: 'observed', instanceId: 'web', mountGeneration: 1, kind: 'text', initialValue: 'Conversation 1', authorKey: key,
    scope: { 'react:conversation.id': 'conversation-1' }, bindingStatus: 'bound',
    binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'div', index: 0, attributes: { id: 'root' } }, { tag: 'h2', index: 1 }], textIndex: 0, baseline: 'Conversation 1' },
    dataPath: ['authoringRecords', key, 'overrides', 'text'], localBounds: { width: 152, height: 25.5, transform: [1, 0, 0, 1, 925, 138] } }
  const driver = new CourseV10Driver(), resources = { assets: {}, components: {} }
  const session = await DocumentSession.create({ documentId: 'first-record', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'first' },
    model: { kind: 'course-v10', project, resources } }, driver, { async append() {}, async save() { throw new Error('unused') } })
  // The same preflight used by beginSlideSpotEdit must work before a record exists.
  expect(authorSpotEdits(project, spot, spot.initialValue, resources)).toHaveLength(1)
  const command = captureComponentOperation(project, authorSpotEdits(project, spot, 'Revised heading', resources))
  expect((await session.execute({ documentId: 'first-record', epoch: 'epoch', baseRevision: 0, operationId: 'first', actor: 'human', mutation: { type: 'command', command } })).status).toBe('applied')
  expect(session.read().undoDepth).toBe(1)
  const reopened = await driver.load(await driver.serialize(session.read().model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected course')
  expect(reopened.project.instances.web.data).toEqual({ html, resourceBindings: {}, authoringRecords: { [key]: {
    kind: 'text', binding: spot.binding, scope: spot.scope, overrides: { text: 'Revised heading' },
  } } })
  await session.execute({ documentId: 'first-record', epoch: 'epoch', baseRevision: 1, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })
  const undone = session.read().model
  if (undone.kind !== 'course-v10') throw new Error('Expected course')
  expect(undone.project.instances.web.data).toEqual(project.instances.web.data)
  const ordinary = { ...project, instances: { web: { ...project.instances.web, data: { html, label: 'Conversation 1' } } } }
  expect(authorSpotEdits(ordinary, { ...spot, dataPath: ['label'] }, 'Ordinary field', resources)).toEqual([{ type: 'data.set', instanceId: 'web', path: ['label'], value: 'Ordinary field' }])
})
