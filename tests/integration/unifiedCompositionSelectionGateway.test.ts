// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
import { currentCompositionGatewayFixture, currentCompositionProject, currentCompositionText, currentFragmentPrompt } from '../helpers/currentCompositionGatewayFixture'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
const operation = (before: DocumentSnapshot, edits: ComponentEdit[]) => ({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: randomUUID(), actor: 'human' as const,
  mutation: { type: 'command' as const, command: captureComponentOperation(currentCompositionProject(before.model), edits) } })
async function harness(runId: string, fieldOnly = false) {
  const source = currentCompositionGatewayFixture(), driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('File required'); await fs.writeFile(input.binding.path, input.bytes); return { ...input.binding, version: `revision-${input.revision}` } } } })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID), session = await registry.create(source.model, 'selection.glx')
  await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: [fieldOnly ? source.textTarget : source.selection] }] })
  const issue = (target: ToolTarget, readOnly = false) => gateway.issueTarget(runId, session.documentId, target, { readOnly })
  const call = (name: string, input: unknown) => gateway.execute(runId, randomUUID(), { name, input })
  const read = async (target: string) => {
    const result = await call('read', { target, limit: 640 })
    expect(result).toMatchObject({ kind: 'read', data: { truncated: false, text: expect.any(String) } })
    if (result.kind !== 'read') throw new Error('Read required')
    return result.data as { target: string; text: string }
  }
  return { source, driver, registry, gateway, session, issue, call, read }
}
const affected = (result: ToolResult) => { if (result.kind !== 'document-operation' || !result.affected[0]) throw new Error('Fresh handle required'); return result.affected[0] }

