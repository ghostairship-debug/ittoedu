// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { buildSync } from 'esbuild'
import { chromium } from 'playwright'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { currentCompositionGatewayFixture, currentCompositionProject, currentCompositionText, currentFragmentPrompt } from '../helpers/currentCompositionGatewayFixture'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
function harness() {
  const driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('File required'); await fs.writeFile(input.binding.path, input.bytes); return { ...input.binding, version: `revision-${input.revision}` } } } })
  return { driver, registry, gateway: new DocumentToolGateway(registry, [driver], randomUUID) }
}
const operation = (before: DocumentSnapshot, edits: ComponentEdit[]) => ({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
  actor: 'human' as const, operationId: randomUUID(), mutation: { type: 'command' as const, command: captureComponentOperation(currentCompositionProject(before.model), edits) } })
const affected = (result: ToolResult) => { if (result.kind !== 'document-operation' || !result.affected[0]) throw new Error('Fresh handle required'); return result.affected[0] }
const applied = (result: ToolResult) => expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })

it('edits current subtree styles and exact Web author text through one writer, preserves manual CSS/source/resources, and reopens the visible result', async () => {
  const { driver, registry, gateway } = harness(), source = currentCompositionGatewayFixture()
  const session = await registry.create(source.model, 'composition.glx')
  expect(await session.execute(operation(session.read(), [
    { type: 'style.set', instanceId: 'left', path: ['padding'], value: '27px' },
    { type: 'style.set', instanceId: 'left', path: ['color'], value: '#274e73' },
    { type: 'style.set', instanceId: 'left', path: ['--TeacherInk'], value: 'navy' },
    { type: 'style.set', instanceId: 'left', path: ['background-image'], value: 'linear-gradient(90deg, red, blue)' },
  ]))).toMatchObject({ status: 'applied' })
  const manual = session.read(), commands: string[] = []
  session.subscribeCommits(commit => { if (commit.operation.actor === 'agent' && commit.operation.mutation.type === 'command') commands.push(commit.operation.mutation.command.type) })
  await gateway.beginRun({ runId: 'author', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const selected = await gateway.issueTarget('author', session.documentId, source.selection)
  const children = await gateway.execute('author', 'discover', { name: 'listChildren', input: { target: selected } })
  expect(children).toMatchObject({ kind: 'read', data: [{ label: 'paragraph' }, { label: 'picture' }, { label: 'interaction' }] })
  if (children.kind !== 'read') throw new Error('Children required')
  for (const child of children.data as object[]) for (const key of ['instanceId', 'documentId', 'epoch', 'revision']) expect(child).not.toHaveProperty(key)
  applied(await gateway.execute('author', 'style', { name: 'object.update', input: { target: selected, properties: { style: { gap: '31px' } } } }))
  expect(currentCompositionProject(session.read().model).instances.left.style).toEqual({ ...currentCompositionProject(manual.model).instances.left.style, gap: '31px' })
  const text = await gateway.issueTarget('author', session.documentId, source.textTarget)
  const newText = '根据实际观察说明结论，并写出支持判断的证据。'
  const written = await gateway.execute('author', 'text', { name: 'text.replace', input: { target: text, content: newText } }); applied(written)
  const after = session.read(), afterProject = currentCompositionProject(after.model)
  expect(currentCompositionText(after.model)).toBe(newText)
  expect(after.undoDepth).toBe(manual.undoDepth + 2); expect(commands).toEqual(['component-platform.apply', 'component-platform.apply'])
  expect(await gateway.execute('author', 'unchanged', { name: 'text.replace', input: { target: affected(written), content: newText } })).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  expect(session.read().revision).toBe(after.revision); expect(session.read().undoDepth).toBe(after.undoDepth)
  for (const type of ['undo', 'redo'] as const) {
    const before = session.read()
    expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, actor: 'human', operationId: randomUUID(), mutation: { type } })).toMatchObject({ status: 'applied' })
    expect(currentCompositionText(session.read().model)).toBe(type === 'undo' ? currentFragmentPrompt : newText)
    expect(currentCompositionProject(session.read().model).instances.left).toEqual(afterProject.instances.left)
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-current-')); roots.push(root)
  const filename = path.join(root, 'composition.glx')
  await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
  const reopened = driver.load(new Uint8Array(await fs.readFile(filename))), reopenedProject = currentCompositionProject(reopened)
  expect(reopenedProject).toEqual(currentCompositionProject(session.read().model)); expect(reopened.resources).toEqual(source.resources)
  for (const id of ['heading', 'picture', 'interaction', 'chart', 'right', 'shared-picture', 'native-picture']) expect(reopenedProject.instances[id]).toEqual(source.project.instances[id])
  const data = reopenedProject.instances.paragraph.data as { html: string; css: string; authoringRecords: unknown }
  expect(data.html).toBe((source.project.instances.paragraph.data as typeof data).html); expect(data.css).toBe((source.project.instances.paragraph.data as typeof data).css)
  // The saved author record is consumed by the real DOM adapter on a cold mount.
  const bundle = buildSync({ stdin: { contents: "export {createDomAuthoring} from './src/components/web/authoringDom'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'CurrentAuthoring', platform: 'browser' }).outputFiles[0].text
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage(); await page.setContent('<div id="host"></div>'); await page.addScriptTag({ content: bundle })
    expect(await page.evaluate(value => {
      const root = document.getElementById('host')!; root.innerHTML = value.html
      const consumer = (window as any).CurrentAuthoring.createDomAuthoring(root, { records: () => value.authoringRecords })
      const text = root.querySelector('p')!.textContent; consumer.dispose(); return text
    }, data)).toBe(newText)
  } finally { await browser.close() }
}, 30_000)

it('isolates identical author keys by document/run and refuses read-only, stale, locked and stopped writes without AI history', async () => {
  const { registry, gateway } = harness(), sourceA = currentCompositionGatewayFixture(), sourceB = currentCompositionGatewayFixture()
  const a = await registry.create(sourceA.model, 'a.glx'), b = await registry.create(sourceB.model, 'b.glx')
  for (const [runId, session] of [['run-a', a], ['run-b', b]] as const) await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const targetA = await gateway.issueTarget('run-a', a.documentId, sourceA.textTarget), targetB = await gateway.issueTarget('run-b', b.documentId, sourceB.textTarget)
  const beforeA = a.read(), beforeB = b.read()
  expect(await gateway.execute('run-b', 'foreign', { name: 'text.replace', input: { target: targetA, content: '跨任务错误修改' } })).toMatchObject({ kind: 'error', code: 'invalid-target' })
  expect(a.read()).toEqual(beforeA); expect(b.read()).toEqual(beforeB)
  const written = await gateway.execute('run-a', 'a', { name: 'text.replace', input: { target: targetA, content: 'A 的独立正文' } }); applied(written)
  expect(currentCompositionText(a.read().model)).toBe('A 的独立正文'); expect(b.read()).toEqual(beforeB)
  // This run's acknowledged field handle supports continuation; an intervening human edit invalidates its frozen value.
  const readOnly = await gateway.issueTarget('run-a', a.documentId, sourceA.textTarget, { readOnly: true })
  expect(await gateway.execute('run-a', 'readonly', { name: 'text.replace', input: { target: readOnly, content: '只读错误修改' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const fresh = affected(written)
  expect(await a.execute(operation(a.read(), [{ type: 'data.set', instanceId: 'paragraph', path: sourceA.textTarget.dataPath, value: '教师正文' }]))).toMatchObject({ status: 'applied' })
  const manual = a.read()
  const stale = await gateway.execute('run-a', 'stale', { name: 'text.replace', input: { target: targetA, content: '旧句柄错误覆盖' } }); expect(stale, JSON.stringify(stale)).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(a.read()).toEqual(manual)
  const lockedField = await gateway.issueTarget('run-a', a.documentId, sourceA.textTarget)
  expect(await a.execute(operation(a.read(), [{ type: 'instance.patch', instanceId: 'quality-composition', patch: { locked: true } }]))).toMatchObject({ status: 'applied' })
  const locked = a.read()
  const rejected = await gateway.execute('run-a', 'locked', { name: 'text.replace', input: { target: lockedField, content: '锁定错误修改' } }); expect(rejected, JSON.stringify(rejected)).toMatchObject({ kind: 'error', code: 'invalid-operation', message: expect.stringContaining('锁定') })
  expect(a.read()).toEqual(locked)
  await gateway.stop('run-a')
  expect(await gateway.execute('run-a', 'stopped', { name: 'text.replace', input: { target: fresh, content: '停止后错误修改' } })).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(a.read()).toEqual(locked)
  applied(await gateway.execute('run-b', 'b', { name: 'text.replace', input: { target: targetB, content: 'B 的独立正文' } }))
  expect(currentCompositionText(b.read().model)).toBe('B 的独立正文'); expect(b.read().undoDepth).toBe(1); expect(a.read()).toEqual(locked)
})

it('enforces final Session CAS when a human edits the bound text after AI planning and before canonical submission', async () => {
  const { registry, gateway } = harness(), source = currentCompositionGatewayFixture()
  source.project.instances.left.style = { padding: '27px', '--TeacherInk': 'navy', color: '#274e73' }
  const session = await registry.create(source.model, 'cas.glx')
  await gateway.beginRun({ runId: 'cas', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const text = await gateway.issueTarget('cas', session.documentId, source.textTarget), before = session.read(), execute = session.execute.bind(session)
  const spy = vi.spyOn(session, 'execute').mockImplementationOnce(async request => {
    expect(request).toMatchObject({ actor: 'agent', baseRevision: before.revision, mutation: { type: 'command', command: { type: 'component-platform.apply' } } })
    expect(await execute(operation(before, [{ type: 'data.set', instanceId: 'paragraph', path: source.textTarget.dataPath, value: '教师刚刚修改的正文' }]))).toMatchObject({ status: 'applied' })
    return execute(request)
  })
  expect(await gateway.execute('cas', 'racing', { name: 'text.replace', input: { target: text, content: '过期 AI 正文' } })).toMatchObject({ kind: 'document-operation', result: { status: 'conflict', code: 'stale-revision' } })
  expect(spy).toHaveBeenCalledTimes(1); expect(currentCompositionText(session.read().model)).toBe('教师刚刚修改的正文')
  expect(currentCompositionProject(session.read().model).instances.left).toEqual(source.project.instances.left)
  expect(session.read()).toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1, undoHead: { actor: 'human' } })
})
