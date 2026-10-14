// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '@/core/course/createCourseProjectV10'
import { DocumentSession } from '@/core/documents/DocumentSession'
import { CourseV10Driver } from '@/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '@/core/drivers/courseV10Operations'
import { componentProjectFiles } from '@/core/projectFiles/componentPlatform/projection'
import { WEB_DEFINITION } from '@/components/web/data'
import { ContentApplyService } from '@/main/workbench/contentApply/applyService'
import type { ContentApplyResult, ContentApplySource } from '@/core/contentApply/planning/types'
import type { ComponentEdit, CourseProjectV10 } from '@/shared/contracts/component-platform'
import { modelToolResult } from '@/core/tools/modelToolResult'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '@/core/projectFiles/componentPlatform/coordinator'
import { componentProjectApplyReceiptFiles } from '@/core/projectFiles/componentPlatform/applyReceiptFiles'

const frame = { width: 320, height: 180, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
const objects = (html: string): ContentApplySource => ({ kind: 'objects', objects: [{ definitionId: WEB_DEFINITION.id, data: { html }, frame }] })
function project() {
  const value = createBlankCourseProjectV10('Receipt')
  value.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  return value
}
async function fixture(initial: CourseProjectV10) {
  let nextSource: ContentApplySource | undefined, outcome: 'unknown' | 'not_committed' | undefined
  let afterApply: (() => Promise<void>) | undefined, readFailure: Error | undefined, reads = 0, sequence = 0
  const session = await DocumentSession.create({ documentId: 'receipt', epoch: 'epoch',
    binding: { kind: 'untitled', suggestedName: 'receipt.h5lesson' },
    model: { kind: 'course-v10', project: initial, resources: { assets: {}, components: {} } } }, new CourseV10Driver(),
  { async append() {}, async save() { throw new Error('Fixture does not save') } })
  const snapshot = () => session.read() as ComponentProjectSnapshot
  const coordinator = new ComponentProjectFileCoordinator({
    async document(_run, _selector, access) { if (access === 'read') { reads++; if (readFailure) throw readFailure } return snapshot() },
    async source() { return { filename: 'fixture.html', bytes: new TextEncoder().encode('<p>fixture</p>'), text: '<p>fixture</p>' } },
    async prepareSource(_input, file) { return nextSource ?? { kind: 'html', html: file.content ?? '' } },
    async apply(_run, operationId, _digest, baseline, request) {
      if (outcome) return { commit: outcome, usability: 'unverified', delivery: 'not_requested', input: request, insertedIds: [], diagnostics: [] }
      const service = new ContentApplyService({
        session: { project: () => baseline.model.project, resources: () => baseline.model.resources,
          async dispatch(command) {
            const receipt = await session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId,
              baseRevision: snapshot().revision, actor: 'agent', mutation: { type: 'command', command } })
            if (receipt.status === 'applied') coordinator.acknowledge('run', baseline.documentId, baseline.epoch, receipt.revision, command)
            return receipt
          } },
        async measure() { throw new Error('The receipt fixture uses canonical object drafts') },
        compilation: { async compile() { return { status: 'ready', artifact: { diagnostics: [] } } as never } },
        createId: () => `new-${++sequence}`,
      })
      const result = await service.apply(request)
      await afterApply?.()
      return result
    },
  })
  const execute = (name: 'project.list' | 'project.read' | 'project.apply', input: unknown) =>
    coordinator.execute('run', `operation-${++sequence}`, `digest-${sequence}`, name, input)
  const files = () => componentProjectFiles(snapshot().model.project, snapshot().model.resources)
  const human = async (edits: ComponentEdit[]) => {
    const before = snapshot()
    return session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: `human-${++sequence}`,
      baseRevision: before.revision, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(before.model.project, edits) } })
  }
  return { snapshot, execute, files, human, coordinator, get reads() { return reads },
    source(value: ContentApplySource) { nextSource = value }, outcome(value: typeof outcome) { outcome = value },
    afterApply(value: typeof afterApply) { afterApply = value }, failReads() { readFailure = new Error('任务已停止') } }
}
const data = (result: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['execute']>>) => {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as ContentApplyResult & { path: string; currentPath?: string; files?: { path: string; type: string }[]; next?: string }
}

it('returns inserted object paths, including descendants, and introduces their ACK baseline for the next edit', async () => {
  const f = await fixture(project()), page = f.files().find(file => file.kind === 'structure')!
  await f.execute('project.list', {})
  f.source({ kind: 'objects', objects: [{ definitionId: WEB_DEFINITION.id, data: { html: '<section>parent</section>' }, frame,
    children: [{ definitionId: WEB_DEFINITION.id, data: { html: '<button>child</button>' }, frame }] }] })
  const reply = await f.execute('project.apply', { path: page.path, intent: 'insert', content: '<section>parent</section>' })
  const result = data(reply), inserted = new Set(result.insertedIds)
  expect(result.commit).toBe('committed')
  const rootId = f.snapshot().model.project.surfaces[0].childIds[0]
  const relevant = f.files().filter(file => file.target?.kind === 'instance' && inserted.has(file.target.instanceId))
  expect(result.files?.map(file => file.path)).toEqual(relevant.map(file => file.path))
  const child = f.files().find(file => file.target?.kind === 'instance' && file.target.instanceId !== rootId && file.kind === 'html')!
  f.source({ kind: 'data', fields: [{ path: ['html'], value: '<button>updated</button>' }] })
  expect(data(await f.execute('project.apply', { path: child.path, edits: [{ old: 'child', new: 'updated' }] })).commit).toBe('committed')
  const projected = modelToolResult('project.apply', reply)
  expect(projected).toMatchObject({ kind: 'read', data: { files: result.files } })
  expect(JSON.stringify(projected)).not.toContain('<section>parent</section>')
})

