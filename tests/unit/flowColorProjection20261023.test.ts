// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { textComponentDataSchema } from '../../src/components/text/data'
import { plainDocumentText } from '../../src/shared/document/content'
import type { ToolResult } from '../../src/shared/workbench/tools'

function readData<T>(result: ToolResult): T {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' })
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as T
}
type ListedFile = { path: string; type: string; note?: string }

async function fixture() {
  const project = createBlankCourseProjectV10('颜色投影'), flowId = project.rootIds[0]
  const flow = project.instances[flowId]
  flow.container!.kind = 'flow'
  delete flow.container!.designSize
  flow.childIds = []
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('No disk save in this test') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'colors.glx')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { componentContent: {
    async source() { throw new Error('No external input in this test') },
    async apply(input) {
      return new ContentApplyService({ session: { project: () => input.baseline.model.project, resources: () => input.baseline.model.resources,
        dispatch: async command => {
          input.assertActive()
          return session.execute({ documentId: input.baseline.documentId, epoch: input.baseline.epoch,
            baseRevision: input.baseline.revision, operationId: input.operationId, requestDigest: input.requestDigest,
            actor: input.actor, runId: input.runId, runLeaseId: input.runLeaseId, mutation: { type: 'command', command } })
        } }, compilation: { async compile() { throw new Error('Native text must not compile') } },
      async measure() { throw new Error('Native text must not measure') } }).apply(input.request)
    },
  } })
  const runId = 'flow-color'
  await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const call = (name: string, input: Record<string, unknown>) => gateway.execute(runId, randomUUID(), { name, input })
  const model = () => { const current = session.read().model; if (current.kind !== 'course-v10') throw new Error('Expected V10'); return current }
  const target = await gateway.issueTarget(runId, session.documentId, { kind: 'course-surface', surfaceId: flowId })
  const findText = (text: string) => Object.values(model().project.instances).find(instance =>
    instance.definitionId === 'guoling.text' && plainDocumentText(textComponentDataSchema.parse(instance.data).content) === text)!
  return { call, model, target, flowId, findText, gateway, runId, session,
    dispose: async () => { await gateway.stop(runId); await registry.close(session.documentId, { discardDirty: true }) } }
}

describe('Flow projection keeps a locally unavailable appearance color repairable', () => {
  it('keeps Gateway list, both body reads and other body writes usable after the actual seven-digit hex insertion', async () => {
    const h = await fixture()
    try {
      const inserted = await h.call('batch', { operations: [
        { name: 'object.insert', input: { target: h.target, kind: 'text', text: '合法标题', appearance: { color: '#1f3b39', fontSize: 32, bold: true } } },
        { name: 'object.insert', input: { target: h.target, kind: 'text', text: '颜色待修正文', appearance: { color: '#3347463' } } },
        { name: 'object.insert', input: { target: h.target, kind: 'text', text: '后续正文', appearance: { color: '#203040' } } },
      ] })
      expect(inserted, JSON.stringify(inserted)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      const heading = h.findText('合法标题'), raw = h.findText('颜色待修正文'), tail = h.findText('后续正文')
      expect(heading).toBeDefined(); expect(raw).toBeDefined(); expect(tail).toBeDefined()
      const original = structuredClone(raw)
      expect(textComponentDataSchema.parse(raw.data).appearance.color).toBe('#3347463')
      const blocks = projectFlowDocument(h.model().project, h.flowId).content.blocks
      expect(blocks.find(block => block.id === heading.id)?.type).toBe('paragraph')
      expect(blocks.find(block => block.id === raw.id)).toMatchObject({ id: raw.id, type: 'course-instance' })
      expect(blocks.find(block => block.id === tail.id)?.type).toBe('paragraph')

      const listing = readData<{ files: ListedFile[] }>(await h.call('project.list', { limit: 1000 }))
      const bodies = listing.files.filter(file => /\.body\.(md|html)$/.test(file.path))
      expect(bodies).toHaveLength(2)
      let markdown = ''
      for (const file of bodies) {
        expect(file.note).toContain('appearance.color')
        expect(file.note).toContain('#3347463')
        const read = readData<{ content: string }>(await h.call('project.read', { path: file.path, full: true }))
        expect(read.content).toContain('合法标题')
        expect(read.content).toContain('后续正文')
        if (file.path.endsWith('.md')) { markdown = read.content; expect(markdown).toContain(raw.id) }
        else expect(read.content).toContain('<guoling-instance')
      }
      expect(h.model().project.instances[raw.id]).toEqual(original)

      const md = bodies.find(file => file.path.endsWith('.md'))!
      expect(readData<{ commit: string }>(await h.call('project.apply', { path: md.path, intent: 'content',
        content: markdown.replace('后续正文', '后续正文已修改') })).commit).toBe('committed')
      expect(plainDocumentText(textComponentDataSchema.parse(h.model().project.instances[tail.id].data).content)).toBe('后续正文已修改')
      expect(h.model().project.instances[raw.id]).toEqual(original)

      const rawTarget = await h.gateway.issueTarget(h.runId, h.session.documentId,
        { kind: 'course-instance', surfaceId: h.flowId, instanceId: raw.id })
      readData(await h.call('read', { target: rawTarget }))
      expect(await h.call('object.update', { target: rawTarget, properties: { appearance: { color: '#334746' } } }))
        .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      expect(textComponentDataSchema.parse(h.model().project.instances[raw.id].data).appearance.color).toBe('#334746')
      expect(projectFlowDocument(h.model().project, h.flowId).content.blocks.find(block => block.id === raw.id)?.type).toBe('paragraph')
      const repaired = readData<{ files: ListedFile[] }>(await h.call('project.list', { limit: 1000 }))
      expect(repaired.files.filter(file => /\.body\.(md|html)$/.test(file.path)).every(file => !file.note?.includes('appearance.color'))).toBe(true)
    } finally { await h.dispose() }
  })

  it.each([
    { color: 'red', type: 'paragraph' },
    { color: 'currentColor', type: 'course-instance' },
    { color: 'var(--lesson-ink)', type: 'course-instance' },
  ])('retains authored $color while projecting it as $type', async ({ color, type }) => {
    const h = await fixture()
    try {
      expect(await h.call('object.insert', { target: h.target, kind: 'text', text: '颜色正文', appearance: { color } }))
        .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      const raw = h.findText('颜色正文'), original = structuredClone(raw)
      const blocks = projectFlowDocument(h.model().project, h.flowId).content.blocks
      expect(blocks).toHaveLength(1)
      expect(blocks[0]).toMatchObject({ id: raw.id, type })
      if (blocks[0].type === 'paragraph') expect(blocks[0].textDefaults?.color).toBe('#ff0000')
      const files = readData<{ files: ListedFile[] }>(await h.call('project.list', { limit: 1000 })).files
      expect(files.filter(file => /\.body\.(md|html)$/.test(file.path))).toHaveLength(2)
      expect(h.model().project.instances[raw.id]).toEqual(original)
      expect(textComponentDataSchema.parse(raw.data).appearance.color).toBe(color)
    } finally { await h.dispose() }
  })
})
