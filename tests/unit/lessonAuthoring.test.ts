// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { LessonWorkspaceService } from '../../src/main/lessonWorkspace'
import { LessonMaterials } from '../../src/main/lessonMaterials'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { readLessonGenerationContext } from '../../src/main/localAgent/lessonGenerationContext'
import { LessonAuthoring } from '../../src/main/lessonAuthoring'
import { LESSON_AUTHORING_STAGES } from '../../src/shared/lessonAuthoring'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-authoring-')); roots.push(root)
 const workspace = new LessonWorkspaceService(path.join(root, 'app')), lesson = (await workspace.create(root, '课例')).identity
 const validate = async () => { await workspace.read(lesson) }
 const files = createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'recovery'), validateTarget: validate })
 const materials = new LessonMaterials(validate), authoring = new LessonAuthoring({ workspace, files, materials })
 const refs = LESSON_AUTHORING_STAGES.map(role => ({ kind: 'lesson' as const, lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath: `${role}.md` }))
 for (const [index, ref] of refs.entries()) {
  const saved = await files.saveDocument({ ref, operationId: randomUUID(), expectedVersion: null, source: `# 当前 ${ref.relativePath}`, attachments: [] })
  expect(saved.status).toBe('saved'); await workspace.registerDocument(lesson, LESSON_AUTHORING_STAGES[index]!, ref.relativePath)
 }
 return { root, workspace, lesson, files, materials, authoring, refs }
}
async function confirmAll(f: Awaited<ReturnType<typeof fixture>>) {
 for (const [index, role] of LESSON_AUTHORING_STAGES.entries()) await f.authoring.confirm(f.lesson, role, (await f.files.openDocument(f.refs[index]!)).version)
}
async function material(f: Awaited<ReturnType<typeof fixture>>) {
 const target = { lessonId: f.lesson.lessonId, rootPath: f.lesson.normalizedDirectory }
 const record = await f.materials.import(target, { title: '材料', original: new TextEncoder().encode('电流形成闭合回路'), extraction: {
  version: 1, extractorVersion: 'test', format: 'text', fragments: [{ id: 'body', kind: 'text', text: '电流形成闭合回路', locator: { part: '正文', page: 1 } }], assets: [], gaps: [{ locator: { part: '附录', page: 2 }, reason: '无关附录未读' }],
 } })
 return { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: ['body'] }
}
describe('lesson authoring current-file gates', () => {
 it('U08-current-file-guards saves invalid raw Markdown with codec diagnostics and rejects confirmation until repaired', async () => {
  const f = await fixture(), ref = f.refs[0]!, initial = await f.files.openDocument(ref)
  const invalid = await f.files.saveDocument({ ref, operationId: randomUUID(), expectedVersion: initial.version, source: '- 原稿\n  - 嵌套项目\n', attachments: [] })
  expect(invalid.status).toBe('saved')
  const disk = await f.files.openDocument(ref)
  expect(disk.diagnostics.length).toBeGreaterThan(0)
  expect(disk.diagnostics[0]!.line).toBeGreaterThanOrEqual(1)
  await expect(f.authoring.confirm(f.lesson, 'teaching-brief', disk.version)).rejects.toThrow()
  const repaired = await f.files.saveDocument({ ref, operationId: randomUUID(), expectedVersion: disk.version, source: '# 教学简报\n\n- 平铺项目与 **重点**\n\n公式 $x+1$。\n', attachments: [] })
  expect(repaired.status).toBe('saved')
  const current = await f.files.openDocument(ref)
  expect(current.diagnostics).toEqual([])
  await expect(f.authoring.confirm(f.lesson, 'teaching-brief', current.version)).resolves.toBeTruthy()
 })
 it('allows clean viewed files but blocks regenerating an output with an actual pending draft', async () => {
  const f = await fixture(), ref = f.refs[0]!, disk = await f.files.openDocument(ref)
  await f.files.preserveDraft(ref, disk.source, disk.version)
  expect((await f.authoring.read(f.lesson)).documents.some(document => document.role === 'teaching-brief')).toBe(true)
  await expect(f.authoring.beginTask(f.lesson, 'teaching-brief')).resolves.toMatchObject({ stage: 'teaching-brief' })
  await f.files.preserveDraft(ref, disk.source + '\n教师尚未保存', disk.version)
  await expect(f.authoring.beginTask(f.lesson, 'teaching-brief')).rejects.toThrow('未保存稿')
  expect((await f.files.openDocument(ref)).source).toBe(disk.source)
 })
 it('requires four separate current confirmations and preserves them across restart', async () => {
  const f = await fixture()
  expect((await f.authoring.read(f.lesson)).currentStage).toBe('teaching-brief')
  await expect(f.authoring.confirm(f.lesson, 'teaching-plan', (await f.files.openDocument(f.refs[1]!)).version)).rejects.toThrow('分别确认')
  expect((await f.authoring.validateBuild(f.lesson)).allowed).toBe(false)
  await confirmAll(f)
  const restored = new LessonAuthoring({ workspace: f.workspace, files: f.files, materials: f.materials })
  expect((await restored.validateBuild(f.lesson)).allowed).toBe(true)
  const persisted = await fs.readFile(path.join(f.lesson.normalizedDirectory, '.courseware', 'authoring-state.json'), 'utf8')
  expect(persisted).not.toContain('# 当前'); expect((await restored.read(f.lesson)).currentStage).toBe('build')
 })
 it('invalidates confirmations, downstream review and a build ticket after an attachment changes', async () => {
  const f = await fixture(), ref = f.refs[0]!, disk = await f.files.openDocument(ref)
  expect((await f.files.saveDocument({ ref, operationId: randomUUID(), expectedVersion: disk.version, source: '# 简报\n![图](assets/diagram.png)', attachments: [{ relativePath: 'assets/diagram.png', bytes: new Uint8Array([1, 2, 3]) }] })).status).toBe('saved')
  await confirmAll(f); const ticket = await f.authoring.beginTask(f.lesson, 'build')
  await fs.writeFile(path.join(f.lesson.normalizedDirectory, 'assets', 'diagram.png'), new Uint8Array([3, 2, 1]))
  const view = await f.authoring.read(f.lesson)
  expect(view.currentStage).toBe('teaching-brief'); expect(view.documents.every(document => document.status === 'review')).toBe(true)
  expect((await f.authoring.validateTask(f.lesson, ticket)).allowed).toBe(false)
  expect(await fs.readFile(path.join(f.lesson.normalizedDirectory, f.refs[3]!.relativePath), 'utf8')).toContain('当前')
 })
 it('rejects stale confirmation and pending recovery without claiming saved content', async () => {
  const f = await fixture(), ref = f.refs[0]!, disk = await f.files.openDocument(ref)
  await fs.writeFile(path.join(f.lesson.normalizedDirectory, ref.relativePath), '# 教师改稿')
  await expect(f.authoring.confirm(f.lesson, 'teaching-brief', disk.version)).rejects.toThrow('已变化')
  const current = await f.files.openDocument(ref); await f.files.preserveDraft(ref, '# 未保存稿', current.version)
  await expect(f.authoring.confirm(f.lesson, 'teaching-brief', current.version)).rejects.toThrow()
  expect((await f.authoring.validateBuild(f.lesson)).issues.join()).toContain('未保存稿')
 })
 it('starts automatic only by actual selected material reads and rechecks original bytes before build', async () => {
  const f = await fixture()
  await expect(f.authoring.setMode(f.lesson, 'automatic')).rejects.toThrow('成功读取')
  const selected = await material(f)
  const view = await f.authoring.setMode(f.lesson, 'automatic', [selected])
  expect(view.state.mode).toBe('automatic'); expect((await f.authoring.validateBuild(f.lesson)).allowed).toBe(true)
  expect(view.documents.every(document => document.status !== 'confirmed')).toBe(true)
  await fs.writeFile(path.join(f.lesson.normalizedDirectory, 'materials', selected.id, 'original.txt'), '已改材料')
  expect((await f.authoring.validateBuild(f.lesson)).allowed).toBe(false)
 })
 it('accepts an actual stage output after polling but Stop and changed input invalidate its ticket', async () => {
  const f = await fixture(), selected = await material(f)
  await f.authoring.setMode(f.lesson, 'automatic', [selected])
  const ticket = await f.authoring.beginTask(f.lesson, 'teaching-plan'), ref = f.refs[1]!, current = await f.files.openDocument(ref)
  const saved = await f.files.saveDocument({ ref, operationId: randomUUID(), expectedVersion: current.version, source: '# 新策划', attachments: [] })
  if (saved.status !== 'saved') throw new Error('save failed')
  await f.authoring.read(f.lesson)
  const completed = await f.authoring.completeTask(f.lesson, ticket, saved.version)
  expect(completed.documents.find(document => document.role === 'teaching-plan')!.status).toBe('draft')
  expect(completed.documents.find(document => document.role === 'presentation-script')!.status).toBe('review')
  expect((await f.authoring.validateBuild(f.lesson)).allowed).toBe(false)
  const next = await f.authoring.beginTask(f.lesson, 'presentation-brief'); await f.authoring.stop(f.lesson)
  await expect(f.authoring.completeTask(f.lesson, next, (await f.files.openDocument(f.refs[2]!)).version)).rejects.toThrow('失效')
 })
})

