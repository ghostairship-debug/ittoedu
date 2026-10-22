// @vitest-environment node
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { WEB_DEFINITION } from '../../src/components/web/data'
import type { ComponentFrame } from '../../src/shared/contracts/component-platform'

async function fixture() {
  const project = createBlankCourseProjectV10('Continue target'), surfaceId = testContainerInstance(project, 0).id
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.item = { id: 'item', definitionId: WEB_DEFINITION.id, data: { html: '<h1>保留原对象正文</h1>' },
    frame: { width: 400, height: 240, transform: [1, 0, 0, 1, 100, 50] } }
  testContainerInstance(project, 0).childIds = ['item']
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('No save requested') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'continue-target.glx')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { componentContent: {
    async source() { throw new Error('No source preparation requested') }, async apply() { throw new Error('Readonly run cannot apply') },
  } })
  await gateway.beginRun({ runId: 'parent-one', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const handle = await gateway.issueTarget('parent-one', session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'item' })
  const path = componentProjectFiles(project, { assets: {}, components: {} })
    .find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'item')!.path
  const region: ComponentFrame = { width: 300, height: 180, transform: [1, 0, 0, 1, 120, 70] }
  const frozen = await gateway.taskTargetContext('parent-one', { project: handle, path, region })
  await gateway.stop('parent-one')
  const before = session.read()
  if (before.model.kind !== 'course-v10') throw new Error('Expected current course')
  const frame: ComponentFrame = { width: 480, height: 260, transform: [1, 0, 0, 1, 200, 90] }
  await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, actor: 'human', operationId: 'rename-and-frame',
    mutation: { type: 'command', command: captureComponentOperation(before.model.project, [
      { type: 'surface.title.set', surfaceId, title: '人工改名后的当前页面' }, { type: 'frame.set', instanceId: 'item', frame },
    ]) } })
  await gateway.beginRun({ runId: 'parent-two', actor: 'agent', documents: [{ documentId: session.documentId, writable: [] }] })
  return { gateway, session, frozen, handle, path, region, frame }
}

it('rebases an old parent handle and renamed path by formal identity under the new run grant', async () => {
  const h = await fixture(), before = h.session.read()
  try {
    const current = await h.gateway.taskTargetContext('parent-two', undefined, h.frozen)
    expect(current).toMatchObject({ documentId: before.documentId, epoch: before.epoch, revision: before.revision,
      frame: h.frame, region: h.region, regionStatus: 'explicit', target: { kind: 'instance', instanceId: 'item' } })
    if (!('project' in current) || typeof current.project !== 'string' || !('path' in current) || typeof current.path !== 'string') throw new Error('Expected rebased address')
    expect(current.project).not.toBe(h.handle)
    expect(current.path).not.toBe(h.path)
    expect(current.path).toContain('人工改名后的当前页面')
    expect(await h.gateway.execute('parent-two', 'read-current', { name: 'project.read', input: { project: current.project, path: current.path } }))
      .toMatchObject({ kind: 'read', data: { content: '<h1>保留原对象正文</h1>' } })
    expect(await h.gateway.execute('parent-two', 'old-handle', { name: 'read', input: { target: h.handle } })).toMatchObject({ kind: 'error' })
    expect(await h.gateway.execute('parent-two', 'write-denied', { name: 'project.apply', input: { project: current.project, path: current.path, content: '<p>禁止越权</p>' } }))
      .toMatchObject({ kind: 'error', code: 'not-authorized' })
    const observedOnly = await h.gateway.taskTargetContext('parent-two', undefined, { ...h.frozen, regionStatus: 'current-object', region: h.frame })
    expect(observedOnly).toMatchObject({ frame: h.frame, regionStatus: 'current-object' })
    expect(observedOnly).not.toHaveProperty('region')
    expect(h.session.read()).toEqual(before)
  } finally { await h.gateway.stop('parent-two') }
})

it('rejects another current grant or epoch instead of treating an old address as authority', async () => {
  const h = await fixture()
  try {
    await h.gateway.beginRun({ runId: 'unrelated', actor: 'agent', documents: [] })
    await expect(h.gateway.taskTargetContext('unrelated', undefined, h.frozen)).rejects.toMatchObject({ code: 'not-authorized' })
    await expect(h.gateway.taskTargetContext('parent-two', undefined, { ...h.frozen, epoch: 'another-epoch' })).rejects.toMatchObject({ code: 'stale-epoch' })
  } finally { await h.gateway.stop('parent-two'); await h.gateway.stop('unrelated') }
})
