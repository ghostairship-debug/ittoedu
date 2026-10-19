// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { WEB_DEFINITION } from '../../src/components/web/data'
import type { ComponentFrame } from '../../src/shared/contracts/component-platform'

it('freezes current target geometry, refreshes manual layout by observed identity, and isolates the target page', async () => {
  const project = createBlankCourseProjectV10('Target context'), surface = project.surfaces[0]!
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  const initialFrame: ComponentFrame = { width: 640, height: 360, transform: [1, 0, 0, 1, 300, 180] }
  project.instances.a = { id: 'a', definitionId: WEB_DEFINITION.id, frame: initialFrame,
    data: { html: '<h1>Experiment A</h1><button>Run</button><script>SECRET_SOURCE</script><style>SECRET_CSS</style>' } }
  project.instances.b = { id: 'b', definitionId: WEB_DEFINITION.id, frame: { width: 1100, height: 120, transform: [1, 0, 0, 1, 50, 0] },
    data: { html: '<h1>Keep native heading</h1><nav><a href="#next">Continue</a></nav>' } }
  project.instances.other = { id: 'other', definitionId: WEB_DEFINITION.id, frame: initialFrame, data: { html: '<h1>OTHER_PAGE</h1>' } }
  surface.childIds = ['a', 'b']
  project.surfaces.push({ id: 'other-page', kind: 'slide', title: 'Other page', childIds: ['other'], designSize: { width: 1280, height: 720 } })
  const session = await DocumentSession.create({ documentId: 'task-target', epoch: 'epoch',
    binding: { kind: 'file', path: 'task-target.glx', version: null, bindingVersion: 0 },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, new CourseV10Driver(),
  { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('File binding required'); return input.binding } })
  const snapshot = () => session.read() as ComponentProjectSnapshot
  let documentReads = 0
  const coordinator = new ComponentProjectFileCoordinator({
    async document() { documentReads++; return snapshot() },
    scope: (_run, selector) => selector === 'only-a' ? { kind: 'instance', instanceId: 'a' } : { kind: 'document' },
    async source() { throw new Error('Read-only context must not read source files') },
    async apply() { throw new Error('Read-only context must not write') },
  })
  expect(await coordinator.taskTargetContext('run')).toMatchObject({ regionStatus: 'unresolved' })
  expect(documentReads).toBe(1)
  await coordinator.execute('run', 'list', 'list', 'project.list', {})
  const files = componentProjectFiles(project, { assets: {}, components: {} })
  const a = files.find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'a')!
  const b = files.find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'b')!
  const region: ComponentFrame = { width: 500, height: 280, transform: [1, 0, 0, 1, 600, 200] }
  const first = await coordinator.taskTargetContext('run', { path: a.path, region })
  expect(first).toMatchObject({ documentId: 'task-target', epoch: 'epoch', revision: 0,
    path: a.path, frame: initialFrame, viewport: { width: 640, height: 360 }, region,
    surface: { title: surface.title, kind: 'slide' },
    neighbors: [expect.objectContaining({ frame: project.instances.b.frame, text: expect.stringContaining('Keep native heading') })] })
  expect(JSON.stringify(first)).not.toMatch(/SECRET_SOURCE|SECRET_CSS|OTHER_PAGE|\.view\./)
  const humanFrame: ComponentFrame = { width: 720, height: 410, transform: [1, 0, 0, 1, 250, 160] }
  const before = snapshot()
  await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: 'human-layout', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(before.model.project, [
      { type: 'frame.set', instanceId: 'a', frame: humanFrame },
      { type: 'instance.move', instanceId: 'b', container: { kind: 'surface', surfaceId: surface.id }, index: 0 },
    ]) } })
  const current = snapshot()
  const refreshed = await coordinator.taskTargetContext('run', { path: a.path })
  expect(refreshed).toMatchObject({ revision: current.revision, path: a.path, currentPath: b.path,
    frame: humanFrame, viewport: { width: 720, height: 410 }, content: { text: expect.stringContaining('Experiment A') } })
  expect(refreshed).not.toHaveProperty('region')
  expect(coordinator.captureFile('run', current, a.path).snapshot.revision).toBe(before.revision)
  const currentB = componentProjectFiles(current.model.project, current.model.resources)
    .find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'b')!
  await expect(coordinator.taskTargetContext('run', { project: 'only-a', path: currentB.path })).rejects.toThrow('没有这个工程文件')
  expect(snapshot().revision).toBe(current.revision)
  expect(snapshot().undoDepth).toBe(current.undoDepth)
})
