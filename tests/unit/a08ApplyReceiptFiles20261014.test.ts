// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '@/core/course/createCourseProjectV10'
import { DocumentSession } from '@/core/documents/DocumentSession'
import { CourseV10Driver } from '@/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '@/core/drivers/courseV10Operations'
import { componentProjectFiles } from '@/core/projectFiles/componentPlatform/projection'
import { HTML_PROGRAM_DEFINITION, WEB_DEFINITION } from '@/components/web/data'
import { TEXT_DEFINITION } from '@/components/text/adapters'
import { ContentApplyService } from '@/main/workbench/contentApply/applyService'
import type { ContentApplyResult, ContentApplySource } from '@/core/contentApply/planning/types'
import type { ComponentEdit, ComponentFrame, CourseProjectV10 } from '@/shared/contracts/component-platform'
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
  let afterApply: (() => Promise<void>) | undefined, readFailure: Error | undefined, reads = 0, applies = 0, sequence = 0
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
      applies++
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
  return { snapshot, execute, files, human, coordinator, get reads() { return reads }, get applies() { return applies },
    source(value: ContentApplySource) { nextSource = value }, outcome(value: typeof outcome) { outcome = value },
    afterApply(value: typeof afterApply) { afterApply = value }, failReads() { readFailure = new Error('任务已停止') } }
}
const data = (result: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['execute']>>) => {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as ContentApplyResult & { path: string; content?: string; currentPath?: string; files?: {
    path: string; type: string; content?: string; frame?: ComponentFrame; viewport?: { width: number; height: number };
    revision?: number; currentRevision?: number; staleSnapshot?: true;
  }[]; next?: string; repair?: { next?: string; read: Array<{ tool: string; input: { path: string; refresh?: boolean; project?: string } }> } }
}

it('returns geometry and the generated program author entry for immediate Source editing, without echoing native content or dependencies', async () => {
  const initial = project()
  initial.definitions[HTML_PROGRAM_DEFINITION.id] = HTML_PROGRAM_DEFINITION
  initial.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const f = await fixture(initial), page = f.files().find(file => file.kind === 'structure')!
  const listing = data(await f.execute('project.list', {}))
  expect(listing.files?.every(file => file.content === undefined)).toBe(true)
  const placed = { ...frame, transform: [1, 0, 0, 1, 52, 196] as ComponentFrame['transform'] }
  f.source({ kind: 'objects', objects: [
    { definitionId: HTML_PROGRAM_DEFINITION.id, data: { html: '<button>Run</button><script>void 0;</script>' }, frame: placed },
    { definitionId: TEXT_DEFINITION.id, data: { content: { inlines: [{ type: 'text', text: 'Independent explanation' }] } }, frame },
  ] })
  const reply = await f.execute('project.apply', { path: page.path, intent: 'insert', content: '<button>Run</button>' })
  const result = data(reply), entries = result.files?.filter(file => file.content !== undefined) ?? []
  expect(result.commit).toBe('committed')
  expect(entries).toHaveLength(1)
  const entry = entries[0]
  expect(entry.path).toMatch(/\.view\.js$/)
  expect(entry.path).not.toContain('.dependencies/')
  expect(entry.content).toContain("import implementation from './implementation'")
  expect(entry).toMatchObject({ frame: placed, viewport: { width: 320, height: 180 }, revision: result.receipt && 'revision' in result.receipt ? result.receipt.revision : -1 })
  expect(result.files?.find(file => file.path === result.path)).toMatchObject({ frame: placed, viewport: { width: 320, height: 180 } })
  expect(f.coordinator.captureFile('run', f.snapshot(), entry.path, true).file.content).toBe(entry.content)
  expect(modelToolResult('project.apply', reply)).toMatchObject({ kind: 'read', data: { files: result.files } })
  const source = entry.content!.replace('return implementation.mount(context);', 'context.root?.setAttribute("data-authored", "first");\n    return implementation.mount(context);')
  const written = data(await f.execute('project.apply', { path: entry.path, content: source }))
  expect(written.commit).toBe('committed')
  expect(written.files?.find(file => file.path === entry.path)?.content).toBe(source)
  expect(data(await f.execute('project.apply', { path: entry.path, edits: [{ old: '"first"', new: '"second"' }] })).commit).toBe('committed')
  expect(f.files().find(file => file.path === entry.path)?.content).toContain('"second"')
  const currentListing = data(await f.execute('project.list', {}))
  expect(currentListing.files?.find(file => file.path === entry.path)).toMatchObject({ frame: placed, viewport: { width: 320, height: 180 } })
  expect(currentListing.files?.every(file => file.content === undefined)).toBe(true)
})