it('generation rereads four real files and actual material receipts and refuses stale confirmation', async () => {
 const f = await fixture(), selection = await material(f)
 await f.authoring.setMode(f.lesson, 'automatic', [selection])
 const current = await readLessonGenerationContext(f.lesson, f, true)
 expect(current.context.documents).toHaveLength(4)
 expect(current.confirmedDocuments?.teachingPlan).toContain('teaching-plan.md')
 expect(current.context.materials[0]?.fragments[0]?.text).toBe('电流形成闭合回路')
 expect(current.context.materials[0]?.readAt).toBeTruthy()
 await f.authoring.setMode(f.lesson, 'manual'); await confirmAll(f)
 await fs.writeFile(path.join(f.lesson.normalizedDirectory, 'teaching-plan.md'), '# 教师新稿')
 await expect(readLessonGenerationContext(f.lesson, f, true)).rejects.toThrow()
 const refreshed = await readLessonGenerationContext(f.lesson, f, false)
 expect(refreshed.context.documents.find(doc => doc.role === 'teaching-plan')?.content).toBe('# 教师新稿')
})

it('manual mode reads selected materials while retaining four separate confirmation gates', async () => {
 const f = await fixture(), selection = await material(f)
 const view = await f.authoring.setMode(f.lesson, 'manual', [selection])
 expect(view.state.materials[0]?.id).toBe(selection.id)
 expect((await f.authoring.validateBuild(f.lesson)).allowed).toBe(false)
 await confirmAll(f)
 expect((await readLessonGenerationContext(f.lesson, f, true)).context.materials[0]?.fragments[0]?.text).toBe('电流形成闭合回路')
})
