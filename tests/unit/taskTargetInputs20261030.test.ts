// @vitest-environment node
import { expect, it } from 'vitest'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'
import type { PreparedTaskSource } from '../../src/shared/workbench/toolPorts'

async function fixture() {
  const project = createBlankCourseProjectV10('Frozen target')
  project.definitions.main = { id: 'main', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: "import { label } from 'Helper'; export const document = 'web'; export function mount(c) { c.root.textContent = label; return { dispose() {} } }",
    moduleBindings: { Helper: 'helper' } } }
  project.definitions.helper = { id: 'helper', role: 'content', implementation: { kind: 'source', language: 'javascript', source: "export const label = 'HELPER_SOURCE'" } }
  project.definitions.other = { id: 'other', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: "export const document = 'web'; export function mount(c) { c.root.textContent = 'PRIVATE_OTHER_SOURCE'; return { dispose() {} } }" } }
  project.instances.a = { id: 'a', definitionId: 'main', data: { caption: 'original target' },
    frame: { width: 380, height: 560, transform: [1, 0, 0, 1, 40, 40] } }
  project.instances.b = { id: 'b', definitionId: 'other', data: { caption: 'PRIVATE_OTHER_DATA' },
    frame: { width: 380, height: 560, transform: [1, 0, 0, 1, 440, 40] } }
  const surface = testContainerInstance(project, 0); surface.childIds = ['a', 'b']
  const session = await DocumentSession.create({ documentId: 'target-input', epoch: 'epoch',
    binding: { kind: 'untitled', suggestedName: 'target.glx' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, new CourseV10Driver(),
  { async append() {}, async save() { throw new Error('Must not save parent') } })
  const snapshot = () => session.read() as ComponentProjectSnapshot
  let reads = 0, beforeRead: ((count: number) => Promise<void>) | undefined, serial = 0
  const coordinator = new ComponentProjectFileCoordinator({
    async document() { await beforeRead?.(++reads); return snapshot() },
    scope: (_run, selector) => selector === 'only-a' ? { kind: 'instance', instanceId: 'a' } : { kind: 'document' },
    async apply() { throw new Error('Must not write parent') }, async source() { throw new Error('No external source needed') },
  })
  const files = () => componentProjectFiles(snapshot().model.project, snapshot().model.resources)
  const targetPath = files().find(file => file.path.endsWith('.view.js') && file.target?.kind === 'instance' && file.target.instanceId === 'a')!.path
  const human = async (edits: ComponentEdit[]) => {
    const current = snapshot()
    await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: 'human-' + ++serial, actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(current.model.project, edits) } })
  }
  return { coordinator, snapshot, files, targetPath, human, surfaceId: surface.id,
    beforeRead: (callback: (count: number) => Promise<void>) => { reads = 0; beforeRead = callback } }
}
const decode = (source: PreparedTaskSource) => new TextDecoder().decode(source.bytes)
type InputsContext = { revision: number; currentPath?: string; inputs: {
  entry: { path: string; read: { tool: string; path: string } }; files: Array<{ path: string; projectPath: string }> } }

it('freezes current unsaved target Source and its dependency/API files without sibling data or an observed-write refresh', async () => {
  const h = await fixture()
  await h.coordinator.execute('run', 'list', 'list', 'project.list', {})
  const original = h.snapshot()
  await h.human([
    { type: 'data.set', instanceId: 'a', path: ['caption'], value: 'UNSAVED_TARGET' },
    { type: 'instance.move', instanceId: 'b', container: { kind: 'surface', surfaceId: h.surfaceId }, index: 0 },
  ])
  const result = await h.coordinator.prepareTaskTargetInputs('run', { path: h.targetPath })
  const context = result.context as InputsContext
  expect(context.revision).toBe(h.snapshot().revision)
  expect(context.currentPath).not.toBe(h.targetPath)
  expect(result.sources.some(source => source.name === context.inputs.entry.read.path)).toBe(true)
  expect(context.inputs.entry.read.tool).toBe('file.read')
  expect(result.sources.map(decode).join('\n')).toContain('HELPER_SOURCE')
  expect(result.sources.map(decode).join('\n')).toContain('UNSAVED_TARGET')
  expect(result.sources.map(decode).join('\n')).not.toMatch(/PRIVATE_OTHER_(SOURCE|DATA)/)
  expect(result.sources.some(source => source.name.endsWith('/references/component-api5.md'))).toBe(true)
  expect(h.coordinator.captureFile('run', h.snapshot(), h.targetPath).snapshot.revision).toBe(original.revision)
  expect(h.snapshot()).toMatchObject({ dirty: true, undoDepth: 1 })
  const other = h.files().find(file => file.target?.kind === 'instance' && file.target.instanceId === 'b')!
  await expect(h.coordinator.prepareTaskTargetInputs('run', { project: 'only-a', path: other.path })).rejects.toThrow()
})

it('keeps a complete dependency tree together on case-insensitive collisions and only reuses equal version, bytes and prefix', async () => {
  const h = await fixture()
  const occupied: PreparedTaskSource = { source: 'material', name: '__TASK_TARGET\\private.txt', mimeType: 'text/plain', bytes: new Uint8Array([1]) }
  const result = await h.coordinator.prepareTaskTargetInputs('run', { path: h.targetPath }, undefined, [occupied])
  expect(result.sources.length).toBeGreaterThan(2)
  expect(result.sources.every(source => source.name.startsWith('__task_target-2/'))).toBe(true)
  const reused = await h.coordinator.prepareTaskTargetInputs('run', { path: h.targetPath }, undefined, result.sources)
  expect(reused.sources).toEqual([])
  expect((reused.context as InputsContext).inputs.entry.read.path).toBe((result.context as InputsContext).inputs.entry.read.path)
  const changed = result.sources.map((source, index) => index ? source : { ...source, bytes: new TextEncoder().encode('DIFFERENT_BYTES') })
  expect((await h.coordinator.prepareTaskTargetInputs('run', { path: h.targetPath }, undefined, changed)).sources.length).toBe(result.sources.length)
  const brokenTree = result.sources.map((source, index) => index ? source : { ...source, name: 'elsewhere/' + source.name.split('/').slice(1).join('/') })
  expect((await h.coordinator.prepareTaskTargetInputs('run', { path: h.targetPath }, undefined, brokenTree)).sources.length).toBe(result.sources.length)
})

it('rejects a target changed between context resolution and materialization, without applying or saving', async () => {
  const h = await fixture()
  h.beforeRead(async count => { if (count === 2) await h.human([{ type: 'data.set', instanceId: 'a', path: ['caption'], value: 'changed concurrently' }]) })
  await expect(h.coordinator.prepareTaskTargetInputs('run', { path: h.targetPath })).rejects.toMatchObject({ code: 'stale-revision' })
  expect(h.snapshot()).toMatchObject({ revision: 1, dirty: true, undoDepth: 1 })
})
