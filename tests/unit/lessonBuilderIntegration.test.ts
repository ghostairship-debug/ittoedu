import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { executeLessonAssembly, LessonAssemblyError, observeEmptyLessonBuildTarget } from '../../src/renderer/lessonAuthoring/builderIntegration'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { courseAuthoringScopeFromLocation } from '../../src/renderer/authoring/courseAuthoringScope'
import { applyEditorTransactionStep } from '../../src/renderer/authoring/editorTransaction'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { lessonAuthoringTicketSchema } from '../../src/shared/lessonAuthoring'
import type { CoursewareBuilderV2Owner, CoursewareBuilderV2 } from '../../src/renderer/course/coursewareBuilderV2'
import { validateLessonBuilderModule, type LessonAssemblyInput } from '../../src/shared/lessonAuthoringDesktop'
import type { HistoryResourceState } from '../../src/renderer/store/courseResourceState'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture'); await fs.rm(root, { recursive: true, force: true }) } })
function input(): LessonAssemblyInput {
 return { ticket: lessonAuthoringTicketSchema.parse({ schemaVersion: 1, id: randomUUID(), lesson: { schemaVersion: 1, lessonId: randomUUID(), normalizedDirectory: 'c:/lessons/fixture' }, epoch: 0, controlEpoch: 0, stage: 'build', mode: 'manual', inputs: [], materials: [] }), modulePath: 'fixture.mjs', moduleSource: 'fixture injected module', documents: { teachingPlan: { path: 'plan.md', content: '# 策划' }, presentationScript: { path: 'script.md', content: '# 脚本' } } }
}
describe('same-window lesson Builder owner integration', () => {
 it('parses module dependencies without mistaking comments or teaching strings for imports', () => {
  expect(() => validateLessonBuilderModule('export const note = "import(example) is a teaching string"; // import x from "y"')).not.toThrow()
  expect(() => validateLessonBuilderModule('/* comment */ import x from "other"')).toThrow('不能导入')
  expect(() => validateLessonBuilderModule('export { x } from "other"')).toThrow('不能导入')
 })
 it('commits through only the injected canonical owner and saves a real reopenable V9 archive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-builder-owner-')); roots.push(root)
  let project = createBlankCourseProject({ title: 'Before', includeDefaultController: false, controls: 'none' })
  let resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }
  let scope = courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }), generation = 1, commits = 0, creates = 0, checks = 0
  const owner: CoursewareBuilderV2Owner = {
   readDocument: () => project, readResources: () => resources, readScope: () => scope, readGeneration: () => generation,
   activate(next) { scope = courseAuthoringScopeFromLocation({ project, ...next }); generation++ },
   validateDestination(destination) { const target = destination.kind === 'update' ? destination.target : destination.scope; return target.projectId === project.id && target.sessionGeneration === generation ? null : { code: 'stale', message: 'stale owner', path: [] } },
   commit(step) { const next = applyEditorTransactionStep({ document: project, resources }, step, 'forward'); project = next.document; resources = next.resources; commits++; return true },
  }
  const filename = await executeLessonAssembly(input(), {
   createCourseProject: async options => { creates++; project = createBlankCourseProject({ title: options.title, includeDefaultController: false, controls: 'none' }); scope = courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }) },
   owner: () => owner, validate: async () => { checks++; return { allowed: true, issues: [] } }, readAsset: async () => new Uint8Array(), componentCatalog: async () => ({ version: 1, sources: [] }) as never,
   importModule: async () => ({ apiVersion: 2, default: async raw => {
    expect((raw as { encodeBase64(value: string | Uint8Array): string }).encodeBase64('电路✓')).toBe('55S16Lev4pyT')
      expect((raw as { encodeBase64(value: string | Uint8Array): string }).encodeBase64(new Uint8Array([0,255,128]))).toBe('AP+A')
      const { api } = raw as { api: { createCourseProject(options: { surfaceType: 'slide'; title: string }): Promise<CoursewareBuilderV2> } }
    const builder = await api.createCourseProject({ surfaceType: 'slide', title: '真实电路课件' })
    const receipt = await builder.execute('native.content', { operation: 'insert', template: { nativeType: 'text', text: '闭合回路形成电流' } }, { kind: 'create', scope: builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } }) })
    expect(receipt.status).toBe('committed'); expect(owner.readDocument().revision).toBe(1)
    return builder.finish()
   } }),
   saveProject: async () => { const filename = path.join(root, 'course.h5lesson'); await fs.writeFile(filename, createCourseProjectArchive({ project, assetFiles: resources.assetFiles, componentFiles: {} })); return filename },
  })
  const reopened = openCourseProjectArchive(new Uint8Array(await fs.readFile(filename)))
  expect(reopened.project.id).toBe(project.id); expect(reopened.project.revision).toBe(1); expect(JSON.stringify(reopened.project)).toContain('闭合回路形成电流')
  expect(creates).toBe(1); expect(commits).toBe(1); expect(checks).toBeGreaterThanOrEqual(4)
 })
 it('rejects a stale teaching-file ticket before creating or modifying the current project', async () => {
  let created = false
  await expect(executeLessonAssembly(input(), { createCourseProject: async () => { created = true }, owner: () => { throw new Error('must not open owner') }, validate: async () => ({ allowed: false, issues: ['教学稿已变化'] }), saveProject: async () => '', readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never })).rejects.toThrow('教学稿已变化')
  expect(created).toBe(false)
 })
})