it('discovers only the selected current subtree and refuses parent, sibling and whole-object writes outside an exact text grant', async () => {
  const f = await harness('selection-range'), before = f.session.read(), selected = await f.issue(f.source.selection)
  expect(JSON.parse((await f.read(selected)).text)).toEqual(f.source.project.instances.left)
  const children = await f.call('listChildren', { target: selected })
  expect(children).toMatchObject({ kind: 'read', data: [{ label: 'paragraph', kind: 'course-instance' }, { label: 'picture', kind: 'course-instance' }, { label: 'interaction', kind: 'course-instance' }] })
  if (children.kind !== 'read') throw new Error('Children required')
  const childReads = []
  for (const child of children.data as Array<{ target: string }>) {
    childReads.push(JSON.parse((await f.read(child.target)).text))
    expect(await f.call('inspect', { target: child.target })).toMatchObject({ kind: 'read', data: { writable: true } })
  }
  expect(childReads.map(child => child.id)).toEqual(['paragraph', 'picture', 'interaction'])
  expect(childReads[0].data.authoringRecords.paragraph.binding.baseline).toBe(currentFragmentPrompt)
  expect(childReads[1].data.resourceBindings).toEqual({ photo: 'source-photo' })
  for (const id of ['heading', 'right', 'chart']) expect(JSON.stringify(childReads)).not.toContain(`"id":"${id}"`)
  for (const target of [f.source.target, f.source.instanceTarget('right'), f.source.instanceTarget('chart')]) {
    const escaped = await f.issue(target)
    expect(await f.call('inspect', { target: escaped })).toMatchObject({ kind: 'read', data: { writable: false } })
    expect(await f.call('object.update', { target: escaped, properties: { opacity: 0.4 } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(f.session.read()).toEqual(before)
  }
  // A selected field owns only its value, even though its parent is a real editable free object.
  const narrow = await harness('selection-field', true), field = await narrow.issue(narrow.source.textTarget), baseline = narrow.session.read()
  expect((await narrow.read(field)).text).toBe(currentFragmentPrompt)
  for (const target of [field, await narrow.issue(narrow.source.instanceTarget('paragraph')), await narrow.issue(narrow.source.selection)]) {
    expect(await narrow.call('object.update', { target, properties: { opacity: 0.4 } })).toMatchObject({ kind: 'error' })
    expect(narrow.session.read()).toEqual(baseline)
  }
  expect(await narrow.call('text.replace', { target: await narrow.issue(narrow.source.imageTarget), content: 'data:image/png;base64,wrong' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(narrow.session.read()).toEqual(baseline)
})

it('retains frozen text authority after unrelated sibling edits, commits one local history, and saves and reopens exact source and resources', async () => {
  const f = await harness('selection-save'), before = f.session.read(), field = await f.issue(f.source.textTarget)
  expect(await f.session.execute(operation(before, [{ type: 'style.set', instanceId: 'right', path: ['padding'], value: '29px' }]))).toMatchObject({ status: 'applied' })
  const manual = f.session.read(), newText = '比较观察前后的变化，用证据支持自己的解释。'
  const written = await f.call('text.replace', { target: field, content: newText })
  expect(written, JSON.stringify(written)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read()
  expect(currentCompositionText(after.model)).toBe(newText)
  expect(after).toMatchObject({ undoDepth: manual.undoDepth + 1, undoHead: { actor: 'agent' } })
  expect((await f.read(affected(written))).text).toBe(newText)
  expect(await f.call('text.replace', { target: affected(written), content: newText })).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  expect(f.session.read().revision).toBe(after.revision); expect(f.session.read().undoDepth).toBe(after.undoDepth)
  const afterProject = currentCompositionProject(after.model), manualProject = currentCompositionProject(manual.model)
  for (const id of ['quality-composition', 'left', 'right', 'heading', 'chart', 'picture', 'interaction', 'shared-picture', 'native-picture']) expect(afterProject.instances[id]).toEqual(manualProject.instances[id])
  const beforeData = manualProject.instances.paragraph.data as Record<string, unknown>, afterData = afterProject.instances.paragraph.data as Record<string, unknown>
  expect(afterData.html).toBe(beforeData.html); expect(afterData.css).toBe(beforeData.css)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-selection-')); roots.push(root)
  const filename = path.join(root, 'selection.glx')
  await f.registry.save(f.session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
  const reopened = f.driver.load(new Uint8Array(await fs.readFile(filename)))
  expect(currentCompositionProject(reopened)).toEqual(currentCompositionProject(f.session.read().model)); expect(reopened.resources).toEqual(manual.model.resources)
  expect(currentCompositionText(reopened)).toBe(newText); expect(f.session.read().dirty).toBe(false)
})

it('refuses human changes to text, ownership, ancestor lock, selected identity or the exact DOM binding without overwriting human history', async () => {
  for (const change of ['content', 'move', 'lock', 'remove', 'binding'] as const) {
    const f = await harness(`selection-${change}`), field = await f.issue(f.source.textTarget)
    const edit: ComponentEdit = change === 'content'
      ? { type: 'data.set', instanceId: 'paragraph', path: f.source.textTarget.dataPath, value: '教师已经改写的正文' }
      : change === 'move' ? { type: 'instance.move', instanceId: 'paragraph', container: { kind: 'instance', instanceId: 'right' }, index: 1, frame: { ...f.source.project.instances.paragraph.frame!, transform: [1, 0, 0, 1, -390, 0] } }
        : change === 'lock' ? { type: 'instance.patch', instanceId: 'left', patch: { locked: true } }
          : change === 'remove' ? { type: 'instance.remove', instanceId: 'left' }
            : { type: 'data.set', instanceId: 'paragraph', path: ['authoringRecords', 'paragraph', 'binding', 'baseline'], value: '重新绑定的原文' }
    const human = await f.session.execute(operation(f.session.read(), [edit])); expect(human, `${change}: ${JSON.stringify(human)}`).toMatchObject({ status: 'applied' })
    const manual = f.session.read()
    expect(await f.call('text.replace', { target: field, content: '错误覆盖新正文或选区外字段' })).toMatchObject({ kind: 'error' })
    expect(f.session.read()).toEqual(manual); expect(f.session.read().undoHead?.actor).toBe('human')
  }
})