it('returns current definition and instance paths after title and role changes without matching another same-named definition', async () => {
  const initial = project()
  initial.definitions.changed = { id: 'changed', title: 'Same', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }
  initial.definitions.other = { ...initial.definitions.changed, id: 'other' }
  initial.instances.changed = { id: 'changed', definitionId: 'changed', data: { value: 'old' }, frame }
  initial.instances.other = { id: 'other', definitionId: 'other', data: { value: 'neighbor' }, frame }
  initial.surfaces[0].childIds = ['changed', 'other']
  const f = await fixture(initial), definition = f.files().find(file => file.binding?.kind === 'definition' && file.binding.definitionId === 'changed')!
  await f.execute('project.list', {})
  const result = data(await f.execute('project.apply', { path: definition.path, content: JSON.stringify({ title: 'Renamed', role: 'behavior' }) }))
  expect(result.commit).toBe('committed')
  expect(result.path).toContain('Renamed.definition.json')
  expect(result.files?.some(file => file.path.includes('Renamed.view.js'))).toBe(true)
  expect(result.files?.every(file => !file.path.includes('Same'))).toBe(true)
  const current = f.files().find(file => file.target?.kind === 'instance' && file.target.instanceId === 'changed' && file.kind === 'data')!
  expect(f.coordinator.captureFile('run', f.snapshot(), current.path, true).snapshot.model.project.instances.changed.data).toEqual({ value: 'old' })
})

it('returns the new content path when redo keeps an instance identity but changes its content role', async () => {
  const initial = project()
  initial.definitions.old = { id: 'old', title: 'Old', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }
  initial.instances.selected = { id: 'selected', definitionId: 'old', data: { value: 'old' }, frame }
  initial.surfaces[0].childIds = ['selected']
  const f = await fixture(initial), old = f.files().find(file => file.target?.kind === 'instance' && file.kind === 'data')!
  await f.execute('project.list', {}); f.source(objects('<button>redo</button>'))
  // The source port supplies object drafts; this fixture exercises receipt and Session semantics, not HTML admission.
  const result = data(await f.execute('project.apply', { path: old.path, intent: 'redo', from: 'fixture.html' }))
  expect(result.commit).toBe('committed')
  expect(result.path).toMatch(/\.content\.html$/)
  expect(result.path).not.toBe(old.path)
  expect(f.coordinator.captureFile('run', f.snapshot(), result.path, true).file.target).toEqual({ kind: 'instance', instanceId: 'selected' })
})