it.each([{ error: new Error('rename interrupted'), expected: true }, { error: new LessonAssemblyError('new cancelled', false), expected: false }])('tracks lifecycle writes and explicit cancellation: $error.message', async ({ error, expected }) => {
 await expect(executeLessonAssembly(input(), {
  createCourseProject: async () => { throw error }, owner: () => { throw new Error('unused') },
  validate: async () => ({ allowed: true, issues: [] }), saveProject: async () => '', readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never,
  importModule: async () => ({ apiVersion: 2, default: async raw => (raw as { api: { createCourseProject(options: unknown): Promise<unknown> } }).api.createCourseProject({ surfaceType: 'slide', title: '电路' }) }),
 })).rejects.toMatchObject({ message: error.message, hasCommittedChanges: expected })
})

it('does not save another project switched during the final asynchronous validation', async () => {
 let project = createBlankCourseProject({ title: 'Built', includeDefaultController: false, controls: 'none' }), armed = false, saves = 0
 const owner: CoursewareBuilderV2Owner = {
  readDocument: () => project, readResources: () => ({ assetFiles: {}, componentPackages: {} }),
  readScope: () => courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }), readGeneration: () => 1,
  activate() {}, validateDestination: () => null, commit: () => true,
 }
 await expect(executeLessonAssembly(input(), {
  createCourseProject: async () => {}, owner: () => owner,
  validate: async () => { if (armed) project = createBlankCourseProject({ title: 'Other', includeDefaultController: false, controls: 'none' }); return { allowed: true, issues: [] } },
  saveProject: async () => { saves++; return 'other.h5lesson' }, readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never,
  importModule: async () => ({ apiVersion: 2, default: async raw => {
   const builder = await (raw as { api: { createCourseProject(options: unknown): Promise<CoursewareBuilderV2> } }).api.createCourseProject({ surfaceType: 'slide', title: 'Built' })
   const result = builder.finish(); armed = true; return result
  } }),
 })).rejects.toMatchObject({ hasCommittedChanges: true, message: '当前工程已切换，构建结果未保存到其他工程' })
 expect(saves).toBe(0)
})

it.each([false, true])('reuses only the exact unchanged empty project on module continuation (changed=%s)', async changed => {
 const project = createBlankCourseProject({ title: 'Existing empty project', includeDefaultController: false, controls: 'none' })
 let creations = 0, saves = 0
 const owner: CoursewareBuilderV2Owner = {
  readDocument: () => project, readResources: () => ({ assetFiles: {}, componentPackages: {} }),
  readScope: () => courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }), readGeneration: () => changed ? 3 : 2,
  activate() {}, validateDestination: () => null, commit: () => true,
 }
 const task = { ...input(), resumeTarget: { projectId: project.id, revision: project.revision, generation: 2 } }
 const result = executeLessonAssembly(task, {
  createCourseProject: async () => { creations++ }, owner: () => owner, validate: async () => ({ allowed: true, issues: [] }),
  saveProject: async () => { saves++; return 'existing.h5lesson' }, readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never,
  importModule: async () => ({ apiVersion: 2, default: async raw => (await (raw as { api: { createCourseProject(options: unknown): Promise<CoursewareBuilderV2> } }).api.createCourseProject({ surfaceType: 'slide', title: 'ignored on reuse' })).finish() }),
 })
 if (changed) { await expect(result).rejects.toMatchObject({ hasCommittedChanges: true, failure: { committedStepCount: 0 } }); expect(saves).toBe(0) }
 else { await expect(result).resolves.toBe('existing.h5lesson'); expect(saves).toBe(1) }
 expect(creations).toBe(0)
})