it('returns the committed Source fact rather than absorbing a later human edit into the next CAS baseline', async () => {
  const initial = project(), implementation = { kind: 'source' as const, language: 'javascript' as const,
    source: 'export default { mount() { return { dispose() {} }; } };' }
  initial.instances.item = { id: 'item', definitionId: WEB_DEFINITION.id, data: { html: '<p>Preserve</p>' }, frame, implementationOverride: implementation }
  testContainerInstance(initial, 0).childIds = ['item']
  const f = await fixture(initial), entry = f.files().find(file => file.binding?.kind === 'instance-source' && !file.authorSource?.dependencyId)!
  await f.execute('project.read', { path: entry.path })
  const ownSource = implementation.source.replace('dispose() {}', 'dispose() { /* own */ }')
  const humanSource = implementation.source.replace('dispose() {}', 'dispose() { /* human */ }')
  f.afterApply(async () => {
    f.afterApply(undefined)
    await f.human([{ type: 'implementation.set', instanceId: 'item', implementation: { ...implementation, source: humanSource } }])
  })
  const result = data(await f.execute('project.apply', { path: entry.path, content: ownSource }))
  expect(result.commit).toBe('committed')
  const fact = result.files?.find(file => file.path === entry.path)
  expect(fact).toMatchObject({ content: ownSource, staleSnapshot: true })
  expect(fact!.currentRevision).toBe(fact!.revision! + 1)
  expect(f.coordinator.captureFile('run', f.snapshot(), entry.path, true).file.content).toBe(ownSource)
  const rejected = data(await f.execute('project.apply', { path: entry.path, edits: [{ old: '/* own */', new: '/* continue */' }] }))
  expect(rejected).toMatchObject({ commit: 'not_committed', receipt: { status: 'conflict', code: 'component-field-conflict' } })
  expect(f.files().find(file => file.path === entry.path)?.content).toBe(humanSource)
})

it('returns inserted object paths, including descendants, and introduces their ACK baseline for the next edit', async () => {
  const f = await fixture(project()), page = f.files().find(file => file.kind === 'structure')!
  await f.execute('project.list', {})
  f.source({ kind: 'objects', objects: [{ definitionId: WEB_DEFINITION.id, data: { html: '<section>parent</section>' }, frame,
    children: [{ definitionId: WEB_DEFINITION.id, data: { html: '<button>child</button>' }, frame }] }] })
  const reply = await f.execute('project.apply', { path: page.path, intent: 'insert', content: '<section>parent</section>' })
  const result = data(reply), inserted = new Set(result.insertedIds)
  expect(result.commit).toBe('committed')
  const rootId = componentSurfaces(f.snapshot().model.project)[0].childIds[0]
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
  testContainerInstance(initial, 0).childIds = ['changed', 'other']
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
  testContainerInstance(initial, 0).childIds = ['selected']
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
  testContainerInstance(initial, 0).childIds = ['parent']
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
  testContainerInstance(initial, 0).childIds = ['item']
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
  testContainerInstance(initial, 0).childIds = ['first', 'second']
  const f = await fixture(initial), first = f.files().find(file => file.target?.kind === 'instance' && file.target.instanceId === 'first' && file.kind === 'html')!
  const second = f.files().find(file => file.target?.kind === 'instance' && file.target.instanceId === 'second' && file.kind === 'html')!
  await f.execute('project.list', {}); f.source(objects('<p>inserted</p>'))
  const result = data(await f.execute('project.apply', { path: first.path, intent: 'insert', content: '<p>inserted</p>' }))
  expect(result.commit).toBe('committed'); expect(result.next).toContain('project.read refresh:true')
  expect(result.repair).toBeDefined()
  expect(result.repair!.read).toEqual(expect.arrayContaining([{ tool: 'project.read', input: { path: second.path, refresh: true } }]))
  expect(result.currentPath).toBe(second.path)
  expect(f.coordinator.captureFile('run', f.snapshot(), second.path, true).file.target).toEqual({ kind: 'instance', instanceId: 'second' })
})

