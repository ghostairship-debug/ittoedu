// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import { prepareHtmlCourseCandidate } from '../../src/main/workbench/htmlImport/prepareHtmlCourseCandidate'
import { createHtmlDocumentRuntimeSource, unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import { visitCourseLayerItems } from '../../src/shared/courseProjectHealth/internal'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { BuildAdmissionPort, BuildBudget, BuildJobSnapshot } from '../../src/shared/workbench/build'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture(dynamic = false, admission?: BuildAdmissionPort, budget?: Partial<BuildBudget>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-build-')); roots.push(root)
  const project = createBlankCourseProject(dynamic ? {} : { includeDefaultController: false, controls: 'none' })
  const pkg = createDefaultTeacherControllerPackage()
  const baseline: Extract<DocumentModel, { kind: 'course-v9' }> = { kind: 'course-v9', project, resources: { assets: {}, components: dynamic ? { [`${pkg.manifest.id}@${pkg.manifest.version}`]: pkg.files } : {} } }
  const run = vi.fn<BuildAdmissionPort['run']>(async () => { throw new Error('Unexpected admission') })
  const service = new ControlledBuildService({ directory: path.join(root, 'scratch'), admission: admission ?? { run } })
  const target = { documentId: 'doc', projectId: project.id, epoch: 'epoch', baseRevision: project.revision, modelDigest: documentDigest(baseline) }
  const job = await service.create({ runId: 'run', target, readSet: [{ documentId: 'doc', epoch: 'epoch', revision: project.revision, digest: target.modelDigest }], baseline, allowedOrigins: [], ...(budget ? { budget } : {}) })
  const exec = (call: Record<string, unknown>) => service.execute('run', { jobId: job.jobId, ...call })
  return { root, service, job, project, baseline, exec, run, files: path.join(root, 'scratch', job.jobId, 'files') }
}
describe('controlled scratch builds', () => {
  it('treats a different button observation as progress on unchanged source', async () => {
    const f = await fixture(false, undefined, { maxSameSourceChecks: 1 })
    expect(await f.exec({ type: 'check', buttonCheck: { version: 1, instanceId: 'item', label: '第一个按钮' } }))
      .toMatchObject({ status: 'failed' })
    expect(await f.exec({ type: 'check', buttonCheck: { version: 1, instanceId: 'item', label: '第二个按钮' } }))
      .toMatchObject({ status: 'failed' })
    const logs = await f.exec({ type: 'logs' }) as { entries: Array<{ message: string }> }
    expect(logs.entries.at(-1)?.message).toContain('没有受影响动态目标')
  })
  it('reads and writes real scratch files while rejecting traversal/symlinks and never executing candidate subprocess code', async () => {
    const f = await fixture()
    const sentinel = path.join(f.root, 'sentinel.txt'); await fs.writeFile(sentinel, 'original')
    const source = `globalThis.process.getBuiltinModule('node:child_process').execFileSync('cmd.exe',['/c','echo broken>${sentinel.replaceAll('\\', '/')}'])`
    await f.exec({ type: 'write', path: 'source/main.js', content: source })
    expect(await f.exec({ type: 'read', path: 'source/main.js' })).toMatchObject({ content: source })
    expect(await f.exec({ type: 'syntax', path: 'source/main.js', kind: 'runtime' })).toMatchObject({ ok: true, stage: 'syntax-checked' })
    expect(await fs.readFile(sentinel, 'utf8')).toBe('original')
    for (const name of ['../sentinel.txt', sentinel, 'x/../../sentinel.txt', 'CON', 'x.']) await expect(f.exec({ type: 'write', path: name, content: 'overwrite' })).rejects.toThrow()
    await expect(f.exec({ type: 'shell', command: 'cmd.exe' })).rejects.toThrow()
    const outside = path.join(f.root, 'outside'); await fs.mkdir(outside)
    await fs.symlink(outside, path.join(f.files, 'escape'), 'junction')
    await expect(f.exec({ type: 'write', path: 'escape/escaped.txt', content: 'bad' })).rejects.toThrow()
    await expect(fs.access(path.join(outside, 'escaped.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.run).not.toHaveBeenCalled()
  })
  it('uses real V9 closure/origin validation, preserves frozen artifacts and invalidates them on further source writes', async () => {
    const f = await fixture()
    const changed = structuredClone(f.project); changed.title = 'Prepared only'
    changed.network = { connectOrigins: ['https://unapproved.example'] }
    await f.exec({ type: 'write', path: 'project.json', content: JSON.stringify(changed) })
    expect(await f.exec({ type: 'check' })).toMatchObject({ status: 'failed' })
    expect(await f.exec({ type: 'logs' })).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('精确来源') })]) })
    delete changed.network
    await f.exec({ type: 'write', path: 'project.json', content: JSON.stringify(changed) })
    const ready = await f.exec({ type: 'check' }) as BuildJobSnapshot
    expect(ready.status).toBe('ready')
    const artifact = await f.service.artifact('run', f.job.jobId, ready.artifactId!)
    expect(artifact.command).toMatchObject({ type: 'course.replace', project: { title: 'Prepared only', revision: f.project.revision } })
    expect(artifact.target).toEqual(f.job.target)
    expect(f.baseline.project.title).toBe('未命名 H5 演示')
    const recovered = new ControlledBuildService({ directory: path.join(f.root, 'scratch'), admission: { run: f.run } })
    expect(await recovered.artifact('run', f.job.jobId, ready.artifactId!)).toEqual(artifact)
    await f.exec({ type: 'write', path: 'notes.txt', content: 'new source' })
    await expect(f.service.artifact('run', f.job.jobId, ready.artifactId!)).rejects.toMatchObject({ code: 'artifact-not-ready' })
    expect(f.run).not.toHaveBeenCalled()
    const dynamic = await fixture(true)
    const entry = Object.values(dynamic.project.componentPackages)[0]
    await fs.unlink(path.join(dynamic.files, path.posix.dirname(entry.manifestPath), 'thumbnail.svg'))
    expect(await dynamic.exec({ type: 'check' })).toMatchObject({ status: 'failed' })
    expect(dynamic.run).not.toHaveBeenCalled()
  })
  it('returns the actual component digest so a model can repair project metadata after a source edit', async () => {
    const f = await fixture(true)
    const [key, entry] = Object.entries(f.project.componentPackages)[0]!
    const original = await fs.readFile(path.join(f.files, entry.runtimePath), 'utf8')
    await f.exec({ type: 'write', path: entry.runtimePath, content: `${original}\n` })
    expect(await f.exec({ type: 'syntax', path: entry.runtimePath, kind: 'component' })).toMatchObject({ ok: true })
    expect(await f.exec({ type: 'check' })).toMatchObject({ status: 'failed' })
    const files = { ...f.baseline.resources.components[`${entry.packageId}@${entry.version}`], [path.posix.basename(entry.runtimePath)]: new TextEncoder().encode(`${original}\n`) }
    const actual = componentContentSha256(files)
    const log = await f.exec({ type: 'logs' }) as { entries: Array<{ message: string }> }
    expect(log.entries.at(-1)?.message).toContain(actual)
    expect(log.entries.at(-1)?.message).toContain('project.json')
    const changed = structuredClone(f.project)
    changed.componentPackages[key]!.contentSha256 = actual
    await f.exec({ type: 'write', path: 'project.json', content: JSON.stringify(changed) })
    await f.exec({ type: 'check' })
    expect(f.run).toHaveBeenCalledOnce()
  })
  it('keeps a scratch candidate usable after long model waits while bounding each check', async () => {
    const realNow = Date.now
    let now = realNow()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const f = await fixture()
      const changed = structuredClone(f.project); changed.title = 'Long task candidate'
      now += 11 * 60_000
      await f.exec({ type: 'write', path: 'project.json', content: JSON.stringify(changed) })
      const ready = await f.exec({ type: 'check' }) as BuildJobSnapshot
      expect(ready).toMatchObject({ status: 'ready', deadline: now + 10 * 60_000 })
      now += 11 * 60_000
      expect((await f.service.artifact('run', f.job.jobId, ready.artifactId!)).command).toMatchObject({
        type: 'course.replace', project: { title: 'Long task candidate' },
      })
    } finally { clock.mockRestore() }
  })
  it('times out an admission attempt without publishing a late artifact', async () => {
    let entered!: () => void, release!: (value: any) => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let signal: AbortSignal | undefined
    const f = await fixture(true, { async run(_payload, currentSignal) {
      signal = currentSignal; entered()
      return new Promise(resolve => { release = resolve })
    } }, { maxDurationMs: 100 })
    const changed = structuredClone(f.project); changed.globalLayerItems[0].item.opacity = 0.9
    await f.exec({ type: 'write', path: 'project.json', content: JSON.stringify(changed) })
    vi.useFakeTimers()
    try {
      const check = f.exec({ type: 'check' })
      await started
      await vi.advanceTimersByTimeAsync(101)
      expect(await check).toMatchObject({ status: 'exhausted' })
      expect(signal?.aborted).toBe(true)
      release({ ok: true, message: 'late success must not publish' })
      await expect(f.service.artifact('run', f.job.jobId, 'late')).rejects.toMatchObject({ code: 'build-budget' })
      expect((await f.exec({ type: 'list' }) as { job: BuildJobSnapshot }).job.artifactId).toBeUndefined()
    } finally { vi.useRealTimers() }
  })
  it('rejects an admission that crosses its deadline before the timer callback runs', async () => {
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const f = await fixture(true, { async run() {
        now += 101
        return { ok: true, message: 'returned after deadline' }
      } }, { maxDurationMs: 100 })
      const changed = structuredClone(f.project); changed.globalLayerItems[0].item.opacity = 0.9
      await f.exec({ type: 'write', path: 'project.json', content: JSON.stringify(changed) })
      expect(await f.exec({ type: 'check' })).toMatchObject({ status: 'exhausted' })
      const logs = await f.exec({ type: 'logs' }) as { entries: Array<{ message: string }> }
      expect(logs.entries.at(-1)?.message).toContain('本次构建检查超时')
      expect((await f.exec({ type: 'list' }) as { job: BuildJobSnapshot }).job.artifactId).toBeUndefined()
    } finally { clock.mockRestore() }
  })
  it('cancels an in-flight admission, ignores its late response, and never exposes an import artifact', async () => {
    let release!: (value: any) => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let receivedSignal: AbortSignal | undefined
    const f = await fixture(true, { run: async (payload, signal) => {
      expect(payload.verificationMode).toBe('full-admission'); expect(payload.observeBehavior).toBe(true)
      expect(Object.keys(payload.componentFiles)).not.toHaveLength(0)
      receivedSignal = signal; entered()
      return new Promise(resolve => { release = resolve })
    } })
    const changed = structuredClone(f.project); changed.globalLayerItems[0].item.opacity = 0.9
    await f.exec({ type: 'write', path: 'project.json', content: JSON.stringify(changed) })
    const check = f.exec({ type: 'check' }); await started
    const cancel = f.exec({ type: 'cancel' })
    expect(await check).toMatchObject({ status: 'cancelled' }); await cancel
    expect(receivedSignal?.aborted).toBe(true)
    release({ ok: true, message: 'late result must not publish' })
    await expect(f.service.artifact('run', f.job.jobId, 'unknown')).rejects.toMatchObject({ code: 'build-cancelled' })
    expect((await f.exec({ type: 'list' }) as { job: BuildJobSnapshot }).job.artifactId).toBeUndefined()
  })
})


