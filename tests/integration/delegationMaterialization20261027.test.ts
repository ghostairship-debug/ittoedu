// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import type { NativeTaskRunner } from '../../src/main/workbench/delegation/NativeTaskRunner'
import type { DelegationExecutionResult } from '../../src/main/workbench/delegation/CodexDelegationRunner'
import type { PreparedTaskSource } from '../../src/shared/workbench/toolPorts'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { artifactGroupInput } from '../../src/core/tools/artifactGroup'

const roots: string[] = [], services: DelegationJobService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.cancelRun('parent')))
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })))
})
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const input = (jobId: string, outputs = ['candidate.md']) => ({ runId: 'parent', jobId, taskId: jobId, permission: 'workspace' as const,
  intent: { goal: 'Prepare one reviewable candidate', outputs } })
const complete = (taskId: string): DelegationExecutionResult => ({ taskId, status: 'verified', artifacts: [],
  reason: 'fixture completed', candidateComplete: true, externalChangesPossible: false })
const source = (name: string, text: string): PreparedTaskSource => ({ source: name, name, mimeType: 'text/plain', bytes: encode(text), version: 'frozen-v1' })
async function fixture(run: NativeTaskRunner['run']) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'guoling-delegation-materialization-'))
  roots.push(root)
  const copyRootBase = path.join(root, 'copies')
  const service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase,
    nativeRunner: { available: () => true, run, message: async () => {} } })
  services.push(service)
  return { root, directory: path.join(root, 'jobs'), copyRootBase, service }
}

it('materializes a cold formal GLX projection with aggregate directories, full builtin sources and occupied index names', async () => {
  // Reload the real projection/source loader graph: this must not rely on an
  // earlier project.read having prepared a builtin author implementation.
  vi.resetModules()
  const { freezeTaskInputs } = await import('../../src/main/workbench/delegation/freezeTaskInputs')
  const { hasBuiltinComponentSource } = await import('../../src/core/components/source/builtinSources')
  const { createBlankCourseProjectV10 } = await import('../../src/core/course/createCourseProjectV10')
  const { createTextComponentData } = await import('../../src/components/text/data')
  const { testContainerInstance } = await import('../helpers/glxWorkFixture')
  const project = createBlankCourseProjectV10('Current unsaved GLX')
  project.definitions.text = { id: 'text', title: 'Text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances.body = { id: 'body', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Current page content'))) }
  testContainerInstance(project, 0).childIds = ['body']
  project.instances.rootText = { id: 'rootText', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Independent work root'))) }
  project.rootIds.push('rootText')
  project.assets.first = { id: 'first', path: 'pages/index.json', mimeType: 'image/svg+xml' }
  project.assets.second = { id: 'second', path: 'pages/index-2.json/retained.svg', mimeType: 'image/svg+xml' }
  const resources = { assets: { first: encode('<svg id="first"/>'), second: encode('<svg id="second"/>') }, components: {} }
  expect(hasBuiltinComponentSource('guoling.text')).toBe(false)
  let captured: readonly PreparedTaskSource[] = []
  const run = vi.fn<NativeTaskRunner['run']>(async (request, options = {}) => {
    captured = request.sources
    const pages = captured.find(file => file.source.endsWith('#project:pages'))!
    const roots = captured.find(file => file.source.endsWith('#project:roots'))!
    expect(pages.name).toBe('course.glx.current/pages/index-3.json')
    expect(roots.name).toBe('course.glx.current/roots/index.json')
    expect((await fs.stat(path.join(request.copyRoot, 'course.glx.current/pages'))).isDirectory()).toBe(true)
    expect((await fs.stat(path.join(request.copyRoot, 'course.glx.current/roots'))).isDirectory()).toBe(true)
    const implementation = captured.find(file => file.source.includes('/01-Text.dependencies/implementation.view.js'))
    expect(implementation, 'cold builtin implementation must enter the complete copy').toBeDefined()
    expect(implementation!.bytes.byteLength).toBeGreaterThan(100)
    expect(captured.some(file => file.source.endsWith('/01-Text.view.js'))).toBe(true)
    for (const file of captured) {
      options.signal?.throwIfAborted()
      const actual = await fs.readFile(path.join(request.copyRoot, file.name))
      expect(actual.equals(file.bytes), file.name).toBe(true)
    }
    await fs.writeFile(path.join(request.copyRoot, 'candidate.md'), 'Complete current GLX sources were available to the child.')
    return complete(request.taskId)
  })
  const { root, service } = await fixture(run)
  const snapshot: DocumentSnapshot = { documentId: 'current-glx', epoch: 'epoch', revision: 7, dirty: true,
    binding: { kind: 'file', path: path.join(root, 'course.glx'), version: 'disk-v1', bindingVersion: 1 },
    model: { kind: 'course-v10', project, resources }, saving: false, recoverable: true, undoDepth: 1, redoDepth: 0 }
  const before = structuredClone(snapshot)
  const disk = vi.fn(async () => { throw new Error('Current GLX capture must not require disk bytes') })
  await service.startNative({ ...input('cold-glx'), prepareSources: signal => freezeTaskInputs(['course.glx'], {
    assertActive() {}, isMaterial: () => false, material: vi.fn(), authorize: async () => path.join(root, 'course.glx'),
    opened: async () => snapshot, disk,
  }, { signal }) })
  const ready = await service.wait('parent', 'cold-glx', 10_000)
  expect(ready, ready.reason).toMatchObject({ status: 'ready', terminal: true, candidateComplete: true })
  expect(run).toHaveBeenCalledOnce()
  expect(hasBuiltinComponentSource('guoling.text')).toBe(true)
  expect(disk).not.toHaveBeenCalled()
  expect(snapshot).toEqual(before)
  expect(captured.find(file => file.source.endsWith('#project:pages/index.json'))?.bytes).toEqual(resources.assets.first)
  expect(decode((await service.readArtifact('parent', 'cold-glx', 'candidate.md')).bytes)).toContain('Complete current GLX sources')
})

