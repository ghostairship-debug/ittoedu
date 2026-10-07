// @vitest-environment node
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { createCourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

function data<T>(result: ToolResult): T {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as T
}

async function fixture(afterCommit?: (session: ReturnType<DocumentRegistry['get']>) => Promise<void>) {
  const driver = createCourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('Unused physical save') } } })
  const session = await registry.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Image insertion'),
    resources: { assets: {}, components: {} } }, 'images.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { prepareImage: prepareImageResource,
    componentContent: {
      source: async () => { throw new Error('Unused file source') },
      apply: async input => {
        const result = await new ContentApplyService({
          session: { project: () => input.baseline.model.project, resources: () => input.baseline.model.resources,
            dispatch: async command => {
              input.assertActive()
              return session.execute({ documentId: session.documentId, epoch: input.baseline.epoch,
                baseRevision: session.read().revision, operationId: input.operationId, requestDigest: input.requestDigest,
                actor: input.actor, runId: input.runId, runLeaseId: input.runLeaseId, mutation: { type: 'command', command } })
            } },
          measure: async () => { throw new Error('Surface creation does not measure HTML') },
          compilation: { compile: async () => { throw new Error('Surface creation does not compile') } },
        }).apply(input.request)
        if (result.commit === 'committed') await afterCommit?.(session)
        return result
      },
    },
  })
  await gateway.beginRun({ runId: 'author', actor: 'agent', documents: [],
    fileAccess: { permission: 'workspace', workspaceRoot: 'D:/creation-media-fixture' } })
  await gateway.attachRunDocument('author', session.documentId, true, 'select')
  const target = await gateway.issueTarget('author', session.documentId, { kind: 'document' })
  let sequence = 0
  return { session, gateway, target,
    call: (name: string, input: unknown) => gateway.execute('author', String(++sequence), { name, input }) }
}

it('keeps a newly created page writable through the original document handle after project.apply', async () => {
  const f = await fixture()
  try {
    expect(await f.call('project.apply', { path: 'pages', intent: 'surface.add', kind: 'slide', title: 'New image page' }))
      .toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } })
    const children = data<{ target: string; label: string; kind: string }[]>(await f.call('listChildren', { target: f.target }))
    const page = children.find(child => child.kind === 'course-surface' && child.label === 'New image page')!
    expect(page).toBeDefined()
    const inspected = data<{ target: string }>(await f.call('inspect', { target: page.target }))
    expect(await f.call('inspect', { target: inspected.target })).toMatchObject({ kind: 'read', data: { writable: true } })
    const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#347d68' } }).png().toBuffer()
    const resource = await f.gateway.provideImage('author', f.session.documentId, { bytes, filename: 'ready.png', mimeType: 'image/png' })
    expect(await f.call('media.insert', { target: inspected.target, resource, fit: 'contain' }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const current = f.session.read()
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    const surface = current.model.project.surfaces.find(item => item.title === 'New image page')!
    expect(surface.childIds).toHaveLength(1)
    expect(Object.keys(current.model.resources.assets)).toHaveLength(1)
  } finally { await f.gateway.stop('author') }
})

it('does not absorb a human change between the content ACK and the tool response', async () => {
  const f = await fixture(async session => {
    const current: DocumentSnapshot = session.read()
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(current.model.project,
        [{ type: 'project.title.set', title: 'Human revision after ACK' }]) } })).toMatchObject({ status: 'applied' })
  })
  try {
    expect(await f.call('project.apply', { path: 'pages', intent: 'surface.add', kind: 'slide', title: 'New page' }))
      .toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    expect(await f.call('inspect', { target: f.target })).toMatchObject({ kind: 'read', data: { writable: false } })
    const children = data<{ target: string; kind: string }[]>(await f.call('listChildren', { target: f.target }))
    const page = children.find(child => child.kind === 'course-surface')!
    expect(await f.call('inspect', { target: page.target })).toMatchObject({ kind: 'read', data: { writable: false } })
  } finally { await f.gateway.stop('author') }
})