it('M25 preserves a software-owned HTML carrier across build formatting, rejects semantic replacement and retains the candidate', async () => {
  const f = await fixture()
  const filename = path.join(f.root, 'source.html')
  await fs.writeFile(filename, '<!doctype html><h1>受管页面</h1>')
  const snapshot: DocumentSnapshot = { documentId: 'doc', epoch: 'epoch', revision: f.project.revision,
    binding: { kind: 'file', path: path.join(f.root, 'purpose-created.h5lesson'), version: null, bindingVersion: 1 },
    model: f.baseline, dirty: false, saving: false, recoverable: false, undoDepth: 0, redoDepth: 0 }
  const prepared = await prepareHtmlCourseCandidate({ snapshot, sourcePath: filename, locationId: f.project.locations[0]!.id })
  const baseline = prepared.model, digest = documentDigest(baseline)
  const job = await f.service.create({ runId: 'run', baseline, allowedOrigins: [],
    target: { documentId: 'doc', epoch: 'epoch', projectId: baseline.project.id, baseRevision: baseline.project.revision, modelDigest: digest },
    readSet: [{ documentId: 'doc', epoch: 'epoch', revision: baseline.project.revision, digest }] })
  const exec = (call: Record<string, unknown>) => f.service.execute('run', { jobId: job.jobId, ...call })
  const formatted = structuredClone(baseline.project)
  visitCourseLayerItems(formatted, ({ item }) => { if (item.kind === 'runtime') item.runtime.source = `/* cosmetic */\n${item.runtime.source}` })
  await exec({ type: 'write', path: 'project.json', content: JSON.stringify(formatted) })
  const ready = await exec({ type: 'check' }) as BuildJobSnapshot
  expect(ready.status).toBe('ready')
  const artifact = await f.service.artifact('run', job.jobId, ready.artifactId!)
  expect(artifact.command.type).toBe('course.replace')
  if (artifact.command.type !== 'course.replace') throw new Error('Wrong artifact')
  expect(artifact.command.project).toEqual(baseline.project)
  expect(f.run).not.toHaveBeenCalled() // Cosmetic normalization does not fabricate a fresh runtime admission.
  const customized = structuredClone(baseline.project)
  visitCourseLayerItems(customized, ({ item }) => {
    if (item.kind === 'runtime') item.runtime.source = item.runtime.source.replace("iframe.dataset.htmlDocumentRuntime = 'true';", '')
  })
  await exec({ type: 'write', path: 'project.json', content: JSON.stringify(customized) })
  expect(await exec({ type: 'check' })).toMatchObject({ status: 'failed' })
  expect(await exec({ type: 'logs' })).toMatchObject({ entries: expect.arrayContaining([
    expect.objectContaining({ message: expect.stringContaining('宿主封装发生语义变化') }),
  ]) })
  expect(JSON.parse((await exec({ type: 'read', path: 'project.json' }) as { content: string }).content)).toEqual(customized)
  expect(f.run).not.toHaveBeenCalled()
  const contentOnly = structuredClone(baseline.project)
  visitCourseLayerItems(contentOnly, ({ item }) => {
    if (item.kind !== 'runtime') return
    const payload = unpackHtmlDocumentRuntimeSource(item.runtime.source)!
    item.runtime.source = createHtmlDocumentRuntimeSource({ ...payload, html: payload.html.replace('受管页面', '改过的页面') })
  })
  await exec({ type: 'write', path: 'project.json', content: JSON.stringify(contentOnly) })
  expect(await exec({ type: 'check' })).toMatchObject({ status: 'failed' })
  expect(f.run).toHaveBeenCalledOnce() // The test port deliberately rejects; no mocked successful admission or publication.
  const submitted = f.run.mock.calls[0]![0]
  expect(submitted.project).toEqual(contentOnly)
  expect((await exec({ type: 'list' }) as { job: BuildJobSnapshot }).job.artifactId).toBeUndefined()
})