it.each([false, true])('diagnoses a file/directory source collision before any partial task copy (reverse=%s)', async reverse => {
  const run = vi.fn<NativeTaskRunner['run']>(async request => complete(request.taskId))
  const { service, copyRootBase } = await fixture(run)
  const sources = [source('course.glx.current/pages', '{"pages":[]}'), source('course.glx.current/pages/page.json', '{}')]
  if (reverse) sources.reverse()
  await service.startNative({ ...input('invalid-input-tree'), prepareSources: async () => sources })
  const failed = await service.wait('parent', 'invalid-input-tree', 5000)
  expect(failed).toMatchObject({ status: 'failed', terminal: true, artifacts: [] })
  expect(failed.reason).toContain('course.glx.current/pages')
  expect(failed.reason).toContain('course.glx.current/pages/page.json')
  expect(run).not.toHaveBeenCalled()
  expect(await fs.readdir(copyRootBase).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })).toEqual([])
})

it('does not seal a frozen input as a newly declared native output when the child produces nothing', async () => {
  const original = source('answer.md', '# Previous input')
  const run = vi.fn<NativeTaskRunner['run']>(async request => {
    expect(request.intent.outputs).toEqual(['answer.md'])
    expect(request.sources[0]?.source).toBe('answer.md')
    expect(request.sources[0]?.name).not.toBe('answer.md')
    expect(decode(await fs.readFile(path.join(request.copyRoot, request.sources[0]!.name)))).toBe('# Previous input')
    await expect(fs.stat(path.join(request.copyRoot, 'answer.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    return complete(request.taskId)
  })
  const { service } = await fixture(run)
  await service.startNative({ ...input('untouched-source', ['answer.md']), sources: [original] })
  expect(await service.wait('parent', 'untouched-source', 5000)).toMatchObject({ status: 'failed', terminal: true, artifacts: [] })
  await expect(service.readArtifact('parent', 'untouched-source', 'answer.md')).rejects.toMatchObject({ code: 'artifact-not-ready' })
  expect(run).toHaveBeenCalledOnce()
  expect(original.name).toBe('answer.md')
})

it('accepts explicit unchanged delivery and seals its relative dependencies through the existing artifact group', async () => {
  const html = '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body>Keep the approved content</body></html>'
  const css = 'body { color: #123456; }'
  const sources = [source('entry.html', html), source('style.css', css)]
  const run = vi.fn<NativeTaskRunner['run']>(async request => {
    expect(request.intent.sharedBrief).toBe('Keep the approved bytes unchanged.')
    const entry = request.sources.find(file => file.source === 'entry.html')!
    const style = request.sources.find(file => file.source === 'style.css')!
    expect(path.posix.dirname(entry.name)).toBe(path.posix.dirname(style.name))
    expect(await fs.readFile(path.resolve(request.copyRoot, path.posix.dirname(entry.name), 'style.css'), 'utf8')).toBe(css)
    await fs.copyFile(path.join(request.copyRoot, entry.name), path.join(request.copyRoot, 'entry.html'))
    await fs.copyFile(path.join(request.copyRoot, style.name), path.join(request.copyRoot, 'style.css'))
    return complete(request.taskId)
  })
  const { service } = await fixture(run), request = input('unchanged-delivery', ['entry.html'])
  await service.startNative({ ...request, intent: { ...request.intent, sharedBrief: 'Keep the approved bytes unchanged.' }, sources })
  const ready = await service.wait('parent', request.jobId, 5000)
  expect(ready, ready.reason).toMatchObject({ status: 'ready', candidateComplete: true })
  expect(ready.artifacts.map(artifact => artifact.name).sort()).toEqual(['entry.html', 'style.css'])
  const sealed = await Promise.all(ready.artifacts.map(async artifact => ({ name: artifact.name,
    bytes: (await service.readArtifact('parent', request.jobId, artifact.name)).bytes })))
  const adopted = artifactGroupInput('entry.html', sealed)
  expect(adopted.text).toBe(html)
  expect(adopted.siblingFiles?.get('style.css')).toEqual(encode(css))
  expect(sources.map(file => file.name)).toEqual(['entry.html', 'style.css'])
})

it('retains ordinary source paths and chooses a free namespace when both inputs and outputs use prefix names', async () => {
  const run = vi.fn<NativeTaskRunner['run']>(async request => {
    if (request.jobId === 'ordinary') expect(request.sources.map(file => file.name)).toEqual(['notes.md'])
    else {
      expect(request.sources.map(file => file.name)).toEqual(['inputs-3/answer.md', 'inputs-3/inputs/notes.md'])
      expect(request.sources.map(file => file.source)).toEqual(['answer.md', 'inputs/notes.md'])
      for (const file of request.sources) expect(decode(await fs.readFile(path.join(request.copyRoot, file.name)))).toBe('frozen input')
    }
    for (const name of request.intent.outputs) {
      await fs.mkdir(path.dirname(path.join(request.copyRoot, name)), { recursive: true })
      await fs.writeFile(path.join(request.copyRoot, name), 'new candidate')
    }
    return complete(request.taskId)
  })
  const { service } = await fixture(run)
  await service.startNative({ ...input('ordinary'), sources: [source('notes.md', 'frozen input')] })
  expect(await service.wait('parent', 'ordinary', 5000)).toMatchObject({ status: 'ready' })
  await service.startNative({ ...input('occupied-prefix', ['answer.md', 'inputs/report.md', 'inputs-2/report.md']),
    sources: [source('answer.md', 'frozen input'), source('inputs/notes.md', 'frozen input')] })
  expect(await service.wait('parent', 'occupied-prefix', 5000)).toMatchObject({ status: 'ready', artifacts: expect.any(Array) })
  expect(run).toHaveBeenCalledTimes(2)
})

it('reuses the original physical source mapping and child identity when resuming after service reconstruction', async () => {
  let originalInputPath = '', originalCopy = ''
  const run = vi.fn<NativeTaskRunner['run']>(async request => {
    if (request.jobId === 'original') {
      originalInputPath = request.sources[0]!.name
      originalCopy = request.copyRoot
      expect(originalInputPath).not.toBe('answer.md')
      await fs.copyFile(path.join(request.copyRoot, originalInputPath), path.join(request.copyRoot, 'answer.md'))
      return { ...complete(request.taskId), childRunId: 'original-child' }
    }
    expect(request.resumeRunId).toBe('original-child')
    expect(request.copyRoot).not.toBe(originalCopy)
    expect(request.sources).toEqual([])
    expect(await fs.readFile(path.join(request.copyRoot, originalInputPath), 'utf8')).toBe('approved unchanged content')
    expect(await fs.readFile(path.join(request.copyRoot, 'answer.md'), 'utf8')).toBe('approved unchanged content')
    return { ...complete(request.taskId), childRunId: 'resumed-child' }
  })
  const { service, directory, copyRootBase } = await fixture(run)
  const original = { ...input('original', ['answer.md']), sources: [source('answer.md', 'approved unchanged content')] }
  await service.startNative(original)
  expect(await service.wait('parent', 'original', 5000)).toMatchObject({ status: 'ready', childRunId: 'original-child' })
  const restored = new DelegationJobService({ directory, copyRootBase,
    nativeRunner: { available: () => true, run, message: async () => {} } })
  services.push(restored)
  const reprepare = vi.fn(async () => { throw new Error('A completed receipt cannot refreeze or remap inputs') })
  const { sources: _sources, ...originalIdentity } = original
  expect(await restored.startNative({ ...originalIdentity, prepareSources: reprepare })).toMatchObject({ status: 'ready' })
  expect(reprepare).not.toHaveBeenCalled()
  await restored.resumeNative({ ...input('resumed', ['answer.md']), sourceRunId: 'parent', sourceJobId: 'original' })
  expect(await restored.wait('parent', 'resumed', 5000)).toMatchObject({ status: 'ready',
    resumedFrom: { runId: 'parent', jobId: 'original', childRunId: 'original-child' } })
  expect(decode((await restored.readArtifact('parent', 'resumed', 'answer.md')).bytes)).toBe('approved unchanged content')
  expect(run).toHaveBeenCalledTimes(2)
})