it('preserves committed receipts after read failure and supplies local repair without writing or replaying unresolved results', async () => {
  const f = await fixture(project()), page = f.files().find(file => file.kind === 'structure')!
  await f.execute('project.list', {}); f.source(objects('<p>committed</p>')); f.afterApply(async () => f.failReads())
  const result = data(await f.execute('project.apply', { path: page.path, intent: 'insert', content: '<p>committed</p>' }))
  expect(result).toMatchObject({ commit: 'committed', receipt: { status: 'applied' }, diagnostics: [{ code: 'content-paths-unavailable', message: '任务已停止' }] })
  for (const outcome of ['unknown', 'not_committed'] as const) {
    const g = await fixture(project()), target = g.files().find(file => file.kind === 'structure')!
    const pendingSource = objects('<p>not applied</p>')
    await g.execute('project.list', {}); g.source(pendingSource); g.outcome(outcome)
    const before = g.snapshot()
    const rejected = data(await g.execute('project.apply', { path: target.path, intent: 'insert', content: '<p>not applied</p>' }))
    expect(rejected).toMatchObject({ commit: outcome, input: { intent: 'insert', target: target.target, source: pendingSource } })
    const local = rejected.repair?.read.find(read => read.tool === 'project.read' && read.input.path === target.path)
    expect(local).toBeDefined()
    const repair = data(await g.execute('project.read', local!.input))
    expect(repair).toMatchObject({ path: target.path })
    expect(repair.content).toBe(target.content)
    if (outcome === 'unknown') expect(rejected.repair?.next).toContain('不重新应用原输入')
    expect(g.applies).toBe(1)
    expect(g.snapshot().revision).toBe(before.revision)
    expect(g.snapshot().undoDepth).toBe(before.undoDepth)
    expect(g.snapshot().model).toEqual(before.model)
  }
})

it('selects only current authorized scope and refuses another epoch', async () => {
  const initial = project()
  for (const id of ['selected', 'neighbor']) initial.instances[id] = { id, definitionId: WEB_DEFINITION.id, data: { html: `<p>${id}</p>` }, frame }
  testContainerInstance(initial, 0).childIds = ['selected', 'neighbor']
  const f = await fixture(initial), before = f.snapshot(), original = f.files().find(file => file.kind === 'structure')!
  const result: ContentApplyResult = { commit: 'committed', usability: 'usable', delivery: 'not_requested', diagnostics: [], insertedIds: ['selected', 'neighbor'],
    input: { intent: 'insert', target: original.target!, source: objects('<p>selected</p>') } }
  const scoped = componentProjectApplyReceiptFiles(before, original, result, before, { kind: 'instance', instanceId: 'selected' })
  expect(scoped.files.every(file => file.target?.kind === 'instance' && file.target.instanceId === 'selected')).toBe(true)
  expect(scoped.files.length).toBeGreaterThan(0)
  expect(() => componentProjectApplyReceiptFiles(before, original, result, { ...before, epoch: 'replacement' })).toThrow('工程身份已变化')
})