it('reports exact committed-step count and current target when a later module step fails', async () => {
 let project = createBlankCourseProject({ title: 'Partial', includeDefaultController: false, controls: 'none' })
 let resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }
 const owner: CoursewareBuilderV2Owner = {
  readDocument: () => project, readResources: () => resources, readScope: () => courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }), readGeneration: () => 2,
  activate() {}, validateDestination: () => null,
  commit(step) { const result = applyEditorTransactionStep({ document: project, resources }, step, 'forward'); project = result.document; resources = result.resources; return true },
 }
 await expect(executeLessonAssembly(input(), {
  createCourseProject: async () => {}, owner: () => owner, validate: async () => ({ allowed: true, issues: [] }), saveProject: async () => '', readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never,
  importModule: async () => ({ apiVersion: 2, default: async raw => {
   const builder = await (raw as { api: { createCourseProject(options: unknown): Promise<CoursewareBuilderV2> } }).api.createCourseProject({ surfaceType: 'slide', title: 'Partial' })
   await builder.execute('native.content', { operation: 'insert', template: { nativeType: 'text', text: '已提交教学内容' } }, { kind: 'create', scope: builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } }) })
   throw new Error('Later step rejected')
  } }),
 })).rejects.toMatchObject({ hasCommittedChanges: true, failure: { committedStepCount: 1, target: { projectId: project.id, revision: 1, generation: 2 } } })
 expect(JSON.stringify(project)).toContain('已提交教学内容')
 expect(() => observeEmptyLessonBuildTarget(owner)).toThrow('已有教学内容或资源')
})

it('observes the canonical blank project including its default teacher controller without writing', () => {
 const project = createBlankCourseProject()
 const owner: CoursewareBuilderV2Owner = { readDocument: () => project, readResources: () => ({ assetFiles: {}, componentPackages: {} }), readScope: () => courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }), readGeneration: () => 7, activate() { throw new Error('Read must not activate') }, validateDestination: () => null, commit() { throw new Error('Read must not commit') } }
 expect(observeEmptyLessonBuildTarget(owner)).toEqual({ projectId: project.id, revision: project.revision, generation: 7 })
 expect(() => observeEmptyLessonBuildTarget({ ...owner, readResources: () => ({ assetFiles: { image: new Uint8Array([1]) }, componentPackages: {} }) })).toThrow('已有教学内容或资源')
})
it.each(['revision', 'generation'])('rejects changes to %s during asynchronous module import before reusing the owner', async changed => {
 const project = createBlankCourseProject({ title: 'Existing', includeDefaultController: false, controls: 'none' }); let generation = 2, creations = 0, commits = 0, saves = 0
 const owner: CoursewareBuilderV2Owner = { readDocument: () => project, readResources: () => ({ assetFiles: {}, componentPackages: {} }), readScope: () => courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }), readGeneration: () => generation, activate() {}, validateDestination: () => null, commit() { commits++; return true } }
 await expect(executeLessonAssembly({ ...input(), resumeTarget: { projectId: project.id, revision: project.revision, generation } }, {
  owner: () => owner, createCourseProject: async () => { creations++ }, validate: async () => ({ allowed: true, issues: [] }), saveProject: async () => { saves++; return '' }, readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never,
  importModule: async () => { await Promise.resolve(); if (changed === 'revision') project.revision++; else generation++; return { apiVersion: 2, default: async raw => (await (raw as { api: { createCourseProject(options: unknown): Promise<CoursewareBuilderV2> } }).api.createCourseProject({ surfaceType: 'slide', title: 'Existing' })).finish() } },
 })).rejects.toThrow('准备构建期间已变化')
 expect({ creations, commits, saves }).toEqual({ creations: 0, commits: 0, saves: 0 })
 expect(changed === 'revision' ? project.revision : generation).toBe(changed === 'revision' ? 1 : 3)
})