it('M28 a background build acknowledges persisted checking and remains cancellable without waiting for its admission provider', async () => {
  let entered!: () => void, release!: (value: any) => void, calls = 0
  const reached = new Promise<void>(resolve => { entered = resolve })
  const f = await fixture(true, { run: async () => { calls++; entered(); return new Promise(resolve => { release = resolve }) } })
  const changed = structuredClone(f.project); changed.globalLayerItems[0]!.item.opacity = 0.9
  await f.exec({ type: 'write', path: 'project.json', content: JSON.stringify(changed) })
  const accepted = await f.service.startCheck('run', { type: 'check', jobId: f.job.jobId })
  expect(accepted).toMatchObject({ status: 'checking', checks: 1 })
  expect((await fs.stat(path.join(f.root, 'scratch', f.job.jobId, 'state.bin'))).size).toBeGreaterThan(0)
  await reached
  try {
    expect(await f.service.startCheck('run', { type: 'check', jobId: f.job.jobId })).toEqual(accepted)
    expect(await f.service.status('run', f.job.jobId)).toMatchObject({ status: 'checking', checks: 1 })
    expect(await f.service.waitCheck('run', f.job.jobId, 5)).toMatchObject({ status: 'checking', checks: 1 })
    await expect(f.service.status('other-run', f.job.jobId)).rejects.toMatchObject({ code: 'job-not-authorized' })
    expect(await f.exec({ type: 'cancel' })).toMatchObject({ status: 'cancelled' })
    expect(await f.service.waitCheck('run', f.job.jobId, 100)).toMatchObject({ status: 'cancelled' })
    expect(await f.service.status('run', f.job.jobId)).toMatchObject({ status: 'cancelled' })
    expect(calls).toBe(1)
  } finally { release({ ok: true, message: 'Late response must not produce an artifact' }) }
  expect((await f.service.status('run', f.job.jobId)).artifactId).toBeUndefined()
  const restored = new ControlledBuildService({ directory: path.join(f.root, 'scratch'), admission: { run: async () => { throw new Error('Must not replay') } } })
  expect(await restored.status('run', f.job.jobId)).toMatchObject({ status: 'cancelled' })
})

it('M28 a late cancel preserves a completed build artifact for explicit import', async () => {
  const f = await fixture()
  const ready = await f.exec({ type: 'check' }) as BuildJobSnapshot
  expect(ready.status).toBe('ready')
  expect(await f.exec({ type: 'cancel' })).toEqual(ready)
  expect(await f.service.artifact('run', f.job.jobId, ready.artifactId!)).toMatchObject({ artifactId: ready.artifactId })
})
