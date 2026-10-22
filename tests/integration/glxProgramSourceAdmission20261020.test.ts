// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10, createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { readComponentProjectFileInput, prepareComponentProjectFileSource } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'
import { componentSurface } from '../../src/shared/contracts/component-platform/project'
import type { CourseProjectV10, JsonObject } from '../../src/shared/contracts/component-platform'
import type { DocumentOperation } from '../../src/shared/workbench/document'

function sequence(prefix: string) { let id = 0; return () => `${prefix}-${++id}` }

async function authoring(project: CourseProjectV10) {
  const driver = new CourseV10Driver()
  let saved: Uint8Array | undefined
  const session = await DocumentSession.create({ documentId: 'program-admission', epoch: 'program-admission-epoch',
    binding: { kind: 'untitled', suggestedName: 'program.glx' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver, {
    async append() {},
    async save(input) {
      if (input.binding.kind !== 'file') throw new Error('Expected file binding')
      saved = Uint8Array.from(input.bytes)
      return { ...input.binding, version: `revision-${input.revision}` }
    },
  })
  const current = () => {
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('Expected work project')
    return model
  }
  const operationId = sequence('program-operation')
  const execute = (mutation: DocumentOperation['mutation']) => {
    const snapshot = session.read()
    return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: operationId(), actor: 'agent', mutation })
  }
  const service = new ContentApplyService({ session: { project: () => current().project, resources: () => current().resources,
    dispatch: command => execute({ type: 'command', command }) },
    compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()), createId: sequence('admitted'),
    async measure() { throw new Error('Source content and container commands must not invent a design canvas') },
  })
  return { session, service, current, execute,
    async coldOpen() {
      await session.save({ kind: 'file', path: 'program.glx', version: null, bindingVersion: 1 })
      if (!saved) throw new Error('Expected serialized save')
      return driver.load(saved)
    } }
}