it('tracks canonical add-surface selection changes before the following content commit', async () => {
 let project = createBlankCourseProject({ title: 'Navigation', includeDefaultController: false, controls: 'none' }), generation = 1
 let resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }, scope = courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId })
 const owner: CoursewareBuilderV2Owner = {
  readDocument: () => project, readResources: () => resources, readScope: () => scope, readGeneration: () => generation,
  activate(next) { scope = courseAuthoringScopeFromLocation({ project, ...next }); generation++ }, validateDestination: () => null,
  commit(step) { const next = applyEditorTransactionStep({ document: project, resources }, step, 'forward'); project = next.document; resources = next.resources; const hint = step.selectionHint as { locationId?: string } | undefined; if (hint?.locationId && hint.locationId !== scope.locationId) { scope = courseAuthoringScopeFromLocation({ project, locationId: hint.locationId }); generation++ } return true },
 }
 await executeLessonAssembly(input(), {
  createCourseProject: async () => {}, owner: () => owner, validate: async () => ({ allowed: true, issues: [] }), saveProject: async () => 'navigation.h5lesson', readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never,
  importModule: async () => ({ apiVersion: 2, default: async raw => {
   const builder = await (raw as { api: { createCourseProject(options: unknown): Promise<CoursewareBuilderV2> } }).api.createCourseProject({ surfaceType: 'slide', title: 'Navigation' })
   builder.activate({ locationId: project.startLocationId, owner: 'global', stateId: null })
   expect((await builder.execute('course.navigation', { operation: 'add-surface', surfaceType: 'slide', title: 'Second' }, { kind: 'create', scope: builder.createScope({ parent: { kind: 'course-locations' }, insertion: { kind: 'append' } }) })).status).toBe('committed')
   expect((await builder.execute('native.content', { operation: 'insert', template: { nativeType: 'text', text: '新页教学内容' } }, { kind: 'create', scope: builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } }) })).status).toBe('committed')
   return builder.finish()
  } }),
 })
 expect(project.revision).toBe(2); expect(JSON.stringify(project)).toContain('新页教学内容')
})

it('preserves real rejected tool diagnostics without committing or saving', async () => {
 const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
 let commits = 0, saves = 0
 const owner: CoursewareBuilderV2Owner = { readDocument: () => project, readResources: () => ({ assetFiles: {}, componentPackages: {} }), readScope: () => courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }), readGeneration: () => 1, activate() {}, validateDestination: () => null, commit() { commits++; return true } }
 let actual: unknown
 const attempt = executeLessonAssembly(input(), { owner: () => owner, createCourseProject: async () => {}, validate: async () => ({ allowed: true, issues: [] }), saveProject: async () => { saves++; return '' }, readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never,
  importModule: async () => ({ apiVersion: 2, default: async raw => {
   const builder = await (raw as { api: { createCourseProject(options: unknown): Promise<CoursewareBuilderV2> } }).api.createCourseProject({ surfaceType: 'slide', title: 'Actual failure' })
   const receipt = await builder.execute('native.content', { operation: 'invalid' }, { kind: 'create', scope: builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } }) })
   actual = receipt.diagnostics
   throw new Error('构建工具拒绝当前输入')
  } }),
 })
 await expect(attempt).rejects.toMatchObject({ failure: { committedStepCount: 0, tool: 'native.content', message: '构建工具拒绝当前输入' } })
 await attempt.catch(error => expect(error.failure.diagnostics).toEqual(actual))
 expect({ commits, saves }).toEqual({ commits: 0, saves: 0 })
})

it('rejects a changed pre-creation repair target after asynchronous import', async () => {
 const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' }); let creations = 0
 const owner: CoursewareBuilderV2Owner = { readDocument: () => project, readResources: () => ({ assetFiles: {}, componentPackages: {} }), readScope: () => courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId }), readGeneration: () => 1, activate() {}, validateDestination: () => null, commit() { throw new Error('Must not commit') } }
 await expect(executeLessonAssembly({ ...input(), expectedInitialTarget: observeEmptyLessonBuildTarget(owner) }, { owner: () => owner, createCourseProject: async () => { creations++ }, validate: async () => ({ allowed: true, issues: [] }), saveProject: async () => { throw new Error('Must not save') }, readAsset: async () => new Uint8Array(), componentCatalog: async () => ({}) as never,
  importModule: async () => { await Promise.resolve(); project.revision++; return { apiVersion: 2, default: async raw => (raw as { api: { createCourseProject(options: unknown): Promise<CoursewareBuilderV2> } }).api.createCourseProject({ surfaceType: 'slide', title: 'Late' }) } },
 })).rejects.toThrow('修复后已变化')
 expect(creations).toBe(0)
})