it('keeps authoring separate from business data and introduces descendant paths when the parent definition is renamed', async () => {
  const initial = project(), authoring = (text: string) => ({ records: { title: { kind: 'text' as const,
    binding: { kind: 'dom' as const, path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, overrides: { text } } } })
  initial.definitions.parent = { id: 'parent', title: 'Parent', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }
  initial.instances.parent = { id: 'parent', definitionId: 'parent', data: { business: 'preserve' }, authoring: authoring('Before'), frame, childIds: ['child'] }
  initial.instances.child = { id: 'child', definitionId: WEB_DEFINITION.id, data: { html: '<p>child</p>' }, frame }
  initial.surfaces[0].childIds = ['parent']
  const f = await fixture(initial), definition = f.files().find(file => file.binding?.kind === 'definition' && file.binding.definitionId === 'parent')!
  await f.execute('project.list', {})
  const renamed = data(await f.execute('project.apply', { path: definition.path, content: JSON.stringify({ title: 'Renamed Parent', role: 'content' }) }))
  expect(renamed.commit).toBe('committed')
  const currentAuthoring = f.files().find(file => file.binding?.kind === 'instance-authoring' && file.binding.instanceId === 'parent')!
  const currentChild = f.files().find(file => file.target?.kind === 'instance' && file.target.instanceId === 'child' && file.kind === 'html')!
  expect(renamed.files?.some(file => file.path === currentChild.path)).toBe(true)
  expect(f.coordinator.captureFile('run', f.snapshot(), currentChild.path, true).file.target).toEqual({ kind: 'instance', instanceId: 'child' })
  expect(f.coordinator.captureFile('run', f.snapshot(), currentAuthoring.path, true).file.binding).toEqual({ kind: 'instance-authoring', instanceId: 'parent' })
  expect(data(await f.execute('project.apply', { path: currentAuthoring.path, content: JSON.stringify(authoring('After')) })).commit).toBe('committed')
  expect(f.snapshot().model.project.instances.parent.data).toEqual({ business: 'preserve' })
  expect(f.snapshot().model.project.instances.parent.authoring).toEqual(authoring('After'))
})

it('does not refresh unread human content when a definition rename introduces a new path', async () => {
  const initial = project()
  initial.definitions.custom = { ...WEB_DEFINITION, id: 'custom', title: 'Before' }
  initial.instances.item = { id: 'item', definitionId: 'custom', data: { html: '<p>observed</p>' }, frame }
  initial.surfaces[0].childIds = ['item']
  const f = await fixture(initial), definition = f.files().find(file => file.binding?.kind === 'definition' && file.binding.definitionId === 'custom')!
  await f.execute('project.list', {})
  await f.human([{ type: 'data.set', instanceId: 'item', path: ['html'], value: '<p>human</p>' }])
  expect(data(await f.execute('project.apply', { path: definition.path, content: JSON.stringify({ title: 'After', role: 'content' }) })).commit).toBe('committed')
  const current = f.files().find(file => file.target?.kind === 'instance' && file.kind === 'html')!
  expect(f.coordinator.captureFile('run', f.snapshot(), current.path, true).file.content).toBe('<p>observed</p>')
  f.source({ kind: 'data', fields: [{ path: ['html'], value: '<p>overwrite</p>' }] })
  expect(data(await f.execute('project.apply', { path: current.path, content: '<p>overwrite</p>' }))).toMatchObject({
    commit: 'not_committed', receipt: { status: 'conflict', code: 'component-field-conflict' },
  })
  expect(f.snapshot().model.project.instances.item.data).toEqual({ html: '<p>human</p>' })
})

it('reports a same-name path collision without rebinding the old observed object', async () => {
  const initial = project()
  for (const id of ['first', 'second']) initial.instances[id] = { id, definitionId: WEB_DEFINITION.id, data: { html: `<p>${id}</p>` }, frame }
  initial.surfaces[0].childIds = ['first', 'second']
  const f = await fixture(initial), first = f.files().find(file => file.target?.kind === 'instance' && file.target.instanceId === 'first' && file.kind === 'html')!
  const second = f.files().find(file => file.target?.kind === 'instance' && file.target.instanceId === 'second' && file.kind === 'html')!
  await f.execute('project.list', {}); f.source(objects('<p>inserted</p>'))
  const result = data(await f.execute('project.apply', { path: first.path, intent: 'insert', content: '<p>inserted</p>' }))
  expect(result.commit).toBe('committed'); expect(result.next).toContain('project.list')
  expect(result.currentPath).toBe(second.path)
  expect(f.coordinator.captureFile('run', f.snapshot(), second.path, true).file.target).toEqual({ kind: 'instance', instanceId: 'second' })
})

it('preserves a committed receipt when the after read stops, and skips after reads for unknown or rejected results', async () => {
  const f = await fixture(project()), page = f.files().find(file => file.kind === 'structure')!
  await f.execute('project.list', {}); f.source(objects('<p>committed</p>')); f.afterApply(async () => f.failReads())
  const result = data(await f.execute('project.apply', { path: page.path, intent: 'insert', content: '<p>committed</p>' }))
  expect(result).toMatchObject({ commit: 'committed', receipt: { status: 'applied' }, diagnostics: [{ code: 'content-paths-unavailable', message: '任务已停止' }] })
  for (const outcome of ['unknown', 'not_committed'] as const) {
    const g = await fixture(project()), target = g.files().find(file => file.kind === 'structure')!
    await g.execute('project.list', {}); g.source(objects('<p>not applied</p>')); g.outcome(outcome)
    const readCount = g.reads, revision = g.snapshot().revision
    expect(data(await g.execute('project.apply', { path: target.path, intent: 'insert', content: '<p>not applied</p>' }))).toMatchObject({ commit: outcome })
    expect(g.reads).toBe(readCount); expect(g.snapshot().revision).toBe(revision)
  }
})

it('selects only current authorized scope and refuses another epoch', async () => {
  const initial = project()
  for (const id of ['selected', 'neighbor']) initial.instances[id] = { id, definitionId: WEB_DEFINITION.id, data: { html: `<p>${id}</p>` }, frame }
  initial.surfaces[0].childIds = ['selected', 'neighbor']
  const f = await fixture(initial), before = f.snapshot(), original = f.files().find(file => file.kind === 'structure')!
  const result: ContentApplyResult = { commit: 'committed', usability: 'usable', delivery: 'not_requested', diagnostics: [], insertedIds: ['selected', 'neighbor'],
    input: { intent: 'insert', target: original.target!, source: objects('<p>selected</p>') } }
  const scoped = componentProjectApplyReceiptFiles(before, original, result, before, { kind: 'instance', instanceId: 'selected' })
  expect(scoped.files.every(file => file.target?.kind === 'instance' && file.target.instanceId === 'selected')).toBe(true)
  expect(scoped.files.length).toBeGreaterThan(0)
  expect(() => componentProjectApplyReceiptFiles(before, original, result, { ...before, epoch: 'replacement' })).toThrow('工程身份已变化')
})