it('admits the authorized current HTML closure into an unframed Source root and preserves it through Undo and a cold archive load', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-program-admission-'))
  try {
    const html = '<!doctype html><html><head><link rel="stylesheet" href="app.css"></head><body><button id="increment">Current source</button><audio src="tone.mp3"></audio><script type="module" src="app.js"></script></body></html>'
    await fs.writeFile(path.join(root, 'app.html'), '<!doctype html><html><body>Old disk version</body></html>')
    await fs.writeFile(path.join(root, 'app.css'), '#increment{color:rgb(24,48,72)}')
    await fs.writeFile(path.join(root, 'app.js'), 'import {count} from "./state.js";document.querySelector("#increment").onclick=()=>count.next();')
    await fs.writeFile(path.join(root, 'state.js'), 'export const count={value:0,next(){return ++this.value}};')
    const tone = new Uint8Array([73, 68, 51, 4, 0, 0])
    await fs.writeFile(path.join(root, 'tone.mp3'), tone)
    const admitted = await readComponentProjectFileInput({ from: 'app.html', fileAccess: { permission: 'workspace', workspaceRoot: root },
      currentSource: async filename => filename === path.join(root, 'app.html') ? html : undefined })
    expect(admitted.text).toBe(html)
    expect(new Set(admitted.siblingFiles?.keys())).toEqual(new Set(['app.css', 'app.js', 'state.js', 'tone.mp3']))
    expect(admitted.diagnostics).toEqual([])
    const project = createBlankProgramProject('Current program', sequence('source-root'))
    const rootId = project.entry!.rootInstanceId
    const source = await prepareComponentProjectFileSource(admitted, { path: 'entry.html', kind: 'html',
      target: { kind: 'instance', instanceId: rootId } }, 'content')
    expect(source).toMatchObject({ kind: 'html', html, original: { filename: 'app.html' } })
    const harness = await authoring(project)
    const result = await harness.service.apply({ intent: 'content', target: { kind: 'instance', instanceId: rootId }, source })
    expect(result).toMatchObject({ commit: 'committed', usability: 'unverified', diagnostics: [] })
    const model = harness.current(), data = model.project.instances[rootId]!.data as JsonObject
    expect(model.project.rootIds).toEqual([rootId])
    expect(model.project.instances[rootId]).not.toHaveProperty('frame')
    expect(model.project.instances[rootId]).not.toHaveProperty('container')
    expect(model.project).not.toHaveProperty('surfaces')
    expect(data.html).toContain('Current source')
    expect(data.html).toContain('color:rgb(24,48,72)')
    expect(data.modules).toMatchObject({ 'app.js': expect.stringContaining('count.next()'), 'state.js': expect.stringContaining('value:0') })
    expect(Object.values(model.resources.assets).some(bytes => Array.from(bytes).join(',') === Array.from(tone).join(','))).toBe(true)
    expect(harness.session.read().undoDepth).toBe(1)
    expect(await harness.execute({ type: 'undo' })).toMatchObject({ status: 'applied' })
    expect((harness.current().project.instances[rootId]!.data as JsonObject).html).toBe('')
    expect(harness.current().resources.assets).toEqual({})
    expect(await harness.execute({ type: 'redo' })).toMatchObject({ status: 'applied' })
    const cold = await harness.coldOpen()
    expect(cold).toMatchObject({ kind: 'course-v10', project: { rootIds: [rootId], entry: { rootInstanceId: rootId } } })
    if (cold.kind !== 'course-v10') throw new Error('Expected cold work project')
    expect(cold.project.instances[rootId]!.data).toEqual(data)
    expect(cold.resources.assets).toEqual(model.resources.assets)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('adds a mixed container batch through canonical roots in one Session history entry', async () => {
  const project = createBlankCourseProjectV10('Existing work', sequence('existing'))
  const first = project.rootIds[0]!
  const harness = await authoring(project)
  const result = await harness.service.apply({ intent: 'surface.add', pages: [
    { kind: 'flow', title: 'Reading', beforeSurfaceId: first }, { kind: 'spatial', title: 'World' },
  ] })
  expect(result).toMatchObject({ commit: 'committed', usability: 'usable', diagnostics: [] })
  const next = harness.current().project
  expect(next.rootIds).toEqual([result.insertedIds[0], first, result.insertedIds[1]])
  expect(next.instances[result.insertedIds[0]!]!.container?.kind).toBe('flow')
  expect(next.instances[result.insertedIds[1]!]!.container?.kind).toBe('spatial')
  expect(componentSurface(next, first)?.kind).toBe('slide')
  expect(harness.session.read().undoDepth).toBe(1)
  expect(await harness.execute({ type: 'undo' })).toMatchObject({ status: 'applied' })
  expect(harness.current().project.rootIds).toEqual([first])
})

it('adds and orders root containers around a program root using the existing page directory indices', async () => {
  const project = createBlankProgramProject('Program with containers', sequence('program'))
  const programId = project.rootIds[0]!, harness = await authoring(project)
  const added = await harness.service.apply({ intent: 'surface.add', pages: [{ kind: 'slide', title: 'A' }, { kind: 'flow', title: 'B' }] })
  expect(added, JSON.stringify(added)).toMatchObject({ commit: 'committed', usability: 'usable' })
  const [a, b] = added.insertedIds
  expect(harness.current().project.rootIds).toEqual([programId, a, b])
  const before = await harness.service.apply({ intent: 'surface.add', kind: 'spatial', title: 'Before A', beforeSurfaceId: a })
  expect(before).toMatchObject({ commit: 'committed', usability: 'usable' })
  expect(harness.current().project.rootIds).toEqual([programId, before.insertedIds[0], a, b])
  expect(await harness.service.apply({ intent: 'surface.move', surfaceId: b!, beforeSurfaceId: a })).toMatchObject({ commit: 'committed' })
  expect(harness.current().project.rootIds).toEqual([programId, before.insertedIds[0], b, a])
  expect(harness.current().project.entry).toEqual({ rootInstanceId: programId })
})
