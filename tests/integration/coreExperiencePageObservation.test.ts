// @vitest-environment node
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { createCourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { WEB_DEFINITION } from '../../src/components/web/data'
import type { ObservationServicePort } from '../../src/shared/workbench/toolPorts'
import type { ToolResult } from '../../src/shared/workbench/tools'

function data<T>(result: ToolResult): T {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as T
}

it('observes the current formal page through its listed HTML path after inserting a professional image', async () => {
  const driver = createCourseV10Driver(), project = createBlankCourseProjectV10('Observe mixed content')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html: '<h1>原内容</h1>' } }
  project.surfaces[0].childIds = ['web']
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('Unused physical save') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'observe.h5lesson')
  // The port records page identity; this test makes no rendered-image claim.
  const observe = vi.fn<ObservationServicePort['observe']>(async input => ({ source: 'isolated-published',
    identity: { documentId: input.documentId, epoch: input.epoch, revision: input.revision, locationId: input.locationId, stateId: input.stateId },
    coverage: { width: 1, height: 1 }, structure: [], diagnostics: [],
    image: { resourceId: 'controlled-observation', mimeType: 'image/png', width: 1, height: 1, byteLength: 0 } }))
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { prepareImage: prepareImageResource,
    services: { observations: { observe, readResource: async () => { throw new Error('Unused image read') } } },
    componentContent: { source: async () => { throw new Error('Unused source read') }, apply: async () => { throw new Error('Unused content apply') } } })
  await gateway.beginRun({ runId: 'author', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  let sequence = 0
  const call = (name: string, input: unknown) => gateway.execute('author', String(++sequence), { name, input })
  try {
    const listed = data<{ files: { path: string; type: string }[] }>(await call('project.list', {}))
    const pagePath = listed.files.find(file => file.type === 'page')!.path
    const surface = await gateway.issueTarget('author', session.documentId, { kind: 'course-surface', surfaceId: project.surfaces[0].id })
    const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#347d68' } }).png().toBuffer()
    const resource = await gateway.provideImage('author', session.documentId, { bytes, filename: 'ready.png', mimeType: 'image/png' })
    expect(await call('media.insert', { target: surface, resource, fit: 'contain' }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const current = session.read()
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(current.model.project.instances.web).toEqual(project.instances.web)
    expect(current.model.project.surfaces[0].childIds).toHaveLength(2)
    const next = data<{ files: { path: string; type: string }[] }>(await call('project.list', {}))
    expect(next.files.some(file => file.path === pagePath)).toBe(false)
    expect(next.files).toContainEqual(expect.objectContaining({ path: pagePath.replace(/\.html$/, '.json'), type: 'structure' }))
    for (const projectSelector of [undefined, 'observe.h5lesson']) {
      expect(await call('view.observe', { path: pagePath, ...(projectSelector ? { project: projectSelector } : {}) }))
        .toMatchObject({ kind: 'read', data: { identity: { documentId: current.documentId, epoch: current.epoch,
          revision: current.revision, locationId: project.surfaces[0].id } } })
    }
    expect(observe).toHaveBeenCalledTimes(2)
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: project.id, stateId: null }))
    expect(await call('view.observe', { path: 'pages/99-不存在.html' })).toMatchObject({ kind: 'error', code: 'target-not-found' })
    expect(observe).toHaveBeenCalledTimes(2)
    expect(session.read().revision).toBe(current.revision)
  } finally { await gateway.stop('author') }
})
